import type {
  TerminalAuthorityConsumerProjection,
  TerminalAuthorityOutcomeRead,
  TerminalAuthoritySemanticOutcome,
  TerminalSessionAuthoritySemanticFact
} from '../../shared/terminal-session-authority-mutation'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import type { TerminalSessionAuthorityState } from '../../shared/terminal-session-authority-state'
import type {
  TerminalAuthorityConsumerAccess,
  TerminalAuthorityRuntimeAccess
} from './terminal-session-authority-access'
import type { TerminalAuthorityMutationPersistence } from './terminal-session-authority-mutation-persistence'
import type { TerminalSessionAuthorityLegacyMigration } from './terminal-session-authority-legacy-migration'
import { failTerminalSessionAuthority } from '../../shared/terminal-session-authority-mutation'

export type TerminalAuthorityConsumerClaim = Readonly<{
  consumerId: string
  expectedIncarnationId: string | null
  consumerIncarnationId: string
}>

export type TerminalAuthoritySemanticOutcomeInput = Readonly<{
  access: TerminalSessionAuthorityPtyAccess
  producerIncarnationId: string
  producerSequence: number
  fact: TerminalSessionAuthoritySemanticFact
}>

export type TerminalAuthorityConsumerClaimPlan = Readonly<{
  input: TerminalAuthorityConsumerClaim
  /** Absent when the claim is an exact duplicate of the active incarnation. */
  event: ReturnType<TerminalSessionAuthorityState['planConsumerClaim']>
}>

export type TerminalAuthorityPendingConsumerSnapshot = Readonly<{
  authority: TerminalAuthorityConsumerProjection['authority']
  acknowledgedSequence: number
  outcomeHighWatermark: number
}>

export class TerminalSessionAuthorityOutcomeConsumers {
  constructor(
    private readonly state: TerminalSessionAuthorityState,
    private readonly persistence: TerminalAuthorityMutationPersistence,
    private readonly accesses: TerminalAuthorityRuntimeAccess,
    private readonly legacyMigration: TerminalSessionAuthorityLegacyMigration
  ) {}

  /** Every fallible check, run before anything is sealed, so `settleClaim` after the append cannot fail. */
  async planClaim(
    input: TerminalAuthorityConsumerClaim
  ): Promise<TerminalAuthorityConsumerClaimPlan> {
    await this.persistence.assertWriterCurrent()
    this.legacyMigration.assertCanAdmitConsumer()
    return Object.freeze({
      input,
      event: this.state.planConsumerClaim(
        input.consumerId,
        input.expectedIncarnationId,
        input.consumerIncarnationId
      )
    })
  }

  appendClaim(plan: TerminalAuthorityConsumerClaimPlan): Promise<void> {
    return plan.event ? this.persistence.append(plan.event) : Promise.resolve()
  }

  /** Non-fallible finalizer; runs only once the claim is durable and applied. */
  settleClaim(plan: TerminalAuthorityConsumerClaimPlan): TerminalAuthorityConsumerAccess {
    this.legacyMigration.markConsumerClaimed()
    return this.accesses.consumer(plan.input.consumerId, plan.input.consumerIncarnationId)
  }

  async preview(
    input: TerminalAuthorityConsumerClaim
  ): Promise<TerminalAuthorityPendingConsumerSnapshot> {
    await this.persistence.assertWriterCurrent()
    this.legacyMigration.assertCanAdmitConsumer()
    return this.state.snapshotForConsumerClaim(
      input.consumerId,
      input.expectedIncarnationId,
      input.consumerIncarnationId
    )
  }

  /** The durable append happens here; publication only ever reads the ledger afterwards. */
  async record(
    input: TerminalAuthoritySemanticOutcomeInput
  ): Promise<TerminalAuthoritySemanticOutcome> {
    await this.persistence.assertWriterCurrent()
    const planned = this.state.planSemanticOutcome(input)
    if (!planned.duplicate) {
      await this.persistence.append(
        Object.freeze({ kind: 'semantic-outcome', outcome: planned.outcome })
      )
    }
    return planned.outcome
  }

  async acknowledge(access: TerminalAuthorityConsumerAccess, sequence: number): Promise<number> {
    await this.persistence.assertWriterCurrent()
    const event = this.state.planOutcomeAck(
      access.consumerId,
      access.consumerIncarnationId,
      sequence
    )
    if (event) {
      await this.persistence.append(event)
    }
    return sequence
  }

  async retire(access: TerminalAuthorityConsumerAccess): Promise<boolean> {
    await this.persistence.assertWriterCurrent()
    const event = this.state.planConsumerRetirement(access.consumerId, access.consumerIncarnationId)
    if (event) {
      await this.persistence.append(event)
    }
    return event !== null
  }

  async retireIdentity(consumerId: string, expectedIncarnationId: string | null): Promise<boolean> {
    await this.persistence.assertWriterCurrent()
    const currentIncarnationId = this.state.activeConsumerIncarnation(consumerId)
    if (currentIncarnationId !== expectedIncarnationId) {
      failTerminalSessionAuthority('consumer-conflict', 'consumer incarnation changed')
    }
    if (currentIncarnationId === null) {
      return false
    }
    const event = this.state.planConsumerRetirement(consumerId, currentIncarnationId)
    if (!event) {
      failTerminalSessionAuthority('consumer-conflict', 'consumer retirement changed')
    }
    await this.persistence.append(event)
    return true
  }

  async read(
    access: TerminalAuthorityConsumerAccess,
    afterSequence: number,
    limit?: number
  ): Promise<TerminalAuthorityOutcomeRead> {
    await this.persistence.assertWriterCurrent()
    return this.state.readOutcomes(
      access.consumerId,
      access.consumerIncarnationId,
      afterSequence,
      limit
    )
  }

  async snapshot(
    access: TerminalAuthorityConsumerAccess
  ): Promise<TerminalAuthorityConsumerProjection> {
    await this.persistence.assertWriterCurrent()
    return this.state.snapshotForConsumer(access.consumerId, access.consumerIncarnationId)
  }
}
