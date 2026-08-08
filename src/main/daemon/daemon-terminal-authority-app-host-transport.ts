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
import {
  DaemonTerminalAuthorityAppNamespaceConnection,
  parseDaemonTerminalAuthorityAppNamespaceEvent
} from './daemon-terminal-authority-app-namespace-transport'
import {
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_REQUEST,
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_REQUEST
} from './daemon-terminal-authority-consumer-requests'
import { retireDaemonTerminalAuthorityAppConsumer } from './daemon-terminal-authority-app-retirement'

export type DaemonTerminalAuthorityAppClient = Readonly<{
  ensureConnected(): Promise<void>
  terminalSessionAuthorityConsumerProofHostId(): string | null
  terminalSessionAuthorityConsumerRetirementSupported?(): boolean
  request<T>(type: string, payload: unknown, timeoutMs?: number): Promise<T>
  onEvent(listener: (event: unknown) => void): () => void
  onDisconnected(listener: () => void): () => void
}>

export type DaemonTerminalAuthorityAppHostTransportOptions = Readonly<{
  client: DaemonTerminalAuthorityAppClient
  authenticatedAuthorityHostId: string
  keypair: TerminalAuthorityConsumerProofKeypair
}>

export class DaemonTerminalAuthorityAppHostTransport implements TerminalAuthorityAppOutcomeHostTransport {
  readonly authenticatedAuthorityHostId: string

  constructor(private readonly options: DaemonTerminalAuthorityAppHostTransportOptions) {
    this.authenticatedAuthorityHostId = options.authenticatedAuthorityHostId
    if (options.keypair.publicKey.length !== 32 || options.keypair.secretKey.length !== 32) {
      throw new Error('daemon terminal authority proof keypair is invalid')
    }
  }

  async connect(
    transport: Readonly<{ onFailure(error: unknown): void }>
  ): Promise<TerminalAuthorityAppOutcomeHostConnection> {
    await this.options.client.ensureConnected()
    if (
      this.options.client.terminalSessionAuthorityConsumerProofHostId() !==
      this.authenticatedAuthorityHostId
    ) {
      throw new Error('daemon terminal authority host identity changed')
    }
    return new DaemonTerminalAuthorityAppHostConnection(this.options, transport.onFailure)
  }
}

class DaemonTerminalAuthorityAppHostConnection implements TerminalAuthorityAppOutcomeHostConnection {
  readonly authenticatedAuthorityHostId: string
  private readonly namespaces = new Map<string, DaemonTerminalAuthorityAppNamespaceConnection>()
  private readonly removeEventListener: () => void
  private readonly removeDisconnectedListener: () => void
  private active = true

  constructor(
    private readonly options: DaemonTerminalAuthorityAppHostTransportOptions,
    private readonly onFailure: (error: unknown) => void
  ) {
    this.authenticatedAuthorityHostId = options.authenticatedAuthorityHostId
    this.removeEventListener = options.client.onEvent((event) => this.receiveEvent(event))
    this.removeDisconnectedListener = options.client.onDisconnected(() => {
      this.fail(new Error('daemon terminal authority host disconnected'))
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
    let proof
    try {
      proof = createTerminalAuthorityConsumerProof(challenge, this.options.keypair)
    } catch (error) {
      throw new Error(
        `daemon terminal authority proof failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    const key = namespaceKey(start.namespace)
    if (this.namespaces.has(key)) {
      throw new Error('daemon terminal authority namespace is already open')
    }
    const connection = new DaemonTerminalAuthorityAppNamespaceConnection({
      client: this.options.client,
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
    const value = await this.options.client.request<unknown>(
      DAEMON_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_REQUEST,
      { worktreeId }
    )
    this.assertActive()
    assertAuthorityNamespace(value)
    if (value.authorityHostId !== this.authenticatedAuthorityHostId) {
      throw new Error('daemon terminal authority namespace host changed')
    }
    return Object.freeze({ ...value })
  }

  async retireNamespace(request: TerminalAuthorityAppConsumerRetirementRequest) {
    const result = await retireDaemonTerminalAuthorityAppConsumer(this.options, request, () =>
      this.assertActive()
    )
    const key = namespaceKey(request.namespace)
    this.namespaces.get(key)?.retired()
    this.namespaces.delete(key)
    return result
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
      throw new Error('daemon terminal authority admission request is invalid')
    }
    return start
  }

  private async issueChallenge(
    start: TerminalAuthorityNamespaceAdmissionStart
  ): Promise<TerminalAuthorityNamespaceAdmissionChallenge> {
    let unsafeChallenge: unknown
    try {
      unsafeChallenge = await this.options.client.request(
        DAEMON_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_REQUEST,
        start
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
        'daemon terminal authority challenge is invalid'
      )
    }
    return challenge
  }

  disconnect(): void {
    if (!this.active) {
      return
    }
    this.active = false
    this.removeEventListener()
    this.removeDisconnectedListener()
    for (const connection of this.namespaces.values()) {
      connection.disconnect()
    }
    this.namespaces.clear()
  }

  private receiveEvent(value: unknown): void {
    if (!this.active || !value || typeof value !== 'object') {
      return
    }
    const event = value as { event?: unknown; payload?: unknown }
    const parsed = parseDaemonTerminalAuthorityAppNamespaceEvent(event.event, event.payload)
    if (!parsed) {
      return
    }
    this.namespaces.get(namespaceKey(parsed.value.namespace))?.publish(parsed)
  }

  private fail(error: unknown): void {
    if (!this.active) {
      return
    }
    this.disconnect()
    this.onFailure(error)
  }

  private assertActive(): void {
    if (!this.active) {
      throw new Error('daemon terminal authority host connection is stale')
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
