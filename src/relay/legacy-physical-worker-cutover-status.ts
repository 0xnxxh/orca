import type { LegacyRelayStatusSample } from './legacy-relay-broker-connection-proof'

export function parseLegacyPhysicalWorkerCutoverStatus(
  value: unknown,
  brokerConnectionIdentity: string
): LegacyRelayStatusSample {
  if (typeof value !== 'object' || value === null) {
    throw new Error('legacy physical worker status is invalid')
  }
  const status = value as Record<string, unknown>
  const socket = status.socket
  if (typeof socket !== 'object' || socket === null) {
    throw new Error('legacy physical worker socket status is unavailable')
  }
  const socketStatus = socket as Record<string, unknown>
  if (
    !positiveInteger(status.pid) ||
    typeof socketStatus.path !== 'string' ||
    !socketStatus.path ||
    typeof socketStatus.listening !== 'boolean' ||
    !nonNegativeInteger(socketStatus.clients) ||
    !nonNegativeInteger(socketStatus.acceptedConnections)
  ) {
    throw new Error('legacy physical worker status identity is invalid')
  }
  return Object.freeze({
    pid: status.pid,
    legacyCutover: Object.freeze({
      capabilityVersion: 1,
      configuredGraceMs: 0,
      acknowledged: true,
      brokerConnectionIdentity
    }),
    socket: Object.freeze({
      path: socketStatus.path,
      listening: socketStatus.listening,
      clients: socketStatus.clients,
      acceptedConnections: socketStatus.acceptedConnections
    })
  })
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}
