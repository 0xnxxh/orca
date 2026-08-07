import type { Stats } from 'node:fs'
import { describeCodexSessionBackfillErrorCode } from './codex-session-backfill-audit'
import {
  readCodexSessionTargetStat,
  type CodexSessionBackfillAuditPass
} from './codex-session-backfill-audit-pass'
import { replaceOwnedSessionCopy } from './codex-session-backfill-copy'
import type { CodexSessionBackfillSummary } from './codex-session-backfill-types'

export async function refreshOwnedCodexSessionCopy(args: {
  source: string
  target: string
  targetStat: Stats
  summary: CodexSessionBackfillSummary
  auditPass: CodexSessionBackfillAuditPass
}): Promise<boolean> {
  if (!args.auditPass.isOwnedCopy(args.source, args.target, args.targetStat)) {
    return false
  }
  const sourceStat = await readCodexSessionTargetStat(args.source)
  if (!sourceStat || sourceStat.size <= args.targetStat.size) {
    return false
  }
  try {
    await replaceOwnedSessionCopy(args.source, args.target, args.targetStat)
    args.summary.copiedFiles += 1
    await args.auditPass.recordPublished(args.summary, 'copy', args.source, args.target)
  } catch (error) {
    args.summary.failedFiles += 1
    await args.auditPass.recordDiagnostic(
      {
        action: 'failed',
        source: args.source,
        target: args.target,
        error: describeError(error),
        errorCode: describeCodexSessionBackfillErrorCode(error)
      },
      sourceStat
    )
  }
  return true
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
