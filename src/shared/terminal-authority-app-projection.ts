import type { AgentStatusState } from './agent-status-types'
import type {
  TerminalAuthorityNamespace,
  TerminalPaneGeneration,
  TerminalSessionBinding
} from './terminal-session-authority-identity'
import type {
  TerminalPaneAuthorityStatus,
  TerminalSessionAuthoritySemanticFact,
  TerminalSessionPtyAllocation
} from './terminal-session-authority-mutation'

export const TERMINAL_AUTHORITY_APP_PROJECTION_VERSION = 1 as const
export const TERMINAL_AUTHORITY_APP_PROJECTION_EVENT = 'pty:authorityProjection'
export const TERMINAL_AUTHORITY_APP_PROJECTION_SUBSCRIBE = 'pty:authorityProjection:subscribe'
export const TERMINAL_AUTHORITY_APP_PROJECTION_CLEAR_BELL = 'pty:authorityProjection:clearBell'
export const TERMINAL_AUTHORITY_APP_PROJECTION_MAX_ROWS = 4_096

export type TerminalAuthorityAppEventKey = Readonly<{
  consumerId: string
  namespace: TerminalAuthorityNamespace
  sequence: number
  outcomeId: string
}>

export type TerminalAuthorityAppFactProjection = Readonly<{
  event: TerminalAuthorityAppEventKey
  binding: TerminalSessionBinding
  fact: TerminalSessionAuthoritySemanticFact
  appliedAt: number
  verifyAfter?: number
  verification?: 'pending' | 'verified' | 'failed'
}>

export type TerminalAuthorityAppTopologyProjection = Readonly<{
  event?: TerminalAuthorityAppEventKey
  status: TerminalPaneAuthorityStatus
  binding: TerminalSessionBinding | null
  lastBinding: TerminalSessionBinding | null
  authorityRevision: number
  ownerStatus: 'reachable' | 'owner-unreachable' | null
}>

export type TerminalAuthorityAppExitProjection = Readonly<{
  event: TerminalAuthorityAppEventKey
  binding: TerminalSessionBinding
  code: number | null
  signal: string | null
}>

export type TerminalAuthorityAppLayoutProjection = Readonly<{
  tabId: string
  leafId: string
}> | null

export type TerminalAuthorityAppAgentProjection = Readonly<{
  event: TerminalAuthorityAppEventKey
  binding: TerminalSessionBinding
  state: AgentStatusState | 'idle' | 'exited'
  prompt: string
  transitionedAt: number
}>

export type TerminalAuthorityAppCommandCodeProjection = Readonly<{
  event: TerminalAuthorityAppEventKey
  binding: TerminalSessionBinding
  state: 'working' | 'settling' | 'done'
  prompt: string
  transitionedAt: number
  settleAt: number | null
}>

export type TerminalAuthorityAppAttentionProjection = Readonly<{
  event: TerminalAuthorityAppEventKey | null
  pendingBellCount: number
  updatedAt: number
}>

export type TerminalAuthorityAppStatusProjection = Readonly<{
  event: TerminalAuthorityAppEventKey | null
  pane: TerminalPaneAuthorityStatus
  agent: TerminalAuthorityAppAgentProjection['state'] | null
  attention: boolean
  updatedAt: number
}>

export type TerminalAuthorityAppPaneProjection = Readonly<{
  version: typeof TERMINAL_AUTHORITY_APP_PROJECTION_VERSION
  consumerId: string
  namespace: TerminalAuthorityNamespace
  pane: TerminalPaneGeneration
  layout: TerminalAuthorityAppLayoutProjection
  binding: TerminalSessionBinding | null
  latestEvent?: TerminalAuthorityAppEventKey
  topology: TerminalAuthorityAppTopologyProjection
  allocation?: TerminalSessionPtyAllocation
  exit?: TerminalAuthorityAppExitProjection
  agent?: TerminalAuthorityAppAgentProjection
  commandCode?: TerminalAuthorityAppCommandCodeProjection
  attention: TerminalAuthorityAppAttentionProjection
  status: TerminalAuthorityAppStatusProjection
  facts: Readonly<
    Partial<
      Record<TerminalSessionAuthoritySemanticFact['kind'], TerminalAuthorityAppFactProjection>
    >
  >
}>

export type TerminalAuthorityAppProjectionRowIdentity = Readonly<{
  consumerId: string
  namespace: TerminalAuthorityNamespace
  pane: TerminalPaneGeneration
}>

export type TerminalAuthorityAppProjectionChange = Readonly<{
  rows: readonly TerminalAuthorityAppPaneProjection[]
  deleted: readonly TerminalAuthorityAppProjectionRowIdentity[]
}>

export type TerminalAuthorityAppProjectionSubscribe = Readonly<{
  version: typeof TERMINAL_AUTHORITY_APP_PROJECTION_VERSION
  subscriptionIncarnationId: string
  expectedSubscriptionIncarnationId?: string | null
}>

export type TerminalAuthorityAppProjectionSnapshot = Readonly<{
  version: typeof TERMINAL_AUTHORITY_APP_PROJECTION_VERSION
  subscriptionIncarnationId: string
  rows: readonly TerminalAuthorityAppPaneProjection[]
}>

export type TerminalAuthorityAppProjectionDelta = Readonly<{
  version: typeof TERMINAL_AUTHORITY_APP_PROJECTION_VERSION
  subscriptionIncarnationId: string
  rows: readonly TerminalAuthorityAppPaneProjection[]
  deleted?: readonly TerminalAuthorityAppProjectionRowIdentity[]
}>

export type TerminalAuthorityAppBellClearRequest = Readonly<{
  version: typeof TERMINAL_AUTHORITY_APP_PROJECTION_VERSION
  consumerId: string
  namespace: TerminalAuthorityNamespace
  pane: TerminalPaneGeneration
  expectedEvent: TerminalAuthorityAppEventKey
}>

export function terminalAuthorityAppProjectionRowKey(
  value: Pick<TerminalAuthorityAppPaneProjection, 'consumerId' | 'namespace' | 'pane'>
): string {
  return JSON.stringify([
    value.consumerId,
    value.namespace.authorityHostId,
    value.namespace.namespaceId,
    value.pane.paneKey,
    value.pane.paneGenerationId
  ])
}
