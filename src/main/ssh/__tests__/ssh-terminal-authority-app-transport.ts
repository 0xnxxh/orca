import { vi } from 'vitest'
import {
  TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
  TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
  type TerminalAuthorityNamespaceAdmissionChallenge,
  type TerminalAuthorityNamespaceAdmissionGrant,
  type TerminalAuthorityNamespaceAdmissionStart
} from '../../../shared/terminal-session-authority-consumer-proof'
import {
  TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_ALGORITHM,
  TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION
} from '../../../shared/terminal-session-authority-consumer-retirement'
import type { TerminalAuthorityNamespace } from '../../../shared/terminal-session-authority-identity'
import { TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION } from '../../../shared/terminal-session-authority-consumer-transport'
import {
  createTerminalAuthorityProofEphemeralKeypair,
  terminalAuthorityAdmissionCas,
  terminalAuthorityHostAppConsumerId,
  terminalAuthorityRetirementCas
} from '../../session-authority/terminal-session-authority-consumer-proof'
import type { TerminalAuthorityPolicyOutcomeTransport } from '../../session-authority/terminal-session-authority-policy-consumers'
import type { SshChannelMultiplexer } from '../ssh-channel-multiplexer'

export const SSH_AUTHORITY_HOST_ID = 'authority-host:ssh-app-transport-test'
export const SSH_AUTHORITY_APP_KEYPAIR = createTerminalAuthorityProofEphemeralKeypair()

export type FakeSshAuthorityRequest = Readonly<{
  method: string
  params: Record<string, unknown> | undefined
}>

export class FakeSshAuthorityMux {
  readonly requests: FakeSshAuthorityRequest[] = []
  private readonly notificationHandlers = new Map<
    string,
    Set<(params: Record<string, unknown>) => void>
  >()
  private readonly disposeHandlers = new Set<() => void>()
  private disposed = false

  constructor(
    private readonly handleRequest: (
      method: string,
      params: Record<string, unknown> | undefined
    ) => Promise<unknown>
  ) {}

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (this.disposed) {
      throw new Error('mux disposed')
    }
    this.requests.push(Object.freeze({ method, params }))
    return await this.handleRequest(method, params)
  }

  onNotificationByMethod(
    method: string,
    handler: (params: Record<string, unknown>) => void
  ): () => void {
    const handlers = this.notificationHandlers.get(method) ?? new Set()
    handlers.add(handler)
    this.notificationHandlers.set(method, handlers)
    return () => handlers.delete(handler)
  }

  onDispose(handler: () => void): () => void {
    this.disposeHandlers.add(handler)
    return () => this.disposeHandlers.delete(handler)
  }

  isDisposed(): boolean {
    return this.disposed
  }

  emit(method: string, params: Record<string, unknown>): void {
    for (const handler of this.notificationHandlers.get(method) ?? []) {
      handler(params)
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    for (const handler of this.disposeHandlers) {
      handler()
    }
  }

  asMux(): SshChannelMultiplexer {
    return this as unknown as SshChannelMultiplexer
  }
}

