import type {
  TerminalAuthorityAppPaneProjection,
  TerminalAuthorityAppProjectionRowIdentity
} from '../../shared/terminal-authority-app-projection'
import type {
  TerminalAuthorityNamespaceBoundaryAcceptance,
  TerminalAuthorityNamespaceOutcomeAck,
  TerminalAuthorityPolicyConsumerIdentity
} from '../../shared/terminal-session-authority-consumer-transport'
import type {
  TerminalAuthorityNamespaceAdmissionGrant,
  TerminalAuthorityNamespaceAdmissionIntent
} from '../../shared/terminal-session-authority-consumer-proof'
import type { TerminalAuthorityConsumerRetirementResult } from '../../shared/terminal-session-authority-consumer-retirement'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type { TerminalAuthorityPolicyOutcomeTransport } from './terminal-session-authority-policy-consumers'
import type { TerminalAuthorityAppProjectionStore } from './terminal-authority-app-projection-store'

export type TerminalAuthorityAppOutcomeNamespaceConnection = Readonly<{
  expectedConsumer: TerminalAuthorityPolicyConsumerIdentity
  grant: TerminalAuthorityNamespaceAdmissionGrant
  activate?(): void | Promise<void>
  acceptBoundary(acceptance: TerminalAuthorityNamespaceBoundaryAcceptance): Promise<void>
  acknowledge(ack: TerminalAuthorityNamespaceOutcomeAck): Promise<number>
  retire(requestId: string): Promise<TerminalAuthorityConsumerRetirementResult>
  disconnect(): void
}>

export type TerminalAuthorityAppNamespaceAdmissionRequest = Readonly<{
  namespace: TerminalAuthorityNamespace
  candidateProcessIncarnationId: string
  candidateSessionNonce: string
  requestId: string
  intent: TerminalAuthorityNamespaceAdmissionIntent
}>

export type TerminalAuthorityAppConsumerRetirementRequest = Readonly<{
  namespace: TerminalAuthorityNamespace
  candidateProcessIncarnationId: string
  candidateSessionNonce: string
  requestId: string
}>

export type TerminalAuthorityAppOutcomeHostConnection = Readonly<{
  authenticatedAuthorityHostId: string
  resolveNamespace(worktreeId: string): Promise<TerminalAuthorityNamespace>
  openNamespace(
    request: TerminalAuthorityAppNamespaceAdmissionRequest,
    transport: TerminalAuthorityPolicyOutcomeTransport,
    onOpening?: (connection: TerminalAuthorityAppOutcomeNamespaceConnection) => void
  ): Promise<TerminalAuthorityAppOutcomeNamespaceConnection>
  retireNamespace(
    request: TerminalAuthorityAppConsumerRetirementRequest
  ): Promise<TerminalAuthorityConsumerRetirementResult>
  disconnect(): void
}>

export type TerminalAuthorityAppAdmissionLocator =
  | Readonly<{ namespace: TerminalAuthorityNamespace }>
  | Readonly<{ worktreeId: string }>

export type TerminalAuthorityAppAdmissionBinding = Readonly<{
  namespace: TerminalAuthorityNamespace
  assertCurrent(): void
}>

export type TerminalAuthorityAppOutcomeNamespaceBinding = Readonly<{
  assertCurrent(): void
}>

export type TerminalAuthorityAppResolvedNamespaceBinding = Readonly<{
  namespace: TerminalAuthorityNamespace
  binding: TerminalAuthorityAppOutcomeNamespaceBinding
}>

export type TerminalAuthorityAppNamespaceAdmission = Readonly<{
  admitNamespace(namespace: TerminalAuthorityNamespace): Promise<void>
  resolveAndAdmitNamespace(worktreeId: string): Promise<TerminalAuthorityNamespace>
  withSourceAdmission<T>(
    locator: TerminalAuthorityAppAdmissionLocator,
    operation: (binding: TerminalAuthorityAppAdmissionBinding) => Promise<T>
  ): Promise<T>
}>

