import { posix, win32 } from 'node:path'
import type {
  TerminalLegacyCutoverProof,
  TerminalLegacyEndpointIdentity
} from '../shared/terminal-legacy-cutover'
import type { LegacyUnixSocketInspection } from './legacy-relay-unix-socket-inspection'

const MIN_QUIESCENCE_SAMPLES = 2
const MAX_QUIESCENCE_SAMPLES = 16

export type LegacyRelayStatusSample = Readonly<{
  pid: number
  legacyCutover: Readonly<{
    capabilityVersion: 1
    configuredGraceMs: 0
    acknowledged: true
    brokerConnectionIdentity: string
  }>
  socket: Readonly<{
    path: string
    listening: boolean
    clients: number
    acceptedConnections: number
  }>
}>

export type LegacyRelayBrokerConnectionEvidence = Readonly<{
  brokerConnectionIdentity: string
  brokerClientCount: 1
  acceptedConnectionCount: number
  quiescenceSamples: number
  endpointIdentity: TerminalLegacyEndpointIdentity
  connectionProof: TerminalLegacyCutoverProof['connectionProof']
  graceConfiguration: TerminalLegacyCutoverProof['graceConfiguration']
}>

type PlatformConnectionInspection =
  | LegacyUnixSocketInspection
  | Readonly<{
      method: 'windows-pipe-process'
      endpointIdentity: Extract<TerminalLegacyEndpointIdentity, { kind: 'windows-named-pipe' }>
      listenerIdentity: string
      acceptedServerConnections: 1
    }>

export function proveSoleLegacyRelayBroker(input: {
  endpointPath: string
  relayPid: number
  brokerConnectionIdentity: string
  samples: readonly LegacyRelayStatusSample[]
  platformInspection: PlatformConnectionInspection
}): LegacyRelayBrokerConnectionEvidence {
  assertBrokerConnectionIdentity(input.brokerConnectionIdentity)
  if (
    input.samples.length < MIN_QUIESCENCE_SAMPLES ||
    input.samples.length > MAX_QUIESCENCE_SAMPLES
  ) {
    throw new Error('legacy relay quiescence sample count is invalid')
  }
  if (input.platformInspection.acceptedServerConnections !== 1) {
    throw new Error('legacy relay platform inspection is not sole-client proof')
  }
  const windows = input.platformInspection.method === 'windows-pipe-process'
  const expectedEndpoint = normalizeEndpoint(input.endpointPath, windows)
  let acceptedConnectionCount: number | null = null
  for (const sample of input.samples) {
    if (
      sample.pid !== input.relayPid ||
      sample.legacyCutover.capabilityVersion !== 1 ||
      sample.legacyCutover.configuredGraceMs !== 0 ||
      sample.legacyCutover.acknowledged !== true ||
      sample.legacyCutover.brokerConnectionIdentity !== input.brokerConnectionIdentity ||
      !sample.socket.listening ||
      sample.socket.clients !== 1 ||
      normalizeEndpoint(sample.socket.path, windows) !== expectedEndpoint ||
      !Number.isSafeInteger(sample.socket.acceptedConnections) ||
      sample.socket.acceptedConnections < 1
    ) {
      throw new Error('legacy relay status does not prove one live broker client')
    }
    acceptedConnectionCount ??= sample.socket.acceptedConnections
    if (sample.socket.acceptedConnections !== acceptedConnectionCount) {
      throw new Error('legacy relay accepted a client during the quiescence proof')
    }
  }
  return Object.freeze({
    brokerConnectionIdentity: input.brokerConnectionIdentity,
    brokerClientCount: 1,
    acceptedConnectionCount: acceptedConnectionCount!,
    quiescenceSamples: input.samples.length,
    endpointIdentity: input.platformInspection.endpointIdentity,
    graceConfiguration: Object.freeze({
      capabilityVersion: 1,
      configuredGraceMs: 0,
      acknowledged: true
    }),
    connectionProof: Object.freeze({
      method: input.platformInspection.method,
      listenerIdentity: input.platformInspection.listenerIdentity,
      brokerConnectionIdentity: input.brokerConnectionIdentity,
      acceptedServerConnections: 1
    })
  })
}

function normalizeEndpoint(value: string, windows: boolean): string {
  if (!value || value.includes('\0')) {
    throw new Error('legacy relay endpoint path is invalid')
  }
  return windows ? win32.normalize(value).toLowerCase() : posix.normalize(value)
}

function assertBrokerConnectionIdentity(value: string): void {
  if (!value || value.length > 512 || value.includes('\0')) {
    throw new Error('legacy relay broker connection identity is invalid')
  }
}
