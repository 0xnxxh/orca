import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type {
  TerminalAuthorityTopologyCapabilityGrant,
  TerminalAuthorityTopologySnapshot
} from '../../shared/terminal-authority-topology-stream-contract'
import type { SshTerminalAuthorityTopologyResnapshotReason } from './ssh-terminal-authority-topology-reducer'

export type SshTerminalAuthorityTopologyTransport = Readonly<{
  onNotificationByMethod: (
    method: string,
    handler: (params: Record<string, unknown>) => void
  ) => () => void
  request: (
    method: string,
    params: Record<string, unknown>,
    options: Readonly<{ signal: AbortSignal }>
  ) => Promise<unknown>
  notify: (method: string, params: Record<string, unknown>) => boolean
}>

export type SshTerminalAuthorityTopologyClientStatus =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{
      kind: 'synchronizing'
      reason: 'initial' | 'manual' | SshTerminalAuthorityTopologyResnapshotReason
    }>
  | Readonly<{
      kind: 'synchronized'
      streamIncarnationId: string
      authorityRevision: number
      appliedChangeSequence: number
    }>
  | Readonly<{ kind: 'stale'; error: Error }>
  | Readonly<{ kind: 'disposed' }>

export type SshTerminalAuthorityTopologyClientOptions = Readonly<{
  transport: SshTerminalAuthorityTopologyTransport
  capabilityGrant: TerminalAuthorityTopologyCapabilityGrant
  subscriptionId: string
  namespace: TerminalAuthorityNamespace
  onStatusChange?: (status: SshTerminalAuthorityTopologyClientStatus) => void
  onAuthoritativeState?: (state: TerminalAuthorityTopologySnapshot) => void
  onSynchronizationError?: (error: Error) => void
}>