export function sshAuthorityAdmission(namespaceId = 'namespace:ssh-app-transport-test') {
  const namespace: TerminalAuthorityNamespace = Object.freeze({
    authorityHostId: SSH_AUTHORITY_HOST_ID,
    namespaceId
  })
  const request = Object.freeze({
    namespace,
    candidateProcessIncarnationId: 'app-process:ssh-app-transport-test',
    candidateSessionNonce: `app-session:${namespaceId}`,
    requestId: `app-request:${namespaceId}`,
    intent: 'resume' as const
  })
  const start: TerminalAuthorityNamespaceAdmissionStart = Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
    algorithm: TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
    ...request,
    appPublicKeyB64: Buffer.from(SSH_AUTHORITY_APP_KEYPAIR.publicKey).toString('base64')
  })
  const host = createTerminalAuthorityProofEphemeralKeypair()
  const challenge: TerminalAuthorityNamespaceAdmissionChallenge = Object.freeze({
    ...start,
    currentAdmissionCas: 'admission-cas:ssh-app-transport-test',
    connectionGrantId: 'connection-grant:ssh-app-transport-test',
    authenticatedTransportPrincipal: 'ssh-principal:test',
    authenticatedTransportCapability: 'ssh-capability:test',
    hostEphemeralPublicKeyB64: Buffer.from(host.publicKey).toString('base64'),
    expiresAtMs: Date.now() + 30_000
  })
  const consumer = Object.freeze({
    consumerId: terminalAuthorityHostAppConsumerId(
      SSH_AUTHORITY_HOST_ID,
      SSH_AUTHORITY_APP_KEYPAIR.publicKey
    ),
    consumerIncarnationId: start.candidateProcessIncarnationId
  })
  const grant: TerminalAuthorityNamespaceAdmissionGrant = Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
    consumer,
    namespace,
    requestId: start.requestId,
    connectionGrantId: challenge.connectionGrantId,
    admissionCas: terminalAuthorityAdmissionCas(
      namespace,
      consumer.consumerId,
      consumer.consumerIncarnationId
    ),
    replayed: false
  })
  return { request, start, challenge, grant }
}

export function sshAuthorityBoundary(grant: TerminalAuthorityNamespaceAdmissionGrant) {
  return Object.freeze({
    version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
    consumer: grant.consumer,
    namespace: grant.namespace,
    acknowledgedSequence: 0,
    outcomeHighWatermark: 0,
    boundaryId: `boundary:${grant.namespace.namespaceId}`,
    consumerStart: 'new-at-tail' as const
  })
}

export function sshAuthorityRetirement(namespaceId = 'namespace:ssh-app-transport-test') {
  const namespace = Object.freeze({ authorityHostId: SSH_AUTHORITY_HOST_ID, namespaceId })
  const request = Object.freeze({
    namespace,
    candidateProcessIncarnationId: 'app-process:ssh-app-transport-test',
    candidateSessionNonce: `app-retirement-session:${namespaceId}`,
    requestId: `app-retirement-request:${namespaceId}`
  })
  const start = Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
    algorithm: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_ALGORITHM,
    ...request,
    appPublicKeyB64: Buffer.from(SSH_AUTHORITY_APP_KEYPAIR.publicKey).toString('base64')
  })
  const host = createTerminalAuthorityProofEphemeralKeypair()
  const consumerId = terminalAuthorityHostAppConsumerId(
    SSH_AUTHORITY_HOST_ID,
    SSH_AUTHORITY_APP_KEYPAIR.publicKey
  )
  const currentConsumerIncarnationId = request.candidateProcessIncarnationId
  const challenge = Object.freeze({
    ...start,
    consumerId,
    currentConsumerIncarnationId,
    retirementCas: terminalAuthorityRetirementCas(
      namespace,
      consumerId,
      currentConsumerIncarnationId
    ),
    connectionGrantId: 'connection-grant:ssh-app-transport-test',
    liveAdmission: null,
    authenticatedTransportPrincipal: 'ssh-principal:test',
    authenticatedTransportCapability: 'ssh-capability:test',
    hostEphemeralPublicKeyB64: Buffer.from(host.publicKey).toString('base64'),
    expiresAtMs: Date.now() + 30_000
  })
  const result = Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
    namespace,
    consumerId,
    retiredConsumerIncarnationId: currentConsumerIncarnationId,
    requestId: request.requestId,
    candidateProcessIncarnationId: request.candidateProcessIncarnationId,
    candidateSessionNonce: request.candidateSessionNonce,
    connectionGrantId: challenge.connectionGrantId,
    retirementCas: challenge.retirementCas,
    retired: true as const,
    alreadyAbsent: false,
    replayed: false
  })
  return { request, start, challenge, result }
}

export function sshAuthorityOutcomeTransport(
  onFailure: (error: Error) => void = vi.fn()
): TerminalAuthorityPolicyOutcomeTransport {
  return {
    publishBoundary: vi.fn(async () => {}),
    publishOutcome: vi.fn(async () => {}),
    onFailure
  }
}
