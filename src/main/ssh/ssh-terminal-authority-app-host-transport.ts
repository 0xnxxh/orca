import {
  TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
  TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
  parseTerminalAuthorityNamespaceAdmissionChallenge,
  parseTerminalAuthorityNamespaceAdmissionStart,
  type TerminalAuthorityNamespaceAdmissionChallenge,
  type TerminalAuthorityNamespaceAdmissionIntent,
  type TerminalAuthorityNamespaceAdmissionStart
} from '../../shared/terminal-session-authority-consumer-proof'
import {
  assertAuthorityNamespace,
  type TerminalAuthorityNamespace
} from '../../shared/terminal-session-authority-identity'
import {
  TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_NOTIFICATION,
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_NOTIFICATION,
  parseTerminalAuthorityNamespaceOutcomeBoundary,
  parseTerminalAuthorityNamespaceOutcomePublication
} from '../../shared/terminal-session-authority-consumer-transport'
import {
  TerminalAuthorityAppAdmissionIntentRequiredError,
  TerminalAuthorityAppAdmissionRejectedError,
  type TerminalAuthorityAppConsumerRetirementRequest,
  type TerminalAuthorityAppNamespaceAdmissionRequest,
  type TerminalAuthorityAppOutcomeHostConnection,
  type TerminalAuthorityAppOutcomeHostTransport,
  type TerminalAuthorityAppOutcomeNamespaceConnection
} from '../session-authority/terminal-authority-app-outcome-host-contract'
import { terminalAuthorityAppAdmissionRejection } from '../session-authority/terminal-authority-app-admission-error'
import type { TerminalAuthorityPolicyOutcomeTransport } from '../session-authority/terminal-session-authority-policy-consumers'
import {
  createTerminalAuthorityConsumerProof,
  type TerminalAuthorityConsumerProofKeypair
} from '../session-authority/terminal-session-authority-consumer-proof'
import type { SshChannelMultiplexer } from './ssh-channel-multiplexer'
import {
  SshTerminalAuthorityAppNamespaceConnection,
  type SshTerminalAuthorityAppNamespaceEvent
} from './ssh-terminal-authority-app-namespace-transport'
import {
  SSH_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_METHOD
} from './ssh-terminal-authority-consumer-methods'
import { retireSshTerminalAuthorityAppConsumer } from './ssh-terminal-authority-app-retirement'

export type SshTerminalAuthorityAppHostTransportOptions = Readonly<{
  mux: SshChannelMultiplexer
  authenticatedAuthorityHostId: string
  keypair: TerminalAuthorityConsumerProofKeypair
  consumerRetirementSupported?: boolean
}>

export class SshTerminalAuthorityAppHostTransport implements TerminalAuthorityAppOutcomeHostTransport {
  readonly authenticatedAuthorityHostId: string

  constructor(private readonly options: SshTerminalAuthorityAppHostTransportOptions) {
    this.authenticatedAuthorityHostId = options.authenticatedAuthorityHostId
    if (options.keypair.publicKey.length !== 32 || options.keypair.secretKey.length !== 32) {
      throw new Error('SSH terminal authority proof keypair is invalid')
    }
  }

  async connect(
    transport: Readonly<{ onFailure(error: unknown): void }>
  ): Promise<TerminalAuthorityAppOutcomeHostConnection> {
    if (this.options.mux.isDisposed()) {
      throw new Error('SSH terminal authority host transport is unavailable')
    }
    return new SshTerminalAuthorityAppHostConnection(this.options, transport.onFailure)
  }
}

class SshTerminalAuthorityAppHostConnection implements TerminalAuthorityAppOutcomeHostConnection {
  readonly authenticatedAuthorityHostId: string
  private readonly namespaces = new Map<string, SshTerminalAuthorityAppNamespaceConnection>()
  private readonly removeBoundaryListener: () => void
  private readonly removeOutcomeListener: () => void
  private readonly removeDisposeListener: () => void
  private active = true

  constructor(
    private readonly options: SshTerminalAuthorityAppHostTransportOptions,
    private readonly onFailure: (error: unknown) => void
  ) {
    this.authenticatedAuthorityHostId = options.authenticatedAuthorityHostId
    this.removeBoundaryListener = options.mux.onNotificationByMethod(
      TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_NOTIFICATION,
      (params) => this.receiveBoundary(params)
    )
    this.removeOutcomeListener = options.mux.onNotificationByMethod(
      TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_NOTIFICATION,
      (params) => this.receiveOutcome(params)
    )
    this.removeDisposeListener = options.mux.onDispose(() => {
      this.fail(new Error('SSH terminal authority host disconnected'))
    })
  }

  async openNamespace(
    request: TerminalAuthorityAppNamespaceAdmissionRequest,
    transport: TerminalAuthorityPolicyOutcomeTransport,
    onOpening?: (connection: TerminalAuthorityAppOutcomeNamespaceConnection) => void
  ): Promise<TerminalAuthorityAppOutcomeNamespaceConnection> {
    this.assertActive()
    const start = this.admissionStart(request)
    const challenge = await this.issueChallenge(start)
    const proof = createTerminalAuthorityConsumerProof(challenge, this.options.keypair)
    const key = namespaceKey(start.namespace)
    if (this.namespaces.has(key)) {
      throw new Error('SSH terminal authority namespace is already open')
    }
    const connection = new SshTerminalAuthorityAppNamespaceConnection({
      mux: this.options.mux,
      proof,
      transport,
      retire: (requestId) =>
        this.retireNamespace({
          namespace: start.namespace,
          candidateProcessIncarnationId: start.candidateProcessIncarnationId,
          candidateSessionNonce: start.candidateSessionNonce,
          requestId
        }),
      isCurrent: () => this.active && this.namespaces.get(key) === connection,
      remove: () => {
        if (this.namespaces.get(key) === connection) {
          this.namespaces.delete(key)
        }
      }
    })
    this.namespaces.set(key, connection)
    try {
      onOpening?.(connection)
      await connection.open()
      this.assertActive()
      return connection
    } catch (error) {
      connection.abandon()
      throw error
    }
  }

