import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { SkillInstallResult } from '../../shared/skill-install-contract'
import type { SkillPackageManifestV1 } from '../../shared/skill-package-manifest'
import { acquireSkillInstallLock } from './skill-install-lock'
import { inspectSkillCanonicalState, type SkillCanonicalState } from './skill-install-planner'
import {
  readSkillInstallReceipt,
  skillInstallStateKey,
  writeSkillInstallReceipt,
  writeSkillStateFile
} from './skill-install-provenance'
import { extractSkillPackageArchive } from './skill-package-extraction'
import { recoverSkillRemovalTransaction } from './skill-remove-transaction'
import {
  cleanSkillInstallJournalFiles,
  recoverSkillInstallTransaction,
  skillInstallDestinationMatches,
  skillInstallJournalPath,
  skillInstallPathExists,
  type SkillInstallJournalV1
} from './skill-install-recovery'
import {
  nativeSkillInstallFilesystem,
  type SkillInstallFilesystem
} from './skill-install-filesystem'
import { SKILL_INSTALL_CANCELLED_FAILURE } from '../../shared/skill-install-failure'
import { SkillInstallOperationError } from './skill-install-operation-error'
import {
  createSkillInstallReceipt,
  skillInstallConflictResult,
  skillInstallFailureResult,
  skillInstallReplacementAllowed
} from './skill-install-transaction-result'

export { recoverSkillInstallTransaction } from './skill-install-recovery'

export type LocalSkillInstallInput = {
  operationId: string
  archivePath: string
  destinationRoot: string
  stateDirectory: string
  scope: 'global' | 'workspace'
  destinationIdentity: string
  hostIdentity: string
  expectedArchiveSha256?: string
  expectedPackageDigest?: string
  expectedPackageId?: string
  expectedVersionId?: string
  conflictResolution?: 'replace-unmodified' | 'replace-and-discard-local' | 'cancel'
  filesystem?: SkillInstallFilesystem
  wslDistro?: string
  signal?: AbortSignal
  lockTimeoutMs?: number
}

export type LocalSkillInstallPreview = {
  manifest: SkillPackageManifestV1
  canonicalPath: string
  currentState: SkillCanonicalState
}

export type SkillInstallJournalBoundary = 'before' | 'after'

export type SkillInstallTransactionDependencies = {
  onJournalTransition?: (
    phase: SkillInstallJournalV1['phase'],
    boundary: SkillInstallJournalBoundary
  ) => Promise<void>
}

function lockPath(stateDirectory: string, canonicalPath: string): string {
  return join(stateDirectory, 'locks', `${skillInstallStateKey(canonicalPath)}.lock`)
}

async function inspectExtractedPackage(input: LocalSkillInstallInput): Promise<{
  extractionPath: string
  manifest: SkillPackageManifestV1
  archiveSha256: string
}> {
  await mkdir(input.destinationRoot, { recursive: true })
  const extractionPath = join(input.destinationRoot, `.orca-skill-extract-${randomUUID()}`)
  const extracted = await extractSkillPackageArchive({
    archivePath: input.archivePath,
    destinationDirectory: extractionPath,
    expectedArchiveSha256: input.expectedArchiveSha256,
    expectedPackageDigest: input.expectedPackageDigest,
    expectedPackageId: input.expectedPackageId,
    expectedVersionId: input.expectedVersionId,
    filesystem: input.filesystem,
    signal: input.signal
  })
  return { extractionPath, manifest: extracted.manifest, archiveSha256: extracted.archiveSha256 }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new SkillInstallOperationError(SKILL_INSTALL_CANCELLED_FAILURE)
  }
}

async function persistJournalTransition(
  statePath: string,
  journal: SkillInstallJournalV1,
  dependencies: SkillInstallTransactionDependencies
): Promise<void> {
  await dependencies.onJournalTransition?.(journal.phase, 'before')
  await writeSkillStateFile(statePath, journal)
  await dependencies.onJournalTransition?.(journal.phase, 'after')
}

export async function previewLocalSkillPackage(
  input: LocalSkillInstallInput
): Promise<LocalSkillInstallPreview> {
  const extracted = await inspectExtractedPackage(input)
  const canonicalPath = join(input.destinationRoot, extracted.manifest.name)
  try {
    const receipt = await readSkillInstallReceipt(input.stateDirectory, canonicalPath)
    return {
      manifest: extracted.manifest,
      canonicalPath,
      currentState: await inspectSkillCanonicalState({
        canonicalPath,
        manifest: extracted.manifest,
        receipt
      })
    }
  } finally {
    await (input.filesystem ?? nativeSkillInstallFilesystem).remove(extracted.extractionPath)
  }
}

