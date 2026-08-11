import { randomUUID } from 'node:crypto'
import { lstat, readFile, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { SkillInstallResult, SkillPlacementResult } from '../../shared/skill-install-contract'
import { acquireSkillInstallLock } from './skill-install-lock'
import {
  readSkillInstallReceipt,
  removeSkillInstallReceipt,
  skillInstallStateKey,
  writeSkillStateFile,
  type SkillInstallReceiptV1
} from './skill-install-provenance'
import {
  nativeSkillInstallFilesystem,
  type SkillInstallFilesystem
} from './skill-install-filesystem'
import { isRemovableSkillPlacement } from './skill-removable-placement'

type RemovalMove = {
  sourcePath: string
  backupPath: string
  placement: SkillPlacementResult
}

type SkillRemovalJournalV1 = {
  schemaVersion: 1
  operation: 'remove'
  phase: 'prepared' | 'moving' | 'receipt-removed'
  canonicalPath: string
  movedCount: number
  moves: RemovalMove[]
}

export type LocalSkillRemovalInput = {
  operationId: string
  canonicalPath: string
  stateDirectory: string
  allowedProviderRoots: readonly string[]
  conflictResolution?: 'replace-and-discard-local' | 'cancel'
  filesystem?: SkillInstallFilesystem
}

function journalPath(stateDirectory: string, canonicalPath: string): string {
  return join(stateDirectory, 'removal-journals', `${skillInstallStateKey(canonicalPath)}.json`)
}

function lockPath(stateDirectory: string, canonicalPath: string): string {
  return join(stateDirectory, 'locks', `${skillInstallStateKey(canonicalPath)}.lock`)
}

function validBackup(move: RemovalMove): boolean {
  return (
    dirname(move.sourcePath) === dirname(move.backupPath) &&
    basename(move.backupPath).startsWith(`.${basename(move.sourcePath)}.orca-remove-backup-`)
  )
}

function isRemovalJournal(value: unknown, canonicalPath: string): value is SkillRemovalJournalV1 {
  if (!value || typeof value !== 'object') {
    return false
  }
  const journal = value as Partial<SkillRemovalJournalV1>
  return (
    journal.schemaVersion === 1 &&
    journal.operation === 'remove' &&
    journal.canonicalPath === canonicalPath &&
    (journal.phase === 'prepared' ||
      journal.phase === 'moving' ||
      journal.phase === 'receipt-removed') &&
    Number.isInteger(journal.movedCount) &&
    Array.isArray(journal.moves) &&
    journal.moves.every(validBackup) &&
    journal.movedCount! >= 0 &&
    journal.movedCount! <= journal.moves.length
  )
}

async function readJournal(
  stateDirectory: string,
  canonicalPath: string
): Promise<SkillRemovalJournalV1 | null> {
  try {
    const value: unknown = JSON.parse(
      await readFile(journalPath(stateDirectory, canonicalPath), 'utf8')
    )
    if (!isRemovalJournal(value, canonicalPath)) {
      throw new Error('skill-removal-journal-invalid')
    }
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function pathExists(path: string): Promise<boolean> {
  return Boolean(await lstat(path).catch(() => null))
}

export async function recoverSkillRemovalTransaction(
  stateDirectory: string,
  canonicalPath: string,
  filesystem: SkillInstallFilesystem = nativeSkillInstallFilesystem
): Promise<void> {
  const journal = await readJournal(stateDirectory, canonicalPath)
  if (!journal) {
    return
  }
  if (journal.phase === 'receipt-removed') {
    for (const move of journal.moves.slice(0, journal.movedCount)) {
      await filesystem.remove(move.backupPath)
    }
    await rm(journalPath(stateDirectory, canonicalPath), { force: true })
    return
  }
  for (const move of journal.moves.slice(0, journal.movedCount).toReversed()) {
    if ((await pathExists(move.backupPath)) && !(await pathExists(move.sourcePath))) {
      await filesystem.rename(move.backupPath, move.sourcePath)
    }
  }
  await rm(journalPath(stateDirectory, canonicalPath), { force: true })
}

function conflictResult(
  input: LocalSkillRemovalInput,
  receipt: SkillInstallReceiptV1 | null,
  kind: 'modified' | 'unowned' | 'external-link' | 'name-collision'
): SkillInstallResult {
  return {
    operationId: input.operationId,
    status: 'conflict',
    name: basename(input.canonicalPath),
    packageDigest: receipt?.packageDigest ?? '',
    canonicalPath: input.canonicalPath,
    placements: [],
    conflict: { kind }
  }
}

async function inspectCanonicalRemoval(
  input: LocalSkillRemovalInput,
  receipt: SkillInstallReceiptV1 | null
): Promise<'missing' | 'owned' | 'modified' | 'unowned' | 'external-link' | 'name-collision'> {
  const stat = await lstat(input.canonicalPath).catch(() => null)
  if (!stat) {
    return receipt ? 'missing' : 'unowned'
  }
  if (!receipt) {
    return 'unowned'
  }
  if (stat.isSymbolicLink()) {
    return 'external-link'
  }
  if (!stat.isDirectory()) {
    return 'name-collision'
  }
  const observed = await (input.filesystem ?? nativeSkillInstallFilesystem)
    .observeSkill(input.canonicalPath, receipt.fileModes)
    .catch(() => null)
  return observed?.observedDigest === receipt.packageDigest ? 'owned' : 'modified'
}

export async function removeLocalSharedSkill(
  input: LocalSkillRemovalInput
): Promise<SkillInstallResult> {
  const filesystem = input.filesystem ?? nativeSkillInstallFilesystem
  const releaseLock = await acquireSkillInstallLock({
    path: lockPath(input.stateDirectory, input.canonicalPath)
  })
  try {
    await recoverSkillRemovalTransaction(input.stateDirectory, input.canonicalPath, filesystem)
    const receipt = await readSkillInstallReceipt(input.stateDirectory, input.canonicalPath)
    const state = await inspectCanonicalRemoval(input, receipt)
    if (!receipt) {
      return conflictResult(input, null, 'unowned')
    }
    if (state === 'unowned' || state === 'external-link' || state === 'name-collision') {
      return conflictResult(input, receipt, state)
    }
    if (state === 'modified' && input.conflictResolution !== 'replace-and-discard-local') {
      return conflictResult(input, receipt, 'modified')
    }

    const removedPlacements: SkillPlacementResult[] = []
    const skippedPlacements: SkillPlacementResult[] = []
    const moves: RemovalMove[] = []
    for (const placement of receipt.placements) {
      if (placement.topology === 'canonical-copy') {
        continue
      }
      if (
        await isRemovableSkillPlacement({
          placement,
          receipt,
          allowedProviderRoots: input.allowedProviderRoots,
          filesystem
        })
      ) {
        moves.push({
          sourcePath: placement.path,
          backupPath: join(
            dirname(placement.path),
            `.${basename(placement.path)}.orca-remove-backup-${randomUUID()}`
          ),
          placement
        })
      } else if (await pathExists(placement.path)) {
        skippedPlacements.push({
          ...placement,
          status: 'skipped',
          errorCategory: 'skill-removal-placement-modified-or-unowned'
        })
      }
    }
    if (state !== 'missing') {
      moves.push({
        sourcePath: input.canonicalPath,
        backupPath: join(
          dirname(input.canonicalPath),
          `.${basename(input.canonicalPath)}.orca-remove-backup-${randomUUID()}`
        ),
        placement: {
          provider: 'agent-skills',
          path: input.canonicalPath,
          topology: 'canonical-copy',
          status: 'installed'
        }
      })
    }
    const journal: SkillRemovalJournalV1 = {
      schemaVersion: 1,
      operation: 'remove',
      phase: 'prepared',
      canonicalPath: input.canonicalPath,
      movedCount: 0,
      moves
    }
    const statePath = journalPath(input.stateDirectory, input.canonicalPath)
    await writeSkillStateFile(statePath, journal)
    for (const move of moves) {
      journal.movedCount += 1
      journal.phase = 'moving'
      await writeSkillStateFile(statePath, journal)
      await filesystem.rename(move.sourcePath, move.backupPath)
      removedPlacements.push({ ...move.placement, status: 'removed' })
    }
    await removeSkillInstallReceipt(input.stateDirectory, input.canonicalPath)
    journal.phase = 'receipt-removed'
    await writeSkillStateFile(statePath, journal)
    await recoverSkillRemovalTransaction(input.stateDirectory, input.canonicalPath, filesystem)
    return {
      operationId: input.operationId,
      status: skippedPlacements.length > 0 ? 'partial' : 'removed',
      name: basename(input.canonicalPath),
      packageDigest: receipt.packageDigest,
      canonicalPath: input.canonicalPath,
      placements: [...removedPlacements, ...skippedPlacements]
    }
  } catch (error) {
    await recoverSkillRemovalTransaction(
      input.stateDirectory,
      input.canonicalPath,
      filesystem
    ).catch(() => undefined)
    throw error
  } finally {
    await releaseLock()
  }
}
