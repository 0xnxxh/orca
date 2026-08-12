import { describe, expect, it } from 'vitest'
import { LOCAL_PTY_STARTUP_FAIL_OPEN_TIMEOUT_MS } from '../startup/first-window-startup-services'
import { WEDGED_DAEMON_GRACE_BUDGET_MS } from './daemon-init'
import { HEALTH_CHECK_TIMEOUT_MS } from './daemon-health'
import { OCCUPANCY_IPC_BUDGET_MS } from './daemon-occupancy'
import { ENDPOINT_PROBE_TIMEOUT_MS } from './daemon-endpoint-probe'
import {
  POSIX_OWNERSHIP_PROBE_DEADLINE_MS,
  PTY_OWNERSHIP_PROBE_ATTEMPTS
} from './daemon-live-pty-evidence'

/**
 * Kept out of the launcher's own spec because that file mocks daemon-health, which would
 * shadow the very constants this is here to hold to account.
 */
describe('wedged-daemon classification budget', () => {
  it.each([
    // Identity probe: a synchronous `ps -p` on POSIX, a powershell CIM query on Windows.
    // Windows reads no process table at all, so its evidence deadline is zero.
    ['posix', POSIX_OWNERSHIP_PROBE_DEADLINE_MS, 2_000],
    ['win32', 0, 3_000]
  ])(
    'is spent well inside the startup fail-open cap on %s',
    (_platform, evidenceDeadlineMs, identityProbeMs) => {
      // Why sum the declared budgets rather than compare one of them: startup abandons the
      // daemon provider entirely at the cap, and classification is only the first half of the
      // path — a replacement still has to be killed and forked after it. Comparing the grace
      // window alone passed while the real path ran to ~112s, because one probe cost 50s
      // against a 5s assumption. Raising any term below now has to face this.
      const classificationMs =
        HEALTH_CHECK_TIMEOUT_MS +
        WEDGED_DAEMON_GRACE_BUDGET_MS +
        // The ceiling is tested at loop entry, so one probe — connect, then request — plus the
        // endpoint check that ends the loop always run past it.
        OCCUPANCY_IPC_BUDGET_MS * 2 +
        ENDPOINT_PROBE_TIMEOUT_MS +
        // Identity is re-verified before the evidence read, and again inside killStaleDaemon —
        // the second one fences the signal to this incarnation, so it must not be reused.
        identityProbeMs +
        evidenceDeadlineMs * PTY_OWNERSHIP_PROBE_ATTEMPTS

      expect(classificationMs).toBeLessThan(LOCAL_PTY_STARTUP_FAIL_OPEN_TIMEOUT_MS)
      // Headroom the kill ladder (~10s) and the daemon fork (10s) still need after a replace
      // verdict. Classification is only the first half of the path.
      expect(LOCAL_PTY_STARTUP_FAIL_OPEN_TIMEOUT_MS - classificationMs).toBeGreaterThanOrEqual(
        22_000
      )
    }
  )
})
