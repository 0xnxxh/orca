import { clearProcessedPtyCharTotal } from './terminal-pty-ack-gate'
import { clearReceivedPtyCharTotal } from './terminal-delivery-watchdog'
import {
  isEventKeyedPtyExitSnapshot,
  onPtyExitPolicyAvailable,
  releasePtyExitHandlers,
  settleAuthoritativePtyExitHandlers,
  snapshotPtyExitHandlers,
  type PtyExitDelivery
} from './pty-exit-delivery'

export async function applyAuthoritativePtyExit(
  delivery: Pick<PtyExitDelivery, 'ptyId' | 'code' | 'incarnationId' | 'authorityOutcome'>
): Promise<boolean> {
  const handlers = snapshotPtyExitHandlers(delivery.ptyId)
  if (
    (!handlers.primary && handlers.sidecars.length === 0) ||
    !isEventKeyedPtyExitSnapshot(handlers)
  ) {
    return false
  }
  await settleAuthoritativePtyExitHandlers({ ...delivery, ...handlers })
  clearProcessedPtyCharTotal(delivery.ptyId)
  clearReceivedPtyCharTotal(delivery.ptyId)
  releasePtyExitHandlers(delivery.ptyId, handlers)
  return true
}

export { onPtyExitPolicyAvailable as onAuthoritativePtyExitPolicyAvailable }
