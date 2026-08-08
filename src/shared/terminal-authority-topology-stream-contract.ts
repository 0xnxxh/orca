import type { TerminalLegacyRecoveryNoticeProjection } from './terminal-legacy-cutover'
import type {
  TerminalAuthorityNamespace,
  TerminalPaneGeneration
} from './terminal-session-authority-identity'
import type { TerminalPaneAuthorityProjection } from './terminal-session-authority-mutation'

export const TERMINAL_AUTHORITY_TOPOLOGY_STREAM_VERSION = 1
export const TERMINAL_AUTHORITY_TOPOLOGY_STREAM_CAPABILITY =
  'terminal-session.authority-topology-stream.v1'
export const TERMINAL_AUTHORITY_TOPOLOGY_PTY_CAPABILITY = 'terminalAuthorityTopology'
export const TERMINAL_AUTHORITY_TOPOLOGY_SNAPSHOT_METHOD = 'terminalAuthority.topologySnapshot'
export const TERMINAL_AUTHORITY_TOPOLOGY_CHANGED_NOTIFICATION = 'terminalAuthority.topologyChanged'
export const TERMINAL_AUTHORITY_TOPOLOGY_UNSUBSCRIBE_NOTIFICATION =
  'terminalAuthority.topologyUnsubscribe'

export const TERMINAL_AUTHORITY_TOPOLOGY_MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024
export const TERMINAL_AUTHORITY_TOPOLOGY_MAX_CHANGE_BYTES = 512 * 1024
export const TERMINAL_AUTHORITY_TOPOLOGY_MAX_REQUEST_BYTES = 16 * 1024
export const TERMINAL_AUTHORITY_TOPOLOGY_MAX_PANES = 16_384
export const TERMINAL_AUTHORITY_TOPOLOGY_MAX_CHANGE_OPERATIONS = 1_024
export const TERMINAL_AUTHORITY_TOPOLOGY_MAX_RECOVERY_NOTICES = 4_096
export const TERMINAL_AUTHORITY_TOPOLOGY_MAX_BUFFERED_CHANGES = 256
export const TERMINAL_AUTHORITY_TOPOLOGY_MAX_BUFFERED_BYTES = 2 * 1024 * 1024
export const TERMINAL_AUTHORITY_TOPOLOGY_MAX_SUBSCRIPTIONS_PER_CONNECTION = 256

export type TerminalAuthorityTopologyCapabilityGrant = Readonly<{ version: 1 }>
export type TerminalAuthorityTopologyCapabilityOffer = Readonly<{ versions: readonly number[] }>

export type TerminalAuthorityTopologySnapshotRequest = Readonly<{
  protocolVersion: 1
  subscriptionId: string
  namespace: TerminalAuthorityNamespace
}>

export type TerminalAuthorityTopologyUnsubscribe = TerminalAuthorityTopologySnapshotRequest

export type TerminalAuthorityTopologyPaneChange =
  | Readonly<{ kind: 'upsert'; pane: TerminalPaneAuthorityProjection }>
  | Readonly<{ kind: 'remove'; pane: TerminalPaneGeneration }>

export type TerminalAuthorityTopologySnapshot = Readonly<{
  protocolVersion: 1
  subscriptionId: string
  streamIncarnationId: string
  namespace: TerminalAuthorityNamespace
  writerEpoch: number
  authorityRevision: number
  appliedChangeSequence: number
  panes: readonly TerminalPaneAuthorityProjection[]
  namespaceRecoveryNotices: TerminalLegacyRecoveryNoticeProjection
}>

export type TerminalAuthorityTopologyChange = Readonly<{
  protocolVersion: 1
  subscriptionId: string
  streamIncarnationId: string
  namespace: TerminalAuthorityNamespace
  writerEpoch: number
  baseAuthorityRevision: number
  authorityRevision: number
  changeSequence: number
  paneChanges: readonly TerminalAuthorityTopologyPaneChange[]
  namespaceRecoveryNotices?: TerminalLegacyRecoveryNoticeProjection
}>

export function assertTerminalAuthorityTopologyCapabilityGrant(
  value: unknown
): asserts value is TerminalAuthorityTopologyCapabilityGrant {
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as { version?: unknown }).version !== TERMINAL_AUTHORITY_TOPOLOGY_STREAM_VERSION
  ) {
    throw new Error('terminal_authority_topology_capability_not_granted')
  }
}

export function relayDaemonGrantHasTerminalAuthorityTopology(
  capabilities: readonly string[] | undefined
): boolean {
  return capabilities?.includes(TERMINAL_AUTHORITY_TOPOLOGY_STREAM_CAPABILITY) === true
}

export function terminalAuthorityTopologyGrantFromPtyCapabilities(
  capabilities: unknown
): TerminalAuthorityTopologyCapabilityGrant | null {
  if (typeof capabilities !== 'object' || capabilities === null) {
    return null
  }
  const topology = (capabilities as Record<string, unknown>)[
    TERMINAL_AUTHORITY_TOPOLOGY_PTY_CAPABILITY
  ]
  return typeof topology === 'object' && topology !== null && 'version' in topology
    ? topology.version === TERMINAL_AUTHORITY_TOPOLOGY_STREAM_VERSION
      ? Object.freeze({ version: TERMINAL_AUTHORITY_TOPOLOGY_STREAM_VERSION })
      : null
    : null
}

export function ptyCapabilitiesOfferTerminalAuthorityTopology(capabilities: unknown): boolean {
  if (typeof capabilities !== 'object' || capabilities === null) {
    return false
  }
  const topology = (capabilities as Record<string, unknown>)[
    TERMINAL_AUTHORITY_TOPOLOGY_PTY_CAPABILITY
  ]
  return (
    typeof topology === 'object' &&
    topology !== null &&
    Array.isArray((topology as { versions?: unknown }).versions) &&
    (topology as { versions: unknown[] }).versions.includes(
      TERMINAL_AUTHORITY_TOPOLOGY_STREAM_VERSION
    )
  )
}