export type TerminalAuthorityAppOutcomeHostTransport = Readonly<{
  authenticatedAuthorityHostId: string
  connect(
    transport: Readonly<{ onFailure(error: unknown): void }>
  ): Promise<TerminalAuthorityAppOutcomeHostConnection>
}>

export type TerminalAuthorityAppProjectionObservation = Readonly<{
  rows: readonly TerminalAuthorityAppPaneProjection[]
  deleted: readonly TerminalAuthorityAppProjectionRowIdentity[]
}>

export type TerminalAuthorityAppOutcomeManagerOptions = Readonly<{
  store: TerminalAuthorityAppProjectionStore
  onProjection: (change: TerminalAuthorityAppProjectionObservation) => void
  onError?: (error: Error) => void
  connectTimeoutMs?: number
  acknowledgeTimeoutMs?: number
  reconnectBaseDelayMs?: number
  reconnectMaxDelayMs?: number
  createAdmissionId?: () => string
}>

export type TerminalAuthorityAppOutcomeNamespaceSessionOptions =
  TerminalAuthorityAppOutcomeManagerOptions &
    Readonly<{
      processIncarnationId: string
      namespace: TerminalAuthorityNamespace
      hostConnection: () => Promise<TerminalAuthorityAppOutcomeHostConnection>
    }>

export type TerminalAuthorityAppOutcomeTiming = Readonly<{
  connectTimeoutMs: number
  acknowledgeTimeoutMs: number
  reconnectBaseDelayMs: number
  reconnectMaxDelayMs: number
}>

export class TerminalAuthorityAppAdmissionIntentRequiredError extends Error {
  constructor(readonly requiredIntent: TerminalAuthorityNamespaceAdmissionIntent) {
    super(`terminal authority app outcome admission requires ${requiredIntent}`)
  }
}

export class TerminalAuthorityAppAdmissionRejectedError extends Error {
  constructor(message = 'terminal authority app outcome admission was rejected') {
    super(message)
  }
}

export function resolveTerminalAuthorityAppOutcomeTiming(
  options: TerminalAuthorityAppOutcomeManagerOptions
): TerminalAuthorityAppOutcomeTiming {
  const timing = Object.freeze({
    connectTimeoutMs: positiveDuration(options.connectTimeoutMs, 10_000),
    acknowledgeTimeoutMs: positiveDuration(options.acknowledgeTimeoutMs, 10_000),
    reconnectBaseDelayMs: positiveDuration(options.reconnectBaseDelayMs, 100),
    reconnectMaxDelayMs: positiveDuration(options.reconnectMaxDelayMs, 5_000)
  })
  if (timing.reconnectBaseDelayMs > timing.reconnectMaxDelayMs) {
    throw new Error('terminal authority app outcome reconnect delays are invalid')
  }
  return timing
}

export function terminalAuthorityAppReconnectDelay(
  timing: TerminalAuthorityAppOutcomeTiming,
  attempt: number
): number {
  return Math.min(
    timing.reconnectMaxDelayMs,
    timing.reconnectBaseDelayMs * 2 ** Math.min(attempt, 10)
  )
}

export function observeTerminalAuthorityAppProjection(
  options: TerminalAuthorityAppOutcomeManagerOptions,
  change: TerminalAuthorityAppProjectionObservation
): void {
  if (change.rows.length === 0 && change.deleted.length === 0) {
    return
  }
  try {
    options.onProjection(change)
  } catch (error) {
    options.onError?.(error instanceof Error ? error : new Error(String(error)))
  }
}

export function reportTerminalAuthorityAppOutcomeError(
  options: TerminalAuthorityAppOutcomeManagerOptions,
  value: unknown
): void {
  options.onError?.(value instanceof Error ? value : new Error(String(value)))
}

function positiveDuration(value: number | undefined, fallback: number): number {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected < 1) {
    throw new Error('terminal authority app outcome duration is invalid')
  }
  return selected
}
