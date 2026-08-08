import {
  TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
  parseTerminalAuthorityNamespaceAdmissionGrant,
  type TerminalAuthorityNamespaceAdmissionGrant,
  type TerminalAuthorityNamespaceAdmissionProof
} from '../../shared/terminal-session-authority-consumer-proof'
import type { TerminalAuthorityConsumerRetirementResult } from '../../shared/terminal-session-authority-consumer-retirement'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import {
  parseTerminalAuthorityNamespaceOutcomeBoundary,
  parseTerminalAuthorityNamespaceOutcomePublication,
  parseTerminalAuthorityNamespaceBoundaryAcceptance,
  parseTerminalAuthorityNamespaceOutcomeAck,
  sameTerminalAuthorityPolicyConsumer,
  type TerminalAuthorityNamespaceOutcomeBoundary,
  type TerminalAuthorityNamespaceOutcomePublication
} from '../../shared/terminal-session-authority-consumer-transport'
import {
  TerminalAuthorityAppAdmissionRejectedError,
  type TerminalAuthorityAppOutcomeNamespaceConnection
} from '../session-authority/terminal-authority-app-outcome-host-contract'
import { terminalAuthorityAppAdmissionRejection } from '../session-authority/terminal-authority-app-admission-error'
import type { TerminalAuthorityPolicyOutcomeTransport } from '../session-authority/terminal-session-authority-policy-consumers'
import {
  terminalAuthorityAdmissionCas,
  terminalAuthorityHostAppConsumerId
} from '../session-authority/terminal-session-authority-consumer-proof'
import type { DaemonTerminalAuthorityAppClient } from './daemon-terminal-authority-app-host-transport'
import {
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_CANCEL_REQUEST,
  DAEMON_TERMINAL_AUTHORITY_CONSUMER_GRANT_REQUEST
} from './daemon-terminal-authority-consumer-requests'
import {
  DAEMON_TERMINAL_AUTHORITY_BOUNDARY_ACCEPT_REQUEST,
  DAEMON_TERMINAL_AUTHORITY_OUTCOME_ACK_REQUEST
} from './daemon-terminal-authority-outcome-requests'

const MAX_PREACTIVATION_EVENTS = 256

export type DaemonTerminalAuthorityAppNamespaceEvent =
  | Readonly<{ kind: 'boundary'; value: TerminalAuthorityNamespaceOutcomeBoundary }>
  | Readonly<{ kind: 'outcome'; value: TerminalAuthorityNamespaceOutcomePublication }>

export function parseDaemonTerminalAuthorityAppNamespaceEvent(
  event: unknown,
  payload: unknown
): DaemonTerminalAuthorityAppNamespaceEvent | null {
  if (event === 'terminalAuthorityNamespaceOutcomeBoundary') {
    const value = parseTerminalAuthorityNamespaceOutcomeBoundary(payload)
    return value ? Object.freeze({ kind: 'boundary', value }) : null
  }
  if (event === 'terminalAuthorityNamespaceOutcome') {
    const value = parseTerminalAuthorityNamespaceOutcomePublication(payload)
    return value ? Object.freeze({ kind: 'outcome', value }) : null
  }
  return null
}

type NamespaceConnectionOptions = Readonly<{
  client: DaemonTerminalAuthorityAppClient
  proof: TerminalAuthorityNamespaceAdmissionProof
  transport: TerminalAuthorityPolicyOutcomeTransport
  retire: (requestId: string) => Promise<TerminalAuthorityConsumerRetirementResult>
  isCurrent: () => boolean
  remove: () => void
}>

export class DaemonTerminalAuthorityAppNamespaceConnection implements TerminalAuthorityAppOutcomeNamespaceConnection {
  readonly expectedConsumer
  private readonly buffered: DaemonTerminalAuthorityAppNamespaceEvent[] = []
  private installedGrant: TerminalAuthorityNamespaceAdmissionGrant | null = null
  private deliveryTail: Promise<void> = Promise.resolve()
  private active = true
  private activated = false

  constructor(private readonly options: NamespaceConnectionOptions) {
    this.expectedConsumer = Object.freeze({
      consumerId: terminalAuthorityHostAppConsumerId(
        options.proof.challenge.namespace.authorityHostId,
        Uint8Array.from(Buffer.from(options.proof.challenge.appPublicKeyB64, 'base64'))
      ),
      consumerIncarnationId: options.proof.challenge.candidateProcessIncarnationId
    })
  }

  get grant(): TerminalAuthorityNamespaceAdmissionGrant {
    if (!this.installedGrant) {
      throw new Error('daemon terminal authority namespace grant is unavailable')
    }
    return this.installedGrant
  }

  async open(): Promise<void> {
    this.assertActive()
    let unsafeGrant: unknown
    try {
      unsafeGrant = await this.options.client.request<unknown>(
        DAEMON_TERMINAL_AUTHORITY_CONSUMER_GRANT_REQUEST,
        this.options.proof
      )
    } catch (error) {
      throw terminalAuthorityAppAdmissionRejection(error) ?? error
    }
    this.assertActive()
    const grant = parseTerminalAuthorityNamespaceAdmissionGrant(unsafeGrant)
    this.assertGrant(grant)
    this.installedGrant = grant
  }

  async activate(): Promise<void> {
    this.assertActive()
    void this.grant
    if (this.activated) {
      return await this.deliveryTail
    }
    this.activated = true
    const buffered = this.buffered.splice(0)
    let settled = Promise.resolve()
    for (const event of buffered) {
      settled = this.enqueue(event)
    }
    await settled
  }