export async function installLocalSkillPackage(
  input: LocalSkillInstallInput,
  dependencies: SkillInstallTransactionDependencies = {}
): Promise<SkillInstallResult> {
  const filesystem = input.filesystem ?? nativeSkillInstallFilesystem
  const extracted = await inspectExtractedPackage(input)
  const canonicalPath = join(input.destinationRoot, extracted.manifest.name)
  let releaseLock: (() => Promise<void>) | null = null
  let journal: SkillInstallJournalV1 | null = null
  try {
    throwIfCancelled(input.signal)
    releaseLock = await acquireSkillInstallLock({
      path: lockPath(input.stateDirectory, canonicalPath),
      timeoutMs: input.lockTimeoutMs
    })
    await recoverSkillRemovalTransaction(input.stateDirectory, canonicalPath, filesystem)
    await recoverSkillInstallTransaction(input.stateDirectory, canonicalPath, filesystem)
    throwIfCancelled(input.signal)
    const previous = await readSkillInstallReceipt(input.stateDirectory, canonicalPath)
    const state = await inspectSkillCanonicalState({
      canonicalPath,
      manifest: extracted.manifest,
      receipt: previous,
      filesystem
    })
    const receipt = createSkillInstallReceipt({
      request: input,
      manifest: extracted.manifest,
      archiveSha256: extracted.archiveSha256,
      canonicalPath,
      previous
    })
    if (state.kind === 'unchanged') {
      throwIfCancelled(input.signal)
      await writeSkillInstallReceipt(input.stateDirectory, receipt)
      return {
        operationId: input.operationId,
        status: 'unchanged',
        name: extracted.manifest.name,
        packageDigest: extracted.manifest.packageDigest,
        canonicalPath,
        placements: receipt.placements.map((placement) => ({
          ...placement,
          status: 'unchanged'
        }))
      }
    }
    if (!skillInstallReplacementAllowed(state, input)) {
      return skillInstallConflictResult(input.operationId, extracted.manifest, state)
    }
    throwIfCancelled(input.signal)
    const transactionId = randomUUID()
    const stagingPath = join(
      input.destinationRoot,
      `.${extracted.manifest.name}.orca-staging-${transactionId}`
    )
    const backupPath = join(
      input.destinationRoot,
      `.${extracted.manifest.name}.orca-backup-${transactionId}`
    )
    const destinationExists = await skillInstallPathExists(canonicalPath)
    const backupDigest = 'digest' in state ? (state.digest ?? null) : null
    if (destinationExists && !backupDigest) {
      return skillInstallConflictResult(input.operationId, extracted.manifest, state)
    }
    journal = {
      schemaVersion: 1,
      operation: 'install',
      phase: 'prepared',
      canonicalPath,
      extractionPath: extracted.extractionPath,
      stagingPath,
      backupPath,
      backupDigest,
      stagingFileModes: extracted.manifest.files,
      backupFileModes: previous?.fileModes ?? extracted.manifest.files,
      receipt
    }
    const statePath = skillInstallJournalPath(input.stateDirectory, canonicalPath)
    await persistJournalTransition(statePath, journal, dependencies)
    await filesystem.rename(join(extracted.extractionPath, 'skill'), stagingPath)
    throwIfCancelled(input.signal)
    const commitState = await inspectSkillCanonicalState({
      canonicalPath,
      manifest: extracted.manifest,
      receipt: previous,
      filesystem
    })
    if (JSON.stringify(commitState) !== JSON.stringify(state)) {
      await recoverSkillInstallTransaction(input.stateDirectory, canonicalPath, filesystem)
      journal = null
      return skillInstallConflictResult(
        input.operationId,
        extracted.manifest,
        commitState,
        'skill-install-conflict-stale-preview'
      )
    }
    if (destinationExists) {
      await filesystem.rename(canonicalPath, backupPath)
      journal.phase = 'backup-created'
      await persistJournalTransition(statePath, journal, dependencies)
      throwIfCancelled(input.signal)
    }
    await filesystem.rename(stagingPath, canonicalPath)
    journal.phase = 'canonical-placed'
    await persistJournalTransition(statePath, journal, dependencies)
    if (
      !(await skillInstallDestinationMatches(
        canonicalPath,
        extracted.manifest.packageDigest,
        filesystem,
        extracted.manifest.files
      ))
    ) {
      throw new Error('skill-install-committed-digest-mismatch')
    }
    await writeSkillInstallReceipt(input.stateDirectory, receipt)
    journal.phase = 'receipt-published'
    await persistJournalTransition(statePath, journal, dependencies)
    await cleanSkillInstallJournalFiles(journal, filesystem)
    journal.phase = 'complete'
    await persistJournalTransition(statePath, journal, dependencies)
    await rm(statePath, { force: true })
    return {
      operationId: input.operationId,
      status: previous ? 'updated' : 'installed',
      name: extracted.manifest.name,
      packageDigest: extracted.manifest.packageDigest,
      canonicalPath,
      placements: receipt.placements
    }
  } catch (error) {
    if (journal) {
      await recoverSkillInstallTransaction(input.stateDirectory, canonicalPath, filesystem).catch(
        () => undefined
      )
    }
    const result = skillInstallFailureResult(input, extracted.manifest, canonicalPath, error)
    if (result) {
      return result
    }
    throw error
  } finally {
    await filesystem.remove(extracted.extractionPath)
    await releaseLock?.()
  }
}
