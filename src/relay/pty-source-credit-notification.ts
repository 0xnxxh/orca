import { notifyPtySourceCreditAvailable } from './pty-source-credit-availability-notice'
import type { PtySourceDeliveryIdentity } from '../shared/pty-source-credit-contract'

export function notifyPtySourceCreditAvailability(
  onCreditAvailable: ((id: string) => void) | undefined,
  onExactCreditAvailable: ((identity: PtySourceDeliveryIdentity) => void) | undefined,
  identity: PtySourceDeliveryIdentity
): void {
  notifyPtySourceCreditAvailable(onCreditAvailable, identity.id)
  try {
    onExactCreditAvailable?.(identity)
  } catch (error) {
    process.stderr.write(
      `[pty-source-credit] exact credit-available notification failed for ${identity.id}: ${
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      }\n`
    )
  }
}
