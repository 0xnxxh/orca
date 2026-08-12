import { describe, expect, it } from 'vitest'
import { LOCAL_PTY_STARTUP_FAIL_OPEN_TIMEOUT_MS } from '../startup/first-window-startup-services'
import { WEDGED_DAEMON_CLASSIFICATION_BUDGET_MS } from './daemon-init'

/**
 * Kept out of the launcher's own spec because that file mocks daemon-health, which would
 * shadow constants this is here to hold to account.
 *
 * This deliberately asserts one enforced ceiling rather than a sum of the path's parts. The
 * sum was the earlier design, and four separate reviews each found a different term missing
 * from it — the launcher's own adoption connect, an identity probe, an endpoint probe, an
 * evidence deadline applied twice. Every one of them passed this file while the real path
 * overran. The launcher now spends against a clock, so the only thing left worth asserting
 * is that the clock leaves room for what comes after it.
 */
describe('wedged-daemon classification budget', () => {
  it('leaves the kill ladder and the daemon fork room under the startup fail-open', () => {
    // Startup abandons the daemon provider entirely at the cap, and ensureRunning() is not
    // abortable — so overrunning costs the app its daemon *and* still kills the incumbent.
    // What follows a replace verdict is the kill ladder (~10s: identity, SIGTERM, wait,
    // recheck, SIGKILL confirm) and the fork's own 10s readiness timeout.
    const afterClassificationMs =
      LOCAL_PTY_STARTUP_FAIL_OPEN_TIMEOUT_MS - WEDGED_DAEMON_CLASSIFICATION_BUDGET_MS

    expect(WEDGED_DAEMON_CLASSIFICATION_BUDGET_MS).toBeLessThan(
      LOCAL_PTY_STARTUP_FAIL_OPEN_TIMEOUT_MS
    )
    expect(afterClassificationMs).toBeGreaterThanOrEqual(20_000)
  })
})
