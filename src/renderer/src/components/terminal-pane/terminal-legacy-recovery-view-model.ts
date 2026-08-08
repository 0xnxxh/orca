import type {
  TerminalLegacyPreservationFacts,
  TerminalLegacyRecoveryReason
} from '../../../../shared/terminal-legacy-cutover'

type TerminalLegacyRecoveryNoticeBase = Readonly<{
  recoveryKey: string
  workspaceKind: 'git-worktree' | 'folder' | 'floating'
  evidenceDigest: string
  observedAtMs: number
  discoveredAtMs: number
  updatedAtMs: number
}>

export type TerminalLegacyUnresolvedRecoveryNotice = TerminalLegacyRecoveryNoticeBase &
  Readonly<{
    status: 'unresolved'
    reason: TerminalLegacyRecoveryReason
    preservationKind: TerminalLegacyPreservationFacts['kind']
  }>

export type TerminalLegacyRecoveryNotice =
  | TerminalLegacyUnresolvedRecoveryNotice
  | (TerminalLegacyRecoveryNoticeBase & Readonly<{ status: 'imported' }>)
  | (TerminalLegacyRecoveryNoticeBase &
      Readonly<{
        status: 'acknowledged'
        reason: TerminalLegacyRecoveryReason
        preservationKind: TerminalLegacyPreservationFacts['kind']
      }>)

export function selectUnresolvedLegacyRecoveries(
  recoveries: readonly TerminalLegacyRecoveryNotice[]
): readonly TerminalLegacyUnresolvedRecoveryNotice[] {
  return Object.freeze(
    recoveries.filter(
      (recovery): recovery is TerminalLegacyUnresolvedRecoveryNotice =>
        recovery.status === 'unresolved'
    )
  )
}

export function formatLegacyRecoveryDetailsForClipboard(
  recovery: TerminalLegacyUnresolvedRecoveryNotice
): string {
  return JSON.stringify(
    {
      kind: 'orca-terminal-legacy-recovery',
      formatVersion: 1,
      reason: recovery.reason,
      preservationKind: recovery.preservationKind,
      workspaceKind: recovery.workspaceKind,
      evidenceDigest: recovery.evidenceDigest,
      observedAtMs: recovery.observedAtMs,
      discoveredAtMs: recovery.discoveredAtMs,
      updatedAtMs: recovery.updatedAtMs
    },
    null,
    2
  )
}
