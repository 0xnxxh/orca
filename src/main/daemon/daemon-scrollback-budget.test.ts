import { describe, expect, it } from 'vitest'
import {
  computeSessionScrollbackRows,
  DAEMON_SCROLLBACK_BUDGET_ROWS,
  DAEMON_SCROLLBACK_FULL_ROWS,
  DAEMON_SCROLLBACK_MIN_ROWS
} from './daemon-scrollback-budget'

describe('computeSessionScrollbackRows', () => {
  it('keeps full depth while the budget is not binding', () => {
    expect(computeSessionScrollbackRows(1, { budgetRows: 100_000 })).toBe(
      DAEMON_SCROLLBACK_FULL_ROWS
    )
    expect(computeSessionScrollbackRows(20, { budgetRows: 100_000 })).toBe(
      DAEMON_SCROLLBACK_FULL_ROWS
    )
  })

  it('splits the budget evenly once it binds', () => {
    expect(computeSessionScrollbackRows(40, { budgetRows: 100_000 })).toBe(2500)
    expect(computeSessionScrollbackRows(50, { budgetRows: 100_000 })).toBe(2000)
  })

  it('never drops below the floor', () => {
    expect(computeSessionScrollbackRows(10_000, { budgetRows: 100_000 })).toBe(
      DAEMON_SCROLLBACK_MIN_ROWS
    )
  })

  it('holds total retained rows within the budget until the floor binds', () => {
    for (const sessions of [30, 60, 120, 200]) {
      const total = computeSessionScrollbackRows(sessions, { budgetRows: 100_000 }) * sessions
      expect(total).toBeLessThanOrEqual(100_000)
    }
  })

  it('lets the floor override the budget, trading bounded growth for a usable restore', () => {
    // Past ~200 sessions the even split would fall below MIN_ROWS, which reads as data loss on
    // reattach. Growth past that point is deliberate but shallow: 500 rows, not 5000.
    const perSession = computeSessionScrollbackRows(1000, { budgetRows: 100_000 })
    expect(perSession).toBe(DAEMON_SCROLLBACK_MIN_ROWS)
    expect(perSession * 1000).toBeGreaterThan(100_000)
    expect(perSession * 1000).toBeLessThan(DAEMON_SCROLLBACK_FULL_ROWS * 1000)
  })

  it('caps the session count that broke the Windows host well below its old retention', () => {
    // 100+ live terminals previously retained 100 x 5000 = 500k rows (~1 GB of grid).
    const perSession = computeSessionScrollbackRows(100)
    expect(perSession).toBeLessThan(DAEMON_SCROLLBACK_FULL_ROWS)
    expect(perSession * 100).toBeLessThanOrEqual(DAEMON_SCROLLBACK_BUDGET_ROWS)
  })

  it('treats a degenerate session count as a single session', () => {
    expect(computeSessionScrollbackRows(0)).toBe(DAEMON_SCROLLBACK_FULL_ROWS)
    expect(computeSessionScrollbackRows(Number.NaN)).toBe(DAEMON_SCROLLBACK_FULL_ROWS)
  })

  it('accepts an env override and ignores an unusable one', () => {
    const env = { ORCA_DAEMON_SCROLLBACK_BUDGET_ROWS: '20000' } as NodeJS.ProcessEnv
    expect(computeSessionScrollbackRows(10, { env })).toBe(2000)
    // Why: an unparseable or non-positive override must not disable the budget — unbounded is the bug.
    for (const raw of ['nonsense', '0', '-5']) {
      const bad = { ORCA_DAEMON_SCROLLBACK_BUDGET_ROWS: raw } as NodeJS.ProcessEnv
      expect(computeSessionScrollbackRows(100, { env: bad })).toBe(
        computeSessionScrollbackRows(100, { budgetRows: DAEMON_SCROLLBACK_BUDGET_ROWS })
      )
    }
  })
})
