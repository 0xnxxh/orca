import { MobileEndpointHysteresis } from './mobile-endpoint-hysteresis'

export type { MobileEndpointHysteresis } from './mobile-endpoint-hysteresis'

const DIRECT_OBSERVATION_MS = 30_000
const MINIMUM_DWELL_MS = 60_000
const FAILURE_COOLDOWN_MS = 60_000

export function createMobileEndpointHysteresis(now: number): MobileEndpointHysteresis {
  return new MobileEndpointHysteresis(now, {
    directSuccessesRequired: 3,
    directObservationMs: DIRECT_OBSERVATION_MS,
    failureCooldownMs: FAILURE_COOLDOWN_MS,
    minimumDwellMs: MINIMUM_DWELL_MS
  })
}
