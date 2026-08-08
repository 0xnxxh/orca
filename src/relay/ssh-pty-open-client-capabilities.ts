import type { PtyConsumerRole, PtyConsumerSessionHello } from '../shared/pty-consumer-session'
import { parseTerminalAuthorityPolicyConsumerIdentity } from '../shared/terminal-session-authority-consumer-transport'

type RawCapabilities = Record<string, unknown>
type HelloCapabilities = NonNullable<PtyConsumerSessionHello['capabilities']>

// Authority capabilities are role-gated to `session-owner`, and `terminalAuthorityTopology` is never
// carried through: `TerminalAuthorityTopologyGateway` mints that grant and strips the offer before it
// reaches this generic adapter, so anything still present is a bypass, not a negotiation.
export function parseOpenClientCapabilities(
  params: Record<string, unknown>,
  requestedRole: PtyConsumerRole
): Pick<PtyConsumerSessionHello, 'capabilities'> {
  const capabilities = record(params.capabilities)
  if (!capabilities) {
    return {}
  }
  const authorityOwner = requestedRole === 'session-owner'
  const parsed: HelloCapabilities = {
    ...outputFlowControl(capabilities),
    ...versionedOffer(capabilities, 'exactOperations'),
    ...versionedOffer(capabilities, 'heldProducerPause'),
    ...(authorityOwner
      ? {
          ...versionedOffer(capabilities, 'terminalAuthorityExactOperations'),
          ...versionedOffer(capabilities, 'terminalAuthorityOutcomeDelivery'),
          ...namespaceOutcomes(capabilities),
          ...consumerProof(capabilities)
        }
      : {})
  }
  return Object.keys(parsed).length > 0 ? { capabilities: parsed } : {}
}

function outputFlowControl(capabilities: RawCapabilities): HelloCapabilities {
  const offer = record(capabilities.outputFlowControl)
  return offer
    ? {
        outputFlowControl: {
          versions: numericVersions(offer.versions),
          requestedWindowSu: Number(offer.requestedWindowSu)
        }
      }
    : {}
}

function versionedOffer<
  Name extends
    | 'exactOperations'
    | 'heldProducerPause'
    | 'terminalAuthorityExactOperations'
    | 'terminalAuthorityOutcomeDelivery'
>(capabilities: RawCapabilities, name: Name): HelloCapabilities {
  const offer = record(capabilities[name])
  return offer
    ? ({ [name]: { versions: numericVersions(offer.versions) } } as HelloCapabilities)
    : {}
}

// An unvalidatable consumer drops the capability: that identity is what a durable claim is attributed to.
function namespaceOutcomes(capabilities: RawCapabilities): HelloCapabilities {
  const offer = record(capabilities.terminalAuthorityNamespaceOutcomes)
  const consumer = offer && parseTerminalAuthorityPolicyConsumerIdentity(offer.consumer)
  if (!offer || !consumer) {
    return {}
  }
  return {
    terminalAuthorityNamespaceOutcomes: {
      versions: numericVersions(offer.versions),
      consumer,
      expectedConsumerIncarnationId:
        offer.expectedConsumerIncarnationId === null
          ? null
          : String(offer.expectedConsumerIncarnationId ?? '')
    }
  }
}

function consumerProof(capabilities: RawCapabilities): HelloCapabilities {
  const offer = record(capabilities.terminalAuthorityConsumerProof)
  if (!offer) {
    return {}
  }
  return {
    terminalAuthorityConsumerProof: {
      versions: numericVersions(offer.versions),
      // Absent stays absent so an old peer is not read as offering an empty retirement set.
      ...(offer.retirementVersions !== undefined
        ? { retirementVersions: numericVersions(offer.retirementVersions) }
        : {})
    }
  }
}

function record(value: unknown): RawCapabilities | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RawCapabilities)
    : undefined
}

function numericVersions(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number) : []
}
