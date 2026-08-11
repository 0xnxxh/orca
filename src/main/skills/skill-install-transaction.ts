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
  writeSkillStateFile,
  type SkillInstallReceiptV1
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
}

export type LocalSkillInstallPreview = {
  manifest: SkillPackageManifestV1
  canonicalPath: string
  currentState: SkillCanonicalState
}

function lockPath(stateDirectory: string, canonicalPath: string): string {
  return join(stateDirectory, 'locks', `${skillInstallStateKey(canonicalPath)}.lock`)
}

function conflictResult(
  operationId: string,
  manifest: SkillPackageManifestV1,
  state: SkillCanonicalState
): SkillInstallResult {
  const kind =
    state.kind === 'modified' ||
    state.kind === 'unowned' ||
    state.kind === 'external-link' ||
    state.kind === 'name-collision'
      ? state.kind
      : 'modified'
  return {
    operationId,
    status: 'conflict',
    name: manifest.name,
    packageDigest: manifest.packageDigest,
    placements: [],
    conflict: {
      kind,
      ...('digest' in state && state.digest ? { existingDigest: state.digest } : {})
    }
  }
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
    filesystem: input.filesystem
  })
  return { extractionPath, manifest: extracted.manifest, archiveSha256: extracted.archiveSha256 }
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

function replacementAllowed(state: SkillCanonicalState, input: LocalSkillInstallInput): boolean {
  if (state.kind === 'missing' || state.kind === 'clean-update') {
    return input.conflictResolution !== 'cancel'
  }
  return (
    (state.kind === 'modified' || state.kind === 'unowned') &&
    input.conflictResolution === 'replace-and-discard-local'
  )
}

function createReceipt(input: {
  request: LocalSkillInstallInput
  manifest: SkillPackageManifestV1
  archiveSha256: string
  canonicalPath: string
  previous: SkillInstallReceiptV1 | null
}): SkillInstallReceiptV1 {
  return {
    schemaVersion: 1,
    packageId: input.manifest.packageId,
    versionId: input.manifest.versionId,
    packageDigest: input.manifest.packageDigest,
    archiveSha256: input.archiveSha256,
    scope: input.request.scope,
    destinationIdentity: input.request.destinationIdentity,
    canonicalPath: input.canonicalPath,
    placements: [
      {
        provider: 'agent-skills',
        path: input.canonicalPath,
        topology: 'canonical-copy',
        status: 'installed'
      }
    ],
    ...(input.previous ? { previousVersionId: input.previous.versionId } : {}),
    installedAt: new Date().toISOString(),
    hostIdentity: input.request.hostIdentity,
    fileModes: input.manifest.files.map((file) => ({
      path: file.path,
      executable: file.executable
    })),
    ...(input.request.wslDistro ? { wslDistro: input.request.wslDistro } : {})
  }
}

export async function installLocalSkillPackage(
  input: LocalSkillInstallInput
): Promise<SkillInstallResult> {
  const filesystem = input.filesystem ?? nativeSkillInstallFilesystem
  const extracted = await inspectExtractedPackage(input)
  const canonicalPath = join(input.destinationRoot, extracted.manifest.name)
  const releaseLock = await acquireSkillInstallLock({
    path: lockPath(input.stateDirectory, canonicalPath)
  })
  let journal: SkillInstallJournalV1 | null = null
  try {
    await recoverSkillRemovalTransaction(input.stateDirectory, canonicalPath, filesystem)
    await recoverSkillInstallTransaction(input.stateDirectory, canonicalPath, filesystem)
    const previous = await readSkillInstallReceipt(input.stateDirectory, canonicalPath)
    const state = await inspectSkillCanonicalState({
      canonicalPath,
      manifest: extracted.manifest,
      receipt: previous,
      filesystem
    })
    const receipt = createReceipt({
      request: input,
      manifest: extracted.manifest,
      archiveSha256: extracted.archiveSha256,
      canonicalPath,
      previous
    })
    if (state.kind === 'unchanged') {
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
    if (!replacementAllowed(state, input)) {
      return conflictResult(input.operationId, extracted.manifest, state)
    }
    const transactionId = randomUUID()
    const stagingPath = join(
      input.destinationRoot,
      `.${extracted.manifest.name}.orca-staging-${transactionId}`
    )
    const backupPath = join(
      input.destinationRoot,
      `.${extracted.manifest.name}.orca-backup-${transactionId}`
    )
    await filesystem.rename(join(extracted.extractionPath, 'skill'), stagingPath)
    journal = {
      schemaVersion: 1,
      operation: 'install',
      phase: 'prepared',
      canonicalPath,
      extractionPath: extracted.extractionPath,
      stagingPath,
      backupPath,
      receipt
    }
    const statePath = skillInstallJournalPath(input.stateDirectory, canonicalPath)
    await writeSkillStateFile(statePath, journal)
    if (await skillInstallPathExists(canonicalPath)) {
      await filesystem.rename(canonicalPath, backupPath)
      journal.phase = 'backup-created'
      await writeSkillStateFile(statePath, journal)
    }
    await filesystem.rename(stagingPath, canonicalPath)
    journal.phase = 'canonical-placed'
    await writeSkillStateFile(statePath, journal)
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
    await writeSkillStateFile(statePath, journal)
    await cleanSkillInstallJournalFiles(journal, filesystem)
    journal.phase = 'complete'
    await writeSkillStateFile(statePath, journal)
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
    throw error
  } finally {
    await filesystem.remove(extracted.extractionPath)
    await releaseLock()
  }
}
