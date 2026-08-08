import { describe, expect, it } from 'vitest'
import {
  allocateSessionScrollbackRows,
  DAEMON_SCROLLBACK_BUDGET_CELLS,
  DAEMON_SCROLLBACK_FULL_ROWS,
  DAEMON_SCROLLBACK_PREFERRED_MIN_ROWS,
  resolveDaemonScrollbackBudgetCells
} from './daemon-scrollback-budget'

function retainedCells(columns: readonly number[], rows: readonly number[]): number {
  return rows.reduce((total, rowCount, index) => total + rowCount * columns[index], 0)
}

describe('allocateSessionScrollbackRows', () => {
  it('preserves full restore depth whenever every session fits', () => {
    expect(allocateSessionScrollbackRows(Array(25).fill(80))).toEqual(Array(25).fill(5000))
    expect(allocateSessionScrollbackRows(Array(12).fill(160))).toEqual(Array(12).fill(5000))
    expect(allocateSessionScrollbackRows([400])).toEqual([5000])
  })

  it('matches the row-budget behavior for equal-width sessions', () => {
    expect(allocateSessionScrollbackRows(Array(26).fill(80))).toEqual(
      Array(26).fill(Math.floor(DAEMON_SCROLLBACK_BUDGET_CELLS / 26 / 80))
    )
    expect(allocateSessionScrollbackRows(Array(40).fill(80), { budgetCells: 8_000_000 })).toEqual(
      Array(40).fill(2500)
    )
  })

  it('returns unused narrow-session capacity to wider sessions', () => {
    const columns = [...Array(20).fill(40), ...Array(20).fill(120)]
    const rows = allocateSessionScrollbackRows(columns, { budgetCells: 8_000_000 })

    expect(rows.slice(0, 20)).toEqual(Array(20).fill(DAEMON_SCROLLBACK_FULL_ROWS))
    expect(new Set(rows.slice(20))).toEqual(new Set([1666]))
    expect(retainedCells(columns, rows)).toBeLessThanOrEqual(8_000_000)
  })

  it('holds configured scrollback cells within the budget across widths', () => {
    for (const columns of [
      Array(100).fill(80),
      Array(100).fill(160),
      [...Array(60).fill(40), ...Array(60).fill(200)]
    ]) {
      const rows = allocateSessionScrollbackRows(columns)
      expect(retainedCells(columns, rows)).toBeLessThanOrEqual(DAEMON_SCROLLBACK_BUDGET_CELLS)
    }
  })

  it('keeps the preferred floor while it fits', () => {
    const columns = Array(200).fill(100)
    const rows = allocateSessionScrollbackRows(columns)

    expect(Math.min(...rows)).toBeGreaterThanOrEqual(DAEMON_SCROLLBACK_PREFERRED_MIN_ROWS)
  })

  it('lets the hard capacity win once the preferred floor cannot fit', () => {
    const columns = Array(1000).fill(80)
    const rows = allocateSessionScrollbackRows(columns)

    expect(new Set(rows)).toEqual(new Set([128]))
    expect(retainedCells(columns, rows)).toBeLessThanOrEqual(DAEMON_SCROLLBACK_BUDGET_CELLS)
  })

  it('uses a conservative standard width for invalid column counts', () => {
    expect(allocateSessionScrollbackRows(Array(30).fill(Number.NaN))).toEqual(
      allocateSessionScrollbackRows(Array(30).fill(80))
    )
  })

  it('accounts for the headless emulator minimum width', () => {
    expect(allocateSessionScrollbackRows([1, ...Array(26).fill(80)])).toEqual(
      allocateSessionScrollbackRows([2, ...Array(26).fill(80)])
    )
  })
})

describe('resolveDaemonScrollbackBudgetCells', () => {
  it('accepts a tighter base-10 integer override', () => {
    expect(
      resolveDaemonScrollbackBudgetCells({
        ORCA_DAEMON_SCROLLBACK_BUDGET_CELLS: '1600000'
      } as NodeJS.ProcessEnv)
    ).toBe(1_600_000)
  })

  it('rejects malformed values and values that weaken the bound', () => {
    for (const raw of ['', 'nonsense', '0', '-5', '1.5', '1e6', '0x100', '999999999999']) {
      expect(
        resolveDaemonScrollbackBudgetCells({
          ORCA_DAEMON_SCROLLBACK_BUDGET_CELLS: raw
        } as NodeJS.ProcessEnv)
      ).toBe(DAEMON_SCROLLBACK_BUDGET_CELLS)
    }
  })
})
