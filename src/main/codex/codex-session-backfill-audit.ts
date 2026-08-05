import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, type Stats } from 'node:fs'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import type { CodexSessionBackfillSummary } from './codex-session-backfill-types'

export type CodexSessionBackfillAuditWriter = (record: Record<string, unknown>) => Promise<boolean>

export type CodexSessionBackfillAuditCoverage = {
  fileEventIds: Set<string>
  hasRunSummary: boolean
}

const HEAL_AUDIT_ACTIONS = new Set(['hardlink', 'copy', 'existing'])

export function createCodexSessionBackfillAuditWriter(
  auditLogPath: string
): CodexSessionBackfillAuditWriter {
  let auditDirectoryReady: Promise<string | undefined> | undefined
  const appendRecord = async (serializedRecord: string): Promise<void> => {
    auditDirectoryReady ??= mkdir(dirname(auditLogPath), { recursive: true }).catch(
      (error: unknown) => {
        auditDirectoryReady = undefined
        throw error
      }
    )
    await auditDirectoryReady
    await appendFile(auditLogPath, serializedRecord, { encoding: 'utf-8' })
  }
  return async (record): Promise<boolean> => {
    // Why: a crash can leave a partial final JSON object. A leading newline
    // quarantines that torn tail so this recovery record remains parseable.
    const serializedRecord = `\n${JSON.stringify({
      at: new Date().toISOString(),
      ...record,
      // Why: a later managed-lane pass can recreate the same thread id, so a
      // terminal heal outcome must identify this particular publication event.
      recordId: randomUUID()
    })}\n`
    try {
      await appendRecord(serializedRecord)
      return true
    } catch {
      // Why: the heal consumes this ledger as its work queue. Retry the same
      // record once so a transient mkdir/write failure cannot omit a session.
    }
    try {
      await appendRecord(serializedRecord)
      return true
    } catch (error) {
      // Why: a published hardlink/copy may already be in use, so persistent
      // ledger failure is reported but cannot safely roll back the backfill.
      console.warn('[codex-session-backfill] Failed to append audit record:', error)
      return false
    }
  }
}

export async function readCodexSessionBackfillAuditCoverage(
  auditLogPath: string
): Promise<CodexSessionBackfillAuditCoverage> {
  const coverage: CodexSessionBackfillAuditCoverage = {
    fileEventIds: new Set<string>(),
    hasRunSummary: false
  }
  const input = createReadStream(auditLogPath, { encoding: 'utf-8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const raw of lines) {
      try {
        const parsed: unknown = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          continue
        }
        const record = parsed as Record<string, unknown>
        coverage.hasRunSummary ||= record.action === 'run-summary'
        if (
          typeof record.action === 'string' &&
          HEAL_AUDIT_ACTIONS.has(record.action) &&
          typeof record.fileEventId === 'string'
        ) {
          coverage.fileEventIds.add(record.fileEventId)
        }
      } catch {
        // Torn audit tails are quarantined by the writer's leading newline.
      }
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }
  return coverage
}

export function createCodexSessionBackfillFileEventId(targetPath: string, stat: Stats): string {
  const stableFileIdentity =
    stat.ino !== 0 || stat.birthtimeMs !== 0
      ? `${stat.dev}\0${stat.ino}\0${stat.birthtimeMs}`
      : `${stat.size}\0${stat.mtimeMs}\0${stat.ctimeMs}`
  return createHash('sha256')
    .update(normalizeRuntimePathForComparison(targetPath))
    .update('\0')
    .update(stableFileIdentity)
    .digest('hex')
}

export async function appendCodexSessionHealAuditRecord(
  writer: CodexSessionBackfillAuditWriter,
  summary: CodexSessionBackfillSummary,
  record: Record<string, unknown>
): Promise<boolean> {
  const appended = await writer(record)
  if (!appended) {
    summary.failedHealAuditRecords += 1
  }
  return appended
}

export async function recordExistingCodexSessionForHeal(
  writer: CodexSessionBackfillAuditWriter,
  summary: CodexSessionBackfillSummary,
  source: string,
  target: string,
  fileEventId?: string
): Promise<boolean> {
  summary.skippedExistingFiles += 1
  // Why: this also recovers a rollout installed before a crash or audit
  // failure; thread/read is idempotent for a pre-existing real-home file.
  return appendCodexSessionHealAuditRecord(writer, summary, {
    action: 'existing',
    source,
    target,
    ...(fileEventId ? { fileEventId } : {})
  })
}

function isNotFoundError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}
