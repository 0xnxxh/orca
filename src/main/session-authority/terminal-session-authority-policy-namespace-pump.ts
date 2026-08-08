import {
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
  type TerminalAuthorityNamespaceOutcomeAck,
  type TerminalAuthorityNamespaceOutcomeBoundary,
  type TerminalAuthorityPolicyConsumerIdentity
} from '../../shared/terminal-session-authority-consumer-transport'
import type { TerminalAuthorityConsumerAccess } from './terminal-session-authority-access'
import {
  composeTerminalAuthorityConsumerAdmissionSeals,
  type TerminalAuthorityConsumerAdmissionSeal
} from './terminal-session-authority-consumer-admission-seal'
import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'
import {
  prepareTerminalAuthorityPolicyConsumerClaim,
  terminalAuthorityPolicyConsumerBoundary,
  terminalAuthorityPolicyConsumerClaim
} from './terminal-session-authority-policy-consumer-claim'
import { TerminalSessionAuthorityPolicyConsumerLifecycle } from './terminal-session-authority-policy-consumer-lifecycle'
import type { TerminalAuthorityPolicyOutcomeTransport } from './terminal-session-authority-policy-outcome-transport'

const OUTCOME_READ_PAGE_SIZE = 64

export class TerminalSessionAuthorityPolicyNamespacePump {
  private consumer: TerminalAuthorityConsumerAccess | null = null
  private boundary: TerminalAuthorityNamespaceOutcomeBoundary | null = null
  private boundaryPublished = false
  private requested = false
  private pump: Promise<void> | null = null
  private published: Readonly<{ sequence: number; outcomeId: string }> | null = null
  private readonly lifecycle: TerminalSessionAuthorityPolicyConsumerLifecycle
  private stagedClaim: ReturnType<typeof terminalAuthorityPolicyConsumerClaim> | null = null
  private commitOperation: Promise<void> | null = null
  private expectedIncarnationId: string | null = null
  private consumerStart: 'new-at-tail' | 'resume' | null = null
  private active = true
  private activated = false

  constructor(
    readonly service: TerminalSessionAuthorityService,
    private readonly identity: TerminalAuthorityPolicyConsumerIdentity,
    private readonly claimedExpectedIncarnationId: string | null,
    private readonly transport: TerminalAuthorityPolicyOutcomeTransport,
    private readonly assertConnectionCurrent: () => void,
    private readonly onFailure: (error: unknown) => void
  ) {
    this.lifecycle = new TerminalSessionAuthorityPolicyConsumerLifecycle(service)
  }

  get isInstalled(): boolean {
    return this.active && this.consumer !== null && this.boundary !== null
  }

  prepare(): void {
    this.assertActive()
    const plan = prepareTerminalAuthorityPolicyConsumerClaim(
      this.service,
      this.identity,
      this.claimedExpectedIncarnationId
    )
    this.expectedIncarnationId = plan.expectedIncarnationId
    this.consumerStart = plan.consumerStart
  }

  async stage(): Promise<void> {
    this.assertActive()
    if (this.stagedClaim) {
      return
    }
    const claim = terminalAuthorityPolicyConsumerClaim(this.identity, this.expectedIncarnationId)
    const snapshot = await this.service.snapshotForConsumerClaim(this.service.writerAccess, claim)
    this.assertActive()
    this.boundary = terminalAuthorityPolicyConsumerBoundary(
      this.identity,
      this.requireConsumerStart(),
      snapshot
    )
    await this.transport.publishBoundary(this.boundary)
    this.assertActive()
    this.lifecycle.subscribe(this.identity.consumerId, () => {
      this.request()
    })
    this.stagedClaim = claim
  }

  async commit(seal?: TerminalAuthorityConsumerAdmissionSeal): Promise<void> {
    if (this.commitOperation) {
      return await this.commitOperation
    }
    const operation = this.commitClaim(seal)
    this.commitOperation = operation
    try {
      await operation
    } finally {
      if (this.commitOperation === operation) {
        this.commitOperation = null
      }
    }
  }

  // Nothing durable is rewound: recovery is a fresh authenticated resume against the claimed incarnation.
  async rollback(): Promise<void> {
    this.disconnect()
    this.lifecycle.revokeObserver()
    await this.commitOperation?.catch(() => undefined)
    this.consumer = null
    this.stagedClaim = null
    this.boundary = null
  }

  startDelivery(): void {
    this.assertPrepared()
    if (this.activated) {
      return
    }
    this.activated = true
    this.request()
  }

  async acknowledge(ack: TerminalAuthorityNamespaceOutcomeAck): Promise<number> {
    this.assertActivated()
    const consumer = this.requireConsumer()
    const snapshot = await this.service.snapshotForConsumer(consumer)
    this.assertActive()
    if (
      ack.sequence > snapshot.acknowledgedSequence &&
      (this.published?.sequence !== ack.sequence || this.published.outcomeId !== ack.outcomeId)
    ) {
      throw new Error('terminal authority policy consumer ACK was not published')
    }
    const sequence = await this.service.acknowledgeOutcomes(consumer, ack.sequence)
    this.assertActive()
    if (this.published?.sequence === ack.sequence) {
      this.published = null
    }
    this.releaseCaughtUpHold(sequence)
    this.request()
    return sequence
  }

