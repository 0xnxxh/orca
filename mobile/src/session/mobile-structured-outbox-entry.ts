import { classifyStructuredAgentSessionSendFailure } from '../../../src/shared/structured-agent-session-outbox'
import { isRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { isLogicalClientCutoverError } from '../transport/stable-logical-rpc-client'

export {
  createStructuredAgentSessionOutboxEntry as createMobileStructuredOutboxEntry,
  reconcileStructuredAgentSessionOutbox as reconcileMobileStructuredOutbox,
  structuredAgentSessionSendBody as mobileStructuredSendBody,
  updateStructuredAgentSessionOutboxEntry as updateMobileStructuredOutboxEntry
} from '../../../src/shared/structured-agent-session-outbox'

export function isMobileStructuredDeliveryUnknown(error: unknown): boolean {
  return (
    classifyStructuredAgentSessionSendFailure(
      error,
      (candidate) => isRpcDeliveryUnknown(candidate) || isLogicalClientCutoverError(candidate)
    ) === 'delivery-unknown'
  )
}
