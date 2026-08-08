import type { TerminalAuthorityObserverAccess } from '../main/session-authority/terminal-session-authority-access'
import type { TerminalAuthorityProjectionChange } from '../main/session-authority/terminal-session-authority-service-contract'
import type { TerminalAuthorityNamespace } from '../shared/terminal-session-authority-identity'
import type { TerminalAuthorityProjection } from '../shared/terminal-session-authority-mutation'
import type { TerminalLegacyRecoveryNoticeProjection } from '../shared/terminal-legacy-cutover'
import type {
  TERMINAL_AUTHORITY_TOPOLOGY_CHANGED_NOTIFICATION,
  TerminalAuthorityTopologyChange
} from '../shared/terminal-authority-topology-stream-contract'

export type TerminalAuthorityTopologyChannelService = Readonly<{
  namespace: TerminalAuthorityNamespace
  subscribeProjection: (
    actorId: string,
    listener: (change: TerminalAuthorityProjectionChange) => void
  ) => TerminalAuthorityObserverAccess
  revokeObserver: (access: TerminalAuthorityObserverAccess) => void
  snapshotForObserver: (access: TerminalAuthorityObserverAccess) => TerminalAuthorityProjection
}>

export type TerminalAuthorityTopologyRecoverySource = Readonly<{
  recoveryNoticesForNamespace: (
    namespace: TerminalAuthorityNamespace
  ) => TerminalLegacyRecoveryNoticeProjection
}>

export type TerminalAuthorityTopologyChannelTransport = Readonly<{
  notify: (
    clientId: number,
    method: typeof TERMINAL_AUTHORITY_TOPOLOGY_CHANGED_NOTIFICATION,
    change: TerminalAuthorityTopologyChange
  ) => boolean
  disconnect: (clientId: number, error: Error) => void
}>

export type TerminalAuthorityTopologyChannelSubscription = Readonly<{
  dispose: () => void
}>