  async resolveNamespace(worktreeId: string): Promise<TerminalAuthorityNamespace> {
    this.assertActive()
    const value = await this.options.mux.request(
      SSH_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_METHOD,
      { worktreeId }
    )
    this.assertActive()
    assertAuthorityNamespace(value)
    if (value.authorityHostId !== this.authenticatedAuthorityHostId) {
      throw new Error('SSH terminal authority namespace host changed')
    }
    return Object.freeze({ ...value })
  }

  async retireNamespace(request: TerminalAuthorityAppConsumerRetirementRequest) {
    const result = await retireSshTerminalAuthorityAppConsumer(this.options, request, () =>
      this.assertActive()
    )
    const key = namespaceKey(request.namespace)
    this.namespaces.get(key)?.retired()
    this.namespaces.delete(key)
    return result
  }

  disconnect(): void {
    if (!this.active) {
      return
    }
    this.active = false
    this.removeBoundaryListener()
    this.removeOutcomeListener()
    this.removeDisposeListener()
    for (const connection of this.namespaces.values()) {
      connection.disconnect()
    }
    this.namespaces.clear()
  }

  private admissionStart(
    request: TerminalAuthorityAppNamespaceAdmissionRequest
  ): TerminalAuthorityNamespaceAdmissionStart {
    const start = parseTerminalAuthorityNamespaceAdmissionStart({
      version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
      algorithm: TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
      ...request,
      appPublicKeyB64: Buffer.from(this.options.keypair.publicKey).toString('base64')
    })
    if (!start || start.namespace.authorityHostId !== this.authenticatedAuthorityHostId) {
      throw new Error('SSH terminal authority admission request is invalid')
    }
    return start
  }

  private async issueChallenge(
    start: TerminalAuthorityNamespaceAdmissionStart
  ): Promise<TerminalAuthorityNamespaceAdmissionChallenge> {
    let unsafeChallenge: unknown
    try {
      unsafeChallenge = await this.options.mux.request(
        SSH_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_METHOD,
        { start }
      )
    } catch (error) {
      const requiredIntent = admissionIntentRequired(error)
      if (requiredIntent) {
        throw new TerminalAuthorityAppAdmissionIntentRequiredError(requiredIntent)
      }
      const rejection = terminalAuthorityAppAdmissionRejection(error)
      if (rejection) {
        throw rejection
      }
      throw error
    }
    this.assertActive()
    const challenge = parseTerminalAuthorityNamespaceAdmissionChallenge(unsafeChallenge)
    if (!challenge || !sameAdmissionStart(challenge, start)) {
      throw new TerminalAuthorityAppAdmissionRejectedError(
        'SSH terminal authority challenge is invalid'
      )
    }
    return challenge
  }

  private receiveBoundary(params: Record<string, unknown>): void {
    const value = parseTerminalAuthorityNamespaceOutcomeBoundary(params.boundary ?? params)
    if (value) {
      this.publish(Object.freeze({ kind: 'boundary', value }))
    }
  }

  private receiveOutcome(params: Record<string, unknown>): void {
    const value = parseTerminalAuthorityNamespaceOutcomePublication(params.publication ?? params)
    if (value) {
      this.publish(Object.freeze({ kind: 'outcome', value }))
    }
  }

  private publish(event: SshTerminalAuthorityAppNamespaceEvent): void {
    if (!this.active) {
      return
    }
    this.namespaces.get(namespaceKey(event.value.namespace))?.publish(event)
  }

  private fail(error: unknown): void {
    if (!this.active) {
      return
    }
    this.disconnect()
    this.onFailure(error)
  }

  private assertActive(): void {
    if (!this.active || this.options.mux.isDisposed()) {
      throw new Error('SSH terminal authority host connection is stale')
    }
  }
}

function sameAdmissionStart(
  challenge: TerminalAuthorityNamespaceAdmissionChallenge,
  start: TerminalAuthorityNamespaceAdmissionStart
): boolean {
  return (
    challenge.version === start.version &&
    challenge.algorithm === start.algorithm &&
    sameNamespace(challenge.namespace, start.namespace) &&
    challenge.appPublicKeyB64 === start.appPublicKeyB64 &&
    challenge.candidateProcessIncarnationId === start.candidateProcessIncarnationId &&
    challenge.candidateSessionNonce === start.candidateSessionNonce &&
    challenge.requestId === start.requestId &&
    challenge.intent === start.intent
  )
}

function admissionIntentRequired(error: unknown): TerminalAuthorityNamespaceAdmissionIntent | null {
  if (!(error instanceof Error)) {
    return null
  }
  const prefix = 'terminal authority namespace admission requires '
  const required = error.message.startsWith(prefix) ? error.message.slice(prefix.length) : ''
  return required === 'first' || required === 'resume' || required === 'explicit-handover'
    ? required
    : null
}

function sameNamespace(
  left: TerminalAuthorityNamespace,
  right: TerminalAuthorityNamespace
): boolean {
  return left.authorityHostId === right.authorityHostId && left.namespaceId === right.namespaceId
}

function namespaceKey(namespace: TerminalAuthorityNamespace): string {
  return JSON.stringify([namespace.authorityHostId, namespace.namespaceId])
}
