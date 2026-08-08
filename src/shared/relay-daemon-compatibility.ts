import { TERMINAL_AUTHORITY_TOPOLOGY_STREAM_CAPABILITY } from './terminal-authority-topology-stream-contract'
import { TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_CAPABILITY } from './terminal-session-authority-consumer-transport'

export const RELAY_DAEMON_PROTOCOL_MAJOR = 1
export const RELAY_DAEMON_PROTOCOL_MINOR = 0

export const RELAY_DAEMON_CAPABILITIES = [
  'relay.rpc.v1',
  'terminal-session.authority.v1',
  'terminal-session.distributed-control.v1',
  'remote-cli.relay-install.v1',
  TERMINAL_AUTHORITY_TOPOLOGY_STREAM_CAPABILITY,
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_CAPABILITY
] as const

export const RELAY_DAEMON_REQUIRED_CAPABILITIES = [
  'relay.rpc.v1',
  'terminal-session.authority.v1',
  'terminal-session.distributed-control.v1',
  'remote-cli.relay-install.v1'
] as const

export type RelayDaemonCapability = (typeof RELAY_DAEMON_CAPABILITIES)[number]

export type RelayDaemonCompatibilityOffer = {
  major: number
  minMinor: number
  maxMinor: number
  capabilities: string[]
  requiredCapabilities: string[]
}

export type RelayDaemonCompatibilityGrant = {
  major: number
  minor: number
  capabilities: string[]
}

export const CURRENT_RELAY_DAEMON_COMPATIBILITY: RelayDaemonCompatibilityOffer = Object.freeze({
  major: RELAY_DAEMON_PROTOCOL_MAJOR,
  minMinor: RELAY_DAEMON_PROTOCOL_MINOR,
  maxMinor: RELAY_DAEMON_PROTOCOL_MINOR,
  capabilities: [...RELAY_DAEMON_CAPABILITIES],
  requiredCapabilities: [...RELAY_DAEMON_REQUIRED_CAPABILITIES]
})

function isSafeProtocolNumber(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function boundedStringSet(value: unknown): Set<string> | null {
  if (!Array.isArray(value) || value.length > 128) {
    return null
  }
  const result = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 128) {
      return null
    }
    result.add(entry)
  }
  return result
}

export function parseRelayDaemonCompatibilityOffer(
  value: unknown
): RelayDaemonCompatibilityOffer | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const offer = value as Partial<RelayDaemonCompatibilityOffer>
  const capabilities = boundedStringSet(offer.capabilities)
  const requiredCapabilities = boundedStringSet(offer.requiredCapabilities)
  if (
    !isSafeProtocolNumber(offer.major) ||
    !isSafeProtocolNumber(offer.minMinor) ||
    !isSafeProtocolNumber(offer.maxMinor) ||
    offer.minMinor > offer.maxMinor ||
    !capabilities ||
    !requiredCapabilities
  ) {
    return null
  }
  for (const required of requiredCapabilities) {
    if (!capabilities.has(required)) {
      return null
    }
  }
  return {
    major: offer.major,
    minMinor: offer.minMinor,
    maxMinor: offer.maxMinor,
    capabilities: [...capabilities],
    requiredCapabilities: [...requiredCapabilities]
  }
}

export function negotiateRelayDaemonCompatibility(
  serverValue: unknown,
  clientValue: unknown
): RelayDaemonCompatibilityGrant | null {
  const server = parseRelayDaemonCompatibilityOffer(serverValue)
  const client = parseRelayDaemonCompatibilityOffer(clientValue)
  if (!server || !client || server.major !== client.major) {
    return null
  }
  const minMinor = Math.max(server.minMinor, client.minMinor)
  const maxMinor = Math.min(server.maxMinor, client.maxMinor)
  if (minMinor > maxMinor) {
    return null
  }
  const serverCapabilities = new Set(server.capabilities)
  const clientCapabilities = new Set(client.capabilities)
  if (
    server.requiredCapabilities.some((capability) => !clientCapabilities.has(capability)) ||
    client.requiredCapabilities.some((capability) => !serverCapabilities.has(capability))
  ) {
    return null
  }
  return {
    major: server.major,
    minor: maxMinor,
    capabilities: server.capabilities.filter((capability) => clientCapabilities.has(capability))
  }
}

export function relayDaemonGrantSatisfiesOffer(
  grantValue: unknown,
  offerValue: unknown
): grantValue is RelayDaemonCompatibilityGrant {
  const offer = parseRelayDaemonCompatibilityOffer(offerValue)
  if (!offer || typeof grantValue !== 'object' || grantValue === null) {
    return false
  }
  const grant = grantValue as Partial<RelayDaemonCompatibilityGrant>
  const capabilities = boundedStringSet(grant.capabilities)
  return Boolean(
    grant.major === offer.major &&
    isSafeProtocolNumber(grant.minor) &&
    grant.minor >= offer.minMinor &&
    grant.minor <= offer.maxMinor &&
    capabilities &&
    offer.requiredCapabilities.every((capability) => capabilities.has(capability))
  )
}
