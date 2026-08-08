const DAEMON_SCROLLBACK_ENV_VAR = 'ORCA_DAEMON_SCROLLBACK_BUDGET_CELLS'
const DAEMON_SCROLLBACK_REFERENCE_COLUMNS = 80
const HEADLESS_EMULATOR_MIN_COLUMNS = 2

/** Depth a session retains while the daemon is under budget; matches HeadlessEmulator's default. */
export const DAEMON_SCROLLBACK_FULL_ROWS = 5000
// Why: below this a reattach can lose the command that produced the visible screen.
export const DAEMON_SCROLLBACK_PREFERRED_MIN_ROWS = 500
// 128k rows at 80 columns keeps 25 standard-width sessions at full depth.
export const DAEMON_SCROLLBACK_BUDGET_CELLS = 128_000 * DAEMON_SCROLLBACK_REFERENCE_COLUMNS

function parseBudgetOverrideCells(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }
  const normalized = value.trim()
  if (!/^[1-9]\d*$/.test(normalized)) {
    return undefined
  }
  const parsed = Number(normalized)
  // The override may tighten the safety bound, never silently weaken it.
  if (!Number.isSafeInteger(parsed) || parsed > DAEMON_SCROLLBACK_BUDGET_CELLS) {
    return undefined
  }
  return parsed
}

export function resolveDaemonScrollbackBudgetCells(env: NodeJS.ProcessEnv = process.env): number {
  return parseBudgetOverrideCells(env[DAEMON_SCROLLBACK_ENV_VAR]) ?? DAEMON_SCROLLBACK_BUDGET_CELLS
}

function normalizeColumns(columns: number): number {
  return Number.isFinite(columns) && columns >= 1
    ? Math.max(HEADLESS_EMULATOR_MIN_COLUMNS, Math.floor(columns))
    : DAEMON_SCROLLBACK_REFERENCE_COLUMNS
}

function rowsForCellShare(columns: number, cellShare: number, minimumRows: number): number {
  return Math.min(
    DAEMON_SCROLLBACK_FULL_ROWS,
    Math.max(minimumRows, Math.floor(cellShare / columns))
  )
}

/** Max-min-fair row limits under a deterministic aggregate grid-cell capacity. */
export function allocateSessionScrollbackRows(
  sessionColumns: readonly number[],
  options: { budgetCells?: number } = {}
): number[] {
  if (sessionColumns.length === 0) {
    return []
  }
  const columns = sessionColumns.map(normalizeColumns)
  const configuredBudget = options.budgetCells
  const budgetCells =
    configuredBudget !== undefined &&
    Number.isSafeInteger(configuredBudget) &&
    configuredBudget > 0 &&
    configuredBudget <= DAEMON_SCROLLBACK_BUDGET_CELLS
      ? configuredBudget
      : DAEMON_SCROLLBACK_BUDGET_CELLS
  const fullDepthCells = columns.reduce(
    (total, cols) => total + cols * DAEMON_SCROLLBACK_FULL_ROWS,
    0
  )
  if (fullDepthCells <= budgetCells) {
    return columns.map(() => DAEMON_SCROLLBACK_FULL_ROWS)
  }
  const preferredFloorCells = columns.reduce(
    (total, cols) => total + cols * DAEMON_SCROLLBACK_PREFERRED_MIN_ROWS,
    0
  )
  const minimumRows = preferredFloorCells <= budgetCells ? DAEMON_SCROLLBACK_PREFERRED_MIN_ROWS : 0

  const fits = (cellShare: number): boolean => {
    let totalCells = 0
    for (const cols of columns) {
      totalCells += cols * rowsForCellShare(cols, cellShare, minimumRows)
      if (totalCells > budgetCells) {
        return false
      }
    }
    return true
  }

  let low = 0
  let high = budgetCells
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2)
    if (fits(mid)) {
      low = mid
    } else {
      high = mid - 1
    }
  }
  return columns.map((cols) => rowsForCellShare(cols, low, minimumRows))
}