  async retire(): Promise<boolean> {
    this.assertActivated()
    const retired = await this.service.retireConsumer(
      this.service.writerAccess,
      this.requireConsumer()
    )
    this.assertActive()
    this.lifecycle.releaseProducerHold()
    return retired
  }

  disconnect(): void {
    if (!this.active) {
      return
    }
    this.active = false
    this.requested = false
    this.lifecycle.releaseProducerHold()
    this.lifecycle.revokeObserver()
  }

  private request(): void {
    if (!this.active || !this.activated) {
      return
    }
    this.requested = true
    if (!this.pump) {
      this.startPump()
    }
  }

  private startPump(): void {
    const pump = this.runPump()
    this.pump = pump
    void pump.finally(() => {
      if (this.pump !== pump) {
        return
      }
      this.pump = null
      if (this.active && this.requested && !this.published) {
        this.startPump()
      }
    })
  }

  private async runPump(): Promise<void> {
    try {
      while (this.active && this.activated && this.requested) {
        this.requested = false
        if (!this.boundaryPublished) {
          await this.transport.publishBoundary(this.requireBoundary())
          this.assertActive()
          this.boundaryPublished = true
          this.releaseCaughtUpHold(this.requireBoundary().acknowledgedSequence)
        }
        if (this.published) {
          return
        }
        const consumer = this.requireConsumer()
        const snapshot = await this.service.snapshotForConsumer(consumer)
        this.assertActive()
        if (snapshot.acknowledgedSequence >= snapshot.outcomeHighWatermark) {
          this.releaseCaughtUpHold(snapshot.acknowledgedSequence)
          return
        }
        const read = await this.service.readOutcomes(
          consumer,
          snapshot.acknowledgedSequence,
          OUTCOME_READ_PAGE_SIZE
        )
        this.assertActive()
        if (read.kind !== 'entries' || read.entries.length === 0) {
          await this.resnapshot()
          continue
        }
        const outcome = read.entries[0]!
        const tail = read.entries.at(-1)!
        this.published = Object.freeze({
          sequence: tail.sequence,
          outcomeId: tail.outcomeId
        })
        await this.transport.publishOutcome(
          Object.freeze({
            version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
            consumer: this.identity,
            namespace: Object.freeze({ ...this.service.namespace }),
            previousSequence: snapshot.acknowledgedSequence,
            outcome,
            outcomes: read.entries
          })
        )
        this.assertActive()
      }
    } catch (error) {
      this.published = null
      if (this.active) {
        this.onFailure(error)
      }
    }
  }

  private async resnapshot(): Promise<void> {
    this.lifecycle.retainProducerHold()
    const snapshot = await this.service.snapshotForConsumer(this.requireConsumer())
    this.assertActive()
    this.boundary = terminalAuthorityPolicyConsumerBoundary(this.identity, 'resume', snapshot)
    this.boundaryPublished = false
    this.published = null
    this.requested = true
  }

  // The transport fence runs in seal(): a post-claim check could only be honoured by a durable rewind.
  private async commitClaim(seal?: TerminalAuthorityConsumerAdmissionSeal): Promise<void> {
    this.assertActive()
    const claim = this.requireStagedClaim()
    const admissionSeal = composeTerminalAuthorityConsumerAdmissionSeals([
      {
        seal: () => this.assertActive(),
        commit: (claimed) => {
          this.consumer = claimed
          this.boundaryPublished = true
        },
        abort: () => {}
      },
      seal
    ])
    await this.service.commitConsumerAdmission(this.service.writerAccess, claim, admissionSeal)
    this.releaseCaughtUpHold(this.requireBoundary().acknowledgedSequence)
  }

  private releaseCaughtUpHold(acknowledgedSequence: number): void {
    this.lifecycle.releaseCaughtUpHold(
      acknowledgedSequence,
      this.requireBoundary().outcomeHighWatermark
    )
  }

  private requireConsumer(): TerminalAuthorityConsumerAccess {
    if (!this.consumer) {
      throw new Error('terminal authority policy consumer is not prepared')
    }
    return this.consumer
  }

  private requireBoundary(): TerminalAuthorityNamespaceOutcomeBoundary {
    if (!this.boundary) {
      throw new Error('terminal authority policy consumer boundary is not prepared')
    }
    return this.boundary
  }

  private requireConsumerStart(): 'new-at-tail' | 'resume' {
    if (!this.consumerStart) {
      throw new Error('terminal authority policy consumer start is not prepared')
    }
    return this.consumerStart
  }

  private requireStagedClaim(): ReturnType<typeof terminalAuthorityPolicyConsumerClaim> {
    if (!this.stagedClaim) {
      throw new Error('terminal authority policy consumer claim is not staged')
    }
    return this.stagedClaim
  }

  private assertPrepared(): void {
    this.assertActive()
    this.requireConsumer()
    this.requireBoundary()
  }

  private assertActivated(): void {
    this.assertPrepared()
    if (!this.activated) {
      throw new Error('terminal authority policy consumer transport is not active')
    }
  }

  private assertActive(): void {
    if (!this.active) {
      throw new Error('terminal authority policy consumer transport is stale')
    }
    this.assertConnectionCurrent()
  }
}
