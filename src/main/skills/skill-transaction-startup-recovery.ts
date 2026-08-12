import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { readNodeFileWithinLimit } from '../../shared/node-bounded-file-reader'
import {
  acquireSkillInstallLock,
  reclaimDeadSkillInstallLocks,
  skillInstallLockPath
} from './skill-install-lock'
import { recoverPendingSkillExtractions } from './skill-extraction-recovery'
import { skillInstallStateKey } from './skill-install-provenance'
import {
  readSkillInstallRecoveryJournal,
  recoverSkillInstallTransaction
} from './skill-install-recovery'
import {
  readSkillRemovalRecoveryJournal,
  recoverSkillRemovalTransaction
} from './skill-remove-recovery'
import { WslSkillInstallFilesystem } from './skill-wsl-install-filesystem'

const MAX_PENDING_TRANSACTION_JOURNALS = 64
const MAX_TRANSACTION_JOURNAL_BYTES = 4 * 1024 * 1024

type PendingTransaction = {
  canonicalPath: string
  journalKey: string
  install: boolean
  removal: boolean
}

export type SkillTransactionStartupRecoveryReport = {
  scanned: number
  recovered: number
  failures: { journalKey: string; code: string }[]
  truncated: boolean
}

function failureCode(error: unknown): string {
  return error instanceof Error && /^skill-[a-z0-9-]+$/.test(error.message)
    ? error.message
    : 'skill-transaction-startup-recovery-failed'
}

async function scanJournalDirectory(
  stateDirectory: string,
  directoryName: 'journals' | 'removal-journals'
): Promise<{
  candidates: { canonicalPath: string; journalKey: string }[]
  failures: { journalKey: string; code: string }[]
  truncated: boolean
}> {
  const entries = await readdir(join(stateDirectory, directoryName), { withFileTypes: true }).catch(
    (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw error
    }
  )
  const journalEntries = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name))
  const candidates: { canonicalPath: string; journalKey: string }[] = []
  const failures: { journalKey: string; code: string }[] = []
  for (const entry of journalEntries.slice(0, MAX_PENDING_TRANSACTION_JOURNALS)) {
    const journalKey = entry.name.slice(0, -'.json'.length)
    try {
      const parsed: unknown = JSON.parse(
        (
          await readNodeFileWithinLimit(
            join(stateDirectory, directoryName, entry.name),
            MAX_TRANSACTION_JOURNAL_BYTES
          )
        ).buffer.toString('utf8')
      )
      const canonicalPath =
        parsed && typeof parsed === 'object' && 'canonicalPath' in parsed
          ? (parsed as { canonicalPath?: unknown }).canonicalPath
          : null
      if (
        typeof canonicalPath !== 'string' ||
        canonicalPath.length > 32_768 ||
        skillInstallStateKey(canonicalPath) !== journalKey
      ) {
        throw new Error('skill-transaction-journal-invalid')
      }
      candidates.push({ canonicalPath, journalKey })
    } catch (error) {
      failures.push({ journalKey, code: failureCode(error) })
    }
  }
  return {
    candidates,
    failures,
    truncated: journalEntries.length > MAX_PENDING_TRANSACTION_JOURNALS
  }
}

function pendingTransactions(
  installs: readonly { canonicalPath: string; journalKey: string }[],
  removals: readonly { canonicalPath: string; journalKey: string }[]
): PendingTransaction[] {
  const pending = new Map<string, PendingTransaction>()
  const add = (
    candidate: { canonicalPath: string; journalKey: string },
    kind: 'install' | 'removal'
  ): void => {
    const current = pending.get(candidate.canonicalPath) ?? {
      canonicalPath: candidate.canonicalPath,
      journalKey: candidate.journalKey,
      install: false,
      removal: false
    }
    current[kind] = true
    pending.set(candidate.canonicalPath, current)
  }
  removals.forEach((candidate) => add(candidate, 'removal'))
  installs.forEach((candidate) => add(candidate, 'install'))
  return [...pending.values()]
}

export async function recoverPendingSkillTransactions(
  stateDirectory: string
): Promise<SkillTransactionStartupRecoveryReport> {
  const [installs, removals, extractions, locks] = await Promise.all([
    scanJournalDirectory(stateDirectory, 'journals'),
    scanJournalDirectory(stateDirectory, 'removal-journals'),
    recoverPendingSkillExtractions(stateDirectory),
    reclaimDeadSkillInstallLocks(stateDirectory)
  ])
  const report: SkillTransactionStartupRecoveryReport = {
    scanned: installs.candidates.length + removals.candidates.length + extractions.scanned,
    recovered: extractions.recovered,
    failures: [...installs.failures, ...removals.failures, ...extractions.failures],
    truncated: installs.truncated || removals.truncated || extractions.truncated || locks.truncated
  }
  for (const pending of pendingTransactions(installs.candidates, removals.candidates)) {
    let releaseLock: (() => Promise<void>) | null = null
    try {
      releaseLock = await acquireSkillInstallLock({
        path: skillInstallLockPath(stateDirectory, pending.canonicalPath)
      })
      const installJournal = pending.install
        ? await readSkillInstallRecoveryJournal(stateDirectory, pending.canonicalPath)
        : null
      const removalJournal = pending.removal
        ? await readSkillRemovalRecoveryJournal(stateDirectory, pending.canonicalPath)
        : null
      const distros = new Set(
        [installJournal?.receipt.wslDistro, removalJournal?.receipt.wslDistro].filter(
          (distro): distro is string => Boolean(distro)
        )
      )
      if (distros.size > 1 || (distros.size && process.platform !== 'win32')) {
        throw new Error('skill-transaction-wsl-recovery-unavailable')
      }
      const distro = [...distros][0]
      const filesystem = distro
        ? new WslSkillInstallFilesystem(distro, [
            dirname(pending.canonicalPath),
            ...(removalJournal?.allowedProviderRoots ?? [])
          ])
        : undefined
      if (removalJournal) {
        await recoverSkillRemovalTransaction(stateDirectory, pending.canonicalPath, filesystem)
        report.recovered += 1
      }
      if (installJournal) {
        await recoverSkillInstallTransaction(stateDirectory, pending.canonicalPath, filesystem)
        report.recovered += 1
      }
    } catch (error) {
      report.failures.push({ journalKey: pending.journalKey, code: failureCode(error) })
    } finally {
      await releaseLock?.().catch((error) => {
        report.failures.push({ journalKey: pending.journalKey, code: failureCode(error) })
      })
    }
  }
  return report
}
