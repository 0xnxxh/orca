import type { CreateWorktreeResult } from '../../../shared/types'

// Why: local create steps are individually bounded but SSH/relay creates are not; without an
// end-to-end ceiling any wedged main-side step spins the creation panel forever with no Retry.
// Matches the remote-runtime create RPC's own 10-minute cap.
export const WORKTREE_CREATE_WATCHDOG_MS = 10 * 60_000

export function withCreateWatchdog(
  create: Promise<CreateWorktreeResult>
): Promise<CreateWorktreeResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Why: the main-side create may still finish after this fires — the worktree then
      // reconciles in via worktrees:changed, so timing out here strands nothing.
      reject(
        new Error('Timed out creating the workspace. Retry — if it keeps happening, restart Orca.')
      )
    }, WORKTREE_CREATE_WATCHDOG_MS)
    create.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}
