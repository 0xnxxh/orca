import { SSH_RELAY_CONFIGURE_GRACE_TIME_METHOD } from '../shared/ssh-types'
import { legacyPhysicalWorkerMethodMissing } from './legacy-physical-worker-negotiation'
import type { LegacyPhysicalWorkerRpc } from './legacy-physical-worker-client'

export async function prepareLegacyPhysicalWorkerCutoverGrace(
  rpc: LegacyPhysicalWorkerRpc,
  onReady: () => void
): Promise<Readonly<{ status: 'ready' }> | Readonly<{ status: 'unsupported'; reason: string }>> {
  let result: unknown
  try {
    result = await rpc.request(SSH_RELAY_CONFIGURE_GRACE_TIME_METHOD, { graceTimeSeconds: 0 })
  } catch (error) {
    if (legacyPhysicalWorkerMethodMissing(error)) {
      return Object.freeze({ status: 'unsupported', reason: 'zero-grace-unsupported' })
    }
    throw error
  }
  if (
    typeof result !== 'object' ||
    result === null ||
    (result as { graceTimeMs?: unknown }).graceTimeMs !== 0
  ) {
    return Object.freeze({ status: 'unsupported', reason: 'zero-grace-not-acknowledged' })
  }
  onReady()
  return Object.freeze({ status: 'ready' })
}
