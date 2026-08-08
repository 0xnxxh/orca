import {
  sameTerminalAuthorityPolicyConsumer,
  type TerminalAuthorityNamespaceOutcomeBoundary,
  type TerminalAuthorityPolicyConsumerIdentity
} from '../../shared/terminal-session-authority-consumer-transport'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import { TerminalAuthorityAppOutcomeConnectionGeneration } from './terminal-authority-app-outcome-connection-generation'
import type { TerminalAuthorityAppOutcomeNamespaceConnection } from './terminal-authority-app-outcome-host-contract'

export type TerminalAuthorityAppNamespaceBoundary = {
  value: TerminalAuthorityNamespaceOutcomeBoundary
  previousSequence: number
  snapshotCommitted: boolean
}

export type TerminalAuthorityAppCompleteBoundary = TerminalAuthorityNamespaceOutcomeBoundary & {
  boundaryId: string
  consumerStart: NonNullable<TerminalAuthorityNamespaceOutcomeBoundary['consumerStart']>
  projection: NonNullable<TerminalAuthorityNamespaceOutcomeBoundary['projection']>
}

export type TerminalAuthorityAppNamespaceGeneration = {
  work: TerminalAuthorityAppOutcomeConnectionGeneration
  boundary: TerminalAuthorityAppNamespaceBoundary | null
  connection: TerminalAuthorityAppOutcomeNamespaceConnection | null
  admissionFailure: Error | null
  ready: Promise<boolean>
  resolveReady: (ready: boolean) => void
}

export function terminalAuthorityAppOutcomeNamespaceKey(value: {
  authorityHostId: string
  namespaceId: string
}): string {
  return JSON.stringify([value.authorityHostId, value.namespaceId])
}

export function isTerminalAuthorityAppCompleteBoundary(
  boundary: TerminalAuthorityNamespaceOutcomeBoundary | null
): boundary is TerminalAuthorityAppCompleteBoundary {
  return Boolean(
    boundary?.boundaryId && boundary.consumerStart && boundary.projection?.materializedOutcomes
  )
}

export function createTerminalAuthorityAppNamespaceGeneration(
  id: number
): TerminalAuthorityAppNamespaceGeneration {
  let resolveReady!: (ready: boolean) => void
  const ready = new Promise<boolean>((resolve) => {
    resolveReady = resolve
  })
  return {
    work: new TerminalAuthorityAppOutcomeConnectionGeneration(id),
    boundary: null,
    connection: null,
    admissionFailure: null,
    ready,
    resolveReady
  }
}

export function cancelTerminalAuthorityAppNamespaceGeneration(
  state: TerminalAuthorityAppNamespaceGeneration | null
): void {
  if (!state) {
    return
  }
  state.work.cancel()
  state.resolveReady(false)
  state.connection?.disconnect()
  state.boundary = null
}

export function requireTerminalAuthorityAppOutcomeConnection(
  state: TerminalAuthorityAppNamespaceGeneration
): TerminalAuthorityAppOutcomeNamespaceConnection {
  if (!state.connection) {
    throw new Error('terminal authority app outcome connection is unavailable')
  }
  return state.connection
}

export function requireTerminalAuthorityAppNamespaceGeneration(
  state: TerminalAuthorityAppNamespaceGeneration | null
): TerminalAuthorityAppNamespaceGeneration {
  if (!state) {
    throw new Error('terminal authority app outcome pump is unavailable')
  }
  return state
}

export function assertTerminalAuthorityAppOutcomeConsumer(
  expected: TerminalAuthorityPolicyConsumerIdentity,
  actual: TerminalAuthorityPolicyConsumerIdentity
): void {
  if (!sameTerminalAuthorityPolicyConsumer(expected, actual)) {
    throw new Error('terminal authority app outcome consumer incarnation changed')
  }
}

export function assertTerminalAuthorityAppOutcomeNamespace(
  expected: TerminalAuthorityNamespace,
  actual: TerminalAuthorityNamespace
): void {
  if (
    expected.authorityHostId !== actual.authorityHostId ||
    expected.namespaceId !== actual.namespaceId
  ) {
    throw new Error('terminal authority app outcome namespace changed')
  }
}
