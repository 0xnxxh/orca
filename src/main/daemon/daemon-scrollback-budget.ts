const DAEMON_SCROLLBACK_ENV_VAR = 'ORCA_DAEMON_SCROLLBACK_BUDGET_ROWS'

/** Depth a session retains while the daemon is under budget; matches HeadlessEmulator's default. */
export const DAEMON_SCROLLBACK_FULL_ROWS = 5000
// Why: below this a reattach loses the command that produced the visible screen, which reads as data loss
// rather than degradation. Bounded growth past the floor is preferable to an unusable restore.
export const DAEMON_SCROLLBACK_MIN_ROWS = 500
// Why: retained rows are the daemon's dominant heap term (an xterm row is ~2 KB at typical widths), and
// session count is unbounded — a host owning 100+ terminals retained ~1 GB of grid and was OOM-killed,
// taking its sessions with it. ~128k rows caps the grid near 256 MB, which is ~25 sessions at full depth.
export const DAEMON_SCROLLBACK_BUDGET_ROWS = 128_000

function parseBudgetOverrideRows(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }
  const parsed = Number(value.trim())
  // Why: ignore an unparseable or non-positive override rather than disabling the budget entirely —
  // an unbounded daemon is the failure this module exists to prevent.
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined
  }
  return Math.floor(parsed)
}

/**
 * Rows each live session may retain so the daemon's total stays within the budget. Full depth until the
 * budget binds, then an even split down to the floor. Pure so the tiers are unit-testable without a daemon.
 */
export function computeSessionScrollbackRows(
  liveSessionCount: number,
  options: { budgetRows?: number; env?: NodeJS.ProcessEnv } = {}
): number {
  const budgetRows =
    options.budgetRows ??
    parseBudgetOverrideRows((options.env ?? process.env)[DAEMON_SCROLLBACK_ENV_VAR]) ??
    DAEMON_SCROLLBACK_BUDGET_ROWS
  if (!Number.isFinite(liveSessionCount) || liveSessionCount <= 1) {
    return DAEMON_SCROLLBACK_FULL_ROWS
  }
  const evenShare = Math.floor(budgetRows / liveSessionCount)
  return Math.min(DAEMON_SCROLLBACK_FULL_ROWS, Math.max(DAEMON_SCROLLBACK_MIN_ROWS, evenShare))
}
