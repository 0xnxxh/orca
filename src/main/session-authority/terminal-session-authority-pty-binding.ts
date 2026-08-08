import type {
  TerminalPaneGeneration,
  TerminalSessionBinding
} from '../../shared/terminal-session-authority-identity'
import type { TerminalSessionPtyAllocationIdentity } from '../../shared/terminal-session-authority-mutation'
import type { TerminalAuthorityNamespaceRuntime } from './terminal-session-authority-runtime-cache'
import type { TerminalAuthorityPolicyConsumerConnection } from './terminal-session-authority-policy-consumers'

export type TerminalAuthorityPreparedPtySpawn = Readonly<{
  kind: 'spawn'
  operationId: string
  runtime: TerminalAuthorityNamespaceRuntime
  policyConsumer: TerminalAuthorityPolicyConsumerConnection
  pane: TerminalPaneGeneration
  allocation: TerminalSessionPtyAllocationIdentity
}>

export type TerminalAuthorityAdoptedPtySpawn = Readonly<{
  kind: 'adopt'
  runtime: TerminalAuthorityNamespaceRuntime
  policyConsumer: TerminalAuthorityPolicyConsumerConnection
  pane: TerminalPaneGeneration
  binding: TerminalSessionBinding
}>

export type TerminalAuthorityManagedPty = Readonly<{
  runtime: TerminalAuthorityNamespaceRuntime
  pane: TerminalPaneGeneration
  binding: TerminalSessionBinding
}>
