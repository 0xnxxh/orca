import type { IPtyProvider } from '../providers/types'
import { settleBeforeDeadline } from './settle-before-deadline'

// Why (#11960): the sweeps normally spend the whole teardown deadline, so
// re-listing on that same budget answered "unverifiable" for PTYs that had
// already exited and wedged the workspace forever. Verification gets its own
// small window instead of inheriting an exhausted one.
export const WORKTREE_TEARDOWN_VERIFY_GRACE_MS = 2_000

export type UnstoppedPtyVerdict =
  | { status: 'exited' }
  | { status: 'live'; ptyIds: string[] }
  | { status: 'unverifiable'; reason: string }

/**
 * Re-lists the provider's processes to decide what a failed stop RPC actually
 * meant. The three verdicts stay distinct on purpose: "we could not ask" is not
 * evidence that a PTY survived, and callers word their errors differently.
 */
export async function verifyUnstoppedPtys(
  failedPtyIds: readonly string[],
  provider: IPtyProvider,
  deadline: number
): Promise<UnstoppedPtyVerdict> {
  const verifyDeadline = Math.max(deadline, Date.now() + WORKTREE_TEARDOWN_VERIFY_GRACE_MS)
  let listError: unknown
  const sessions = await settleBeforeDeadline(
    async () => {
      try {
        return await provider.listProcesses({ deadlineMs: verifyDeadline })
      } catch (error) {
        listError = error
        return null
      }
    },
    null,
    verifyDeadline
  )
  if (!sessions) {
    return {
      status: 'unverifiable',
      reason: listError instanceof Error ? listError.message : 'the process list timed out'
    }
  }
  const livePtyIds = new Set(sessions.map((session) => session.id))
  const stillLive = failedPtyIds.filter((ptyId) => livePtyIds.has(ptyId))
  return stillLive.length > 0 ? { status: 'live', ptyIds: stillLive } : { status: 'exited' }
}

/** Names the blocking PTYs so a wedged removal is diagnosable, not just refused. */
export function describeUnstoppedPtys(
  worktreeId: string,
  failedPtyIds: readonly string[],
  verdict: Exclude<UnstoppedPtyVerdict, { status: 'exited' }>
): string {
  const detail =
    verdict.status === 'live'
      ? `still live: ${verdict.ptyIds.join(', ')}`
      : `could not verify these exited: ${failedPtyIds.join(', ')} (${verdict.reason})`
  return `Failed to physically stop every PTY for worktree: ${worktreeId} — ${detail}`
}
