import { lstat, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  skillInstallStateKey,
  writeSkillInstallReceipt,
  type SkillInstallReceiptV1
} from './skill-install-provenance'
import {
  nativeSkillInstallFilesystem,
  type SkillInstallFilesystem,
  type SkillInstalledFileMode
} from './skill-install-filesystem'

type InstallJournalPhase =
  | 'prepared'
  | 'backup-created'
  | 'canonical-placed'
  | 'receipt-published'
  | 'complete'

export type SkillInstallJournalV1 = {
  schemaVersion: 1
  operation: 'install'
  phase: InstallJournalPhase
  canonicalPath: string
  extractionPath: string
  stagingPath: string
  backupPath: string
  receipt: SkillInstallReceiptV1
}

export function skillInstallJournalPath(stateDirectory: string, canonicalPath: string): string {
  return join(stateDirectory, 'journals', `${skillInstallStateKey(canonicalPath)}.json`)
}

export async function skillInstallPathExists(path: string): Promise<boolean> {
  return Boolean(await lstat(path).catch(() => null))
}

function isInstallJournal(value: unknown, canonicalPath: string): value is SkillInstallJournalV1 {
  if (!value || typeof value !== 'object') {
    return false
  }
  const journal = value as Partial<SkillInstallJournalV1>
  return (
    journal.schemaVersion === 1 &&
    journal.operation === 'install' &&
    typeof journal.phase === 'string' &&
    journal.canonicalPath === canonicalPath &&
    typeof journal.extractionPath === 'string' &&
    typeof journal.stagingPath === 'string' &&
    typeof journal.backupPath === 'string' &&
    Boolean(journal.receipt)
  )
}

async function readJournal(
  stateDirectory: string,
  canonicalPath: string
): Promise<SkillInstallJournalV1 | null> {
  try {
    const value: unknown = JSON.parse(
      await readFile(skillInstallJournalPath(stateDirectory, canonicalPath), 'utf8')
    )
    if (!isInstallJournal(value, canonicalPath)) {
      throw new Error('skill-install-journal-invalid')
    }
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function skillInstallDestinationMatches(
  path: string,
  digest: string,
  filesystem: SkillInstallFilesystem = nativeSkillInstallFilesystem,
  files?: readonly SkillInstalledFileMode[]
): Promise<boolean> {
  try {
    return (await filesystem.observeSkill(path, files)).observedDigest === digest
  } catch {
    return false
  }
}

export async function cleanSkillInstallJournalFiles(
  journal: SkillInstallJournalV1,
  filesystem: SkillInstallFilesystem = nativeSkillInstallFilesystem
): Promise<void> {
  await filesystem.remove(journal.extractionPath)
  await filesystem.remove(journal.stagingPath)
  await filesystem.remove(journal.backupPath)
}

export async function recoverSkillInstallTransaction(
  stateDirectory: string,
  canonicalPath: string,
  filesystem: SkillInstallFilesystem = nativeSkillInstallFilesystem
): Promise<void> {
  const journal = await readJournal(stateDirectory, canonicalPath)
  if (!journal) {
    return
  }
  const destinationExists = await skillInstallPathExists(canonicalPath)
  const backupExists = await skillInstallPathExists(journal.backupPath)
  const destinationIsRequested =
    destinationExists &&
    (await skillInstallDestinationMatches(
      canonicalPath,
      journal.receipt.packageDigest,
      filesystem,
      journal.receipt.fileModes
    ))

  if (destinationIsRequested) {
    await writeSkillInstallReceipt(stateDirectory, journal.receipt)
    await cleanSkillInstallJournalFiles(journal, filesystem)
    await rm(skillInstallJournalPath(stateDirectory, canonicalPath), { force: true })
    return
  }
  if (!destinationExists && backupExists) {
    await filesystem.rename(journal.backupPath, canonicalPath)
    await filesystem.remove(journal.extractionPath)
    await filesystem.remove(journal.stagingPath)
    await rm(skillInstallJournalPath(stateDirectory, canonicalPath), { force: true })
    return
  }
  if (journal.phase === 'prepared' && !backupExists) {
    await cleanSkillInstallJournalFiles(journal, filesystem)
    await rm(skillInstallJournalPath(stateDirectory, canonicalPath), { force: true })
    return
  }
  throw new Error('skill-install-recovery-conflict')
}