  async acceptBoundary(unsafeAcceptance: unknown): Promise<void> {
    this.assertActive()
    const acceptance = parseTerminalAuthorityNamespaceBoundaryAcceptance(unsafeAcceptance)
    if (!acceptance || !this.matchesExpected(acceptance.consumer, acceptance.namespace)) {
      throw new Error('daemon terminal authority boundary acceptance is invalid')
    }
    await this.options.client.request(DAEMON_TERMINAL_AUTHORITY_BOUNDARY_ACCEPT_REQUEST, acceptance)
  }

  async acknowledge(unsafeAck: unknown): Promise<number> {
    this.assertActive()
    const ack = parseTerminalAuthorityNamespaceOutcomeAck(unsafeAck)
    if (!ack || !this.matchesGrant(ack.consumer, ack.namespace)) {
      throw new Error('daemon terminal authority outcome ACK is invalid')
    }
    const result = await this.options.client.request<{ acknowledgedSequence?: unknown }>(
      DAEMON_TERMINAL_AUTHORITY_OUTCOME_ACK_REQUEST,
      ack
    )
    if (!Number.isSafeInteger(result.acknowledgedSequence)) {
      throw new Error('daemon terminal authority outcome ACK is invalid')
    }
    return Number(result.acknowledgedSequence)
  }

  async retire(requestId: string): Promise<TerminalAuthorityConsumerRetirementResult> {
    this.assertActive()
    const result = await this.options.retire(requestId)
    this.close(false)
    return result
  }

  retired(): void {
    this.close(false)
  }

  publish(event: DaemonTerminalAuthorityAppNamespaceEvent): void {
    if (!this.active || !this.matchesExpected(event.value.consumer, event.value.namespace)) {
      this.fail(new Error('daemon terminal authority namespace outcome is invalid'))
      return
    }
    if (!this.activated && event.kind === 'outcome') {
      if (this.buffered.length >= MAX_PREACTIVATION_EVENTS) {
        this.fail(new Error('daemon terminal authority preactivation events exceeded capacity'))
        return
      }
      this.buffered.push(event)
      return
    }
    void this.enqueue(event).catch(() => undefined)
  }

  disconnect(): void {
    this.close(true)
  }

  abandon(): void {
    this.close(false)
  }

  private close(cancel: boolean): void {
    if (!this.active) {
      return
    }
    this.active = false
    this.buffered.length = 0
    this.options.remove()
    if (!cancel) {
      return
    }
    const challenge = this.options.proof.challenge
    const grant = this.installedGrant
    void this.options.client
      .request(
        DAEMON_TERMINAL_AUTHORITY_CONSUMER_CANCEL_REQUEST,
        {
          version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
          consumer: grant?.consumer ?? this.expectedConsumer,
          namespace: grant?.namespace ?? challenge.namespace,
          requestId: grant?.requestId ?? challenge.requestId,
          connectionGrantId: grant?.connectionGrantId ?? challenge.connectionGrantId
        },
        5_000
      )
      .catch(() => undefined)
  }

  private enqueue(event: DaemonTerminalAuthorityAppNamespaceEvent): Promise<void> {
    const delivery = this.deliveryTail.then(async () => {
      this.assertActive()
      await (event.kind === 'boundary'
        ? this.options.transport.publishBoundary(event.value)
        : this.options.transport.publishOutcome(event.value))
    })
    this.deliveryTail = delivery.catch(() => undefined)
    void delivery.catch((error) => this.fail(error))
    return delivery
  }

  private assertGrant(
    grant: TerminalAuthorityNamespaceAdmissionGrant | null
  ): asserts grant is TerminalAuthorityNamespaceAdmissionGrant {
    const challenge = this.options.proof.challenge
    if (
      !grant ||
      !sameTerminalAuthorityPolicyConsumer(grant.consumer, this.expectedConsumer) ||
      !sameNamespace(grant.namespace, challenge.namespace) ||
      grant.requestId !== challenge.requestId ||
      grant.connectionGrantId !== challenge.connectionGrantId ||
      grant.admissionCas !==
        terminalAuthorityAdmissionCas(
          challenge.namespace,
          this.expectedConsumer.consumerId,
          this.expectedConsumer.consumerIncarnationId
        )
    ) {
      throw new TerminalAuthorityAppAdmissionRejectedError(
        'daemon terminal authority grant is invalid'
      )
    }
  }

  private matchesGrant(
    consumer: TerminalAuthorityNamespaceOutcomeBoundary['consumer'],
    namespace: TerminalAuthorityNamespace
  ): boolean {
    return (
      this.installedGrant !== null &&
      sameTerminalAuthorityPolicyConsumer(this.installedGrant.consumer, consumer) &&
      sameNamespace(this.installedGrant.namespace, namespace)
    )
  }

  private matchesExpected(
    consumer: TerminalAuthorityNamespaceOutcomeBoundary['consumer'],
    namespace: TerminalAuthorityNamespace
  ): boolean {
    return (
      sameTerminalAuthorityPolicyConsumer(this.expectedConsumer, consumer) &&
      sameNamespace(this.options.proof.challenge.namespace, namespace)
    )
  }

  private fail(error: unknown): void {
    if (!this.active) {
      return
    }
    this.disconnect()
    try {
      this.options.transport.onFailure?.(error instanceof Error ? error : new Error(String(error)))
    } catch {
      // The namespace is already fenced.
    }
  }

  private assertActive(): void {
    if (!this.active || !this.options.isCurrent()) {
      throw new Error('daemon terminal authority namespace connection is stale')
    }
  }
}

function sameNamespace(
  left: TerminalAuthorityNamespace,
  right: TerminalAuthorityNamespace
): boolean {
  return left.authorityHostId === right.authorityHostId && left.namespaceId === right.namespaceId
}
