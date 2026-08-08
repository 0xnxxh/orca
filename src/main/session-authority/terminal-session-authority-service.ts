import type {
  TerminalAuthorityNamespace,
  TerminalPaneGeneration,
  TerminalSessionBinding
} from '../../shared/terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  type TerminalAuthorityProjection,
  type TerminalBindingAuthority,
  type TerminalSessionAuthorityMutationRequest
} from '../../shared/terminal-session-authority-mutation'
import type { TerminalSessionAuthorityState } from '../../shared/terminal-session-authority-state'
import type { TerminalAuthorityFileStore } from './terminal-session-authority-file-store'
import type {
  TerminalAuthorityRuntimeAccess,
  TerminalAuthorityConsumerAccess,
  TerminalAuthorityObserverAccess,
  TerminalAuthorityWriterAccess
} from './terminal-session-authority-access'
import type {
  TerminalAuthorityLegacyWorkerAccess,
  TerminalAuthorityMutationReceipt,
  TerminalAuthorityProjectionListener,
  TerminalSessionAuthorityServiceOptions
} from './terminal-session-authority-service-contract'
import type { TerminalAuthorityConsumerAdmissionSeal } from './terminal-session-authority-consumer-admission-seal'
import { openTerminalSessionAuthorityServiceState } from './terminal-session-authority-service-bootstrap'
import { TerminalAuthorityMutationPersistence } from './terminal-session-authority-mutation-persistence'
import { TerminalSessionAuthorityOperationQueue } from './terminal-session-authority-operation-queue'
import { TerminalSessionAuthorityLegacyMigration } from './terminal-session-authority-legacy-migration'
import { TerminalSessionAuthorityLegacyOperations } from './terminal-session-authority-legacy-operations'
import { TerminalAuthorityProjectionSubscriptions } from './terminal-session-authority-projection-subscriptions'
import {
  TerminalSessionAuthorityOutcomeConsumers,
  type TerminalAuthorityConsumerClaim,
  type TerminalAuthorityPendingConsumerSnapshot,
  type TerminalAuthoritySemanticOutcomeInput
} from './terminal-session-authority-outcome-consumers'

export class TerminalSessionAuthorityService {
  readonly writerAccess: TerminalAuthorityWriterAccess
  readonly namespace: TerminalAuthorityNamespace
  private readonly operations = new TerminalSessionAuthorityOperationQueue()
  private readonly legacyMigration: TerminalSessionAuthorityLegacyMigration
  private readonly persistence: TerminalAuthorityMutationPersistence
  private readonly projectionSubscriptions: TerminalAuthorityProjectionSubscriptions
  private readonly outcomeConsumers: TerminalSessionAuthorityOutcomeConsumers
  readonly legacy: TerminalSessionAuthorityLegacyOperations

  private constructor(
    private readonly state: TerminalSessionAuthorityState,
    store: TerminalAuthorityFileStore,
    private readonly accesses: TerminalAuthorityRuntimeAccess,
    legacyWorkerAccess: TerminalAuthorityLegacyWorkerAccess | undefined
  ) {
    this.namespace = state.namespace
    this.writerAccess = accesses.writer
    this.persistence = new TerminalAuthorityMutationPersistence(state, store, () => {
      this.operations.crash()
    })
    this.projectionSubscriptions = new TerminalAuthorityProjectionSubscriptions(state, accesses)
    this.legacyMigration = new TerminalSessionAuthorityLegacyMigration(
      state,
      this.persistence,
      accesses.writer.serviceInstanceId,
      legacyWorkerAccess
    )
    this.legacy = new TerminalSessionAuthorityLegacyOperations({
      state,
      migration: this.legacyMigration,
      enqueue: (operation) => this.operations.enqueue(operation),
      assertWriter: (writer) => this.assertWriter(writer),
      assertAccepting: () => this.operations.assertAccepting(),
      publish: (reason) => this.projectionSubscriptions.publish(reason)
    })
    this.outcomeConsumers = new TerminalSessionAuthorityOutcomeConsumers(
      state,
      this.persistence,
      accesses,
      this.legacyMigration
    )
  }

  static async open(
    options: TerminalSessionAuthorityServiceOptions
  ): Promise<TerminalSessionAuthorityService> {
    const normalizedOptions = {
      ...options,
      namespace: Object.freeze({ ...options.namespace })
    }
    const opened = await openTerminalSessionAuthorityServiceState(normalizedOptions)
    return new TerminalSessionAuthorityService(
      opened.state,
      opened.store,
      opened.accesses,
      normalizedOptions.legacyWorkerAccess
    )
  }

  claimConsumer(
    writer: TerminalAuthorityWriterAccess,
    input: TerminalAuthorityConsumerClaim
  ): Promise<TerminalAuthorityConsumerAccess> {
    return this.commitConsumerAdmission(writer, input)
  }

  /**
   * The only path that publishes a durable `consumer-claim`. One namespace-queue operation: every
   * fallible check, then seal, then append, then a finalizer that cannot fail. Nothing durable is
   * rewound — a pre-append or append failure aborts the seal, and a failure after the write fences the
   * service, so recovery is a fresh authenticated proof rather than a compensating write.
   */
  commitConsumerAdmission(
    writer: TerminalAuthorityWriterAccess,
    input: TerminalAuthorityConsumerClaim,
    seal?: TerminalAuthorityConsumerAdmissionSeal
  ): Promise<TerminalAuthorityConsumerAccess> {
    const claim = structuredClone(input)
    return this.operations.enqueue(async () => {
      this.assertWriter(writer)
      const plan = await this.outcomeConsumers.planClaim(claim)
      seal?.seal()
      try {
        await this.outcomeConsumers.appendClaim(plan)
      } catch (error) {
        seal?.abort()
        throw error
      }
      const access = this.outcomeConsumers.settleClaim(plan)
      seal?.commit(access)
      return access
    })
  }

  snapshotForConsumerClaim(
    writer: TerminalAuthorityWriterAccess,
    input: TerminalAuthorityConsumerClaim
  ): Promise<TerminalAuthorityPendingConsumerSnapshot> {
    const claim = structuredClone(input)
    return this.operations.enqueue(async () => {
      this.assertWriter(writer)
      return this.outcomeConsumers.preview(claim)
    })
  }

  mutate(
    writer: TerminalAuthorityWriterAccess,
    unsafeRequest: TerminalSessionAuthorityMutationRequest
  ): Promise<TerminalAuthorityMutationReceipt> {
    const request = structuredClone(unsafeRequest)
    return this.operations.enqueueProducer(async () => {
      this.assertWriter(writer)
      await this.persistence.assertWriterCurrent()
      if (request.actorId !== writer.actorId) {
        failTerminalSessionAuthority('writer-fenced', 'mutation authority identity changed')
      }
      const planned = this.state.planMutation(request)
      if (!planned.duplicate) {
        this.legacyMigration.assertCanMutate()
        await this.persistence.append(Object.freeze({ kind: 'mutation', outcome: planned.outcome }))
        this.projectionSubscriptions.publish('mutation')
      }
      return Object.freeze({
        result: structuredClone(planned.outcome.result),
        outcomeSequence: planned.outcome.sequence
      })
    })
  }

  recordSemanticOutcome(
    writer: TerminalAuthorityWriterAccess,
    unsafeInput: TerminalAuthoritySemanticOutcomeInput
  ): ReturnType<TerminalSessionAuthorityOutcomeConsumers['record']> {
    const input = structuredClone(unsafeInput)
    return this.operations.enqueueProducer(async () => {
      this.assertWriter(writer)
      const outcome = await this.outcomeConsumers.record(input)
      this.projectionSubscriptions.publish('outcome')
      return outcome
    })
  }

  acknowledgeOutcomes(
    consumer: TerminalAuthorityConsumerAccess,
    sequence: number
  ): Promise<number> {
    return this.operations.enqueue(async () => {
      this.assertConsumerAccess(consumer)
      return this.outcomeConsumers.acknowledge(consumer, sequence)
    })
  }

  retireConsumer(
    writer: TerminalAuthorityWriterAccess,
    consumer: TerminalAuthorityConsumerAccess
  ): Promise<boolean> {
    return this.operations.enqueue(async () => {
      this.assertWriter(writer)
      this.accesses.assertConsumerService(consumer)
      return this.outcomeConsumers.retire(consumer)
    })
  }

  retireConsumerIdentity(
    writer: TerminalAuthorityWriterAccess,
    consumerId: string,
    expectedIncarnationId: string | null
  ): Promise<boolean> {
    return this.operations.enqueue(async () => {
      this.assertWriter(writer)
      return this.outcomeConsumers.retireIdentity(consumerId, expectedIncarnationId)
    })
  }

  readOutcomes(
    consumer: TerminalAuthorityConsumerAccess,
    afterSequence: number,
    limit?: number
  ): ReturnType<TerminalSessionAuthorityOutcomeConsumers['read']> {
    return this.operations.enqueue(async () => {
      this.assertConsumerAccess(consumer)
      return this.outcomeConsumers.read(consumer, afterSequence, limit)
    })
  }

  snapshotForConsumer(
    consumer: TerminalAuthorityConsumerAccess
  ): ReturnType<TerminalSessionAuthorityOutcomeConsumers['snapshot']> {
    return this.operations.enqueue(async () => {
      this.assertConsumerAccess(consumer)
      return this.outcomeConsumers.snapshot(consumer)
    })
  }

  observe(actorId: string): TerminalAuthorityObserverAccess {
    this.operations.assertAccepting()
    return this.projectionSubscriptions.observe(actorId)
  }

  subscribeProjection(
    actorId: string,
    listener: TerminalAuthorityProjectionListener
  ): TerminalAuthorityObserverAccess {
    this.operations.assertAccepting()
    return this.projectionSubscriptions.subscribe(actorId, listener)
  }

  revokeObserver(access: TerminalAuthorityObserverAccess): void {
    this.operations.assertAccepting()
    this.projectionSubscriptions.revoke(access)
  }

  snapshotForObserver(access: TerminalAuthorityObserverAccess): TerminalAuthorityProjection {
    this.operations.assertAccepting()
    this.accesses.assertObserver(access)
    return this.state.projection()
  }

  snapshotForWriter(access: TerminalAuthorityWriterAccess): TerminalAuthorityProjection {
    this.operations.assertAccepting()
    this.accesses.assertWriter(access)
    return this.state.projection()
  }

  activeConsumerIncarnation(
    access: TerminalAuthorityWriterAccess,
    consumerId: string
  ): string | null {
    this.operations.assertAccepting()
    this.accesses.assertWriter(access)
    return this.state.activeConsumerIncarnation(consumerId)
  }

  acquireProducerHold(access: TerminalAuthorityWriterAccess): Readonly<{ release(): void }> {
    this.operations.assertAccepting()
    this.accesses.assertWriter(access)
    return this.operations.acquireProducerHold()
  }

  bindingAuthority(
    access: TerminalAuthorityWriterAccess | TerminalAuthorityObserverAccess,
    pane: TerminalPaneGeneration,
    binding: TerminalSessionBinding
  ): TerminalBindingAuthority {
    this.operations.assertAccepting()
    this.accesses.assertBindingAuthorityReader(access)
    return this.state.bindingAuthority(pane, binding)
  }

  compact(writer: TerminalAuthorityWriterAccess): Promise<void> {
    return this.operations.enqueue(async () => {
      this.assertWriter(writer)
      await this.persistence.compact(this.state.snapshot())
    })
  }

  close(): Promise<void> {
    return this.operations.close(async () => {
      this.accesses.clear()
      this.projectionSubscriptions.clear()
      await this.persistence.close()
    })
  }

  private assertWriter(access: TerminalAuthorityWriterAccess): void {
    this.operations.assertProcessing()
    this.accesses.assertWriter(access)
  }

  private assertConsumerAccess(access: TerminalAuthorityConsumerAccess): void {
    this.operations.assertProcessing()
    this.accesses.assertConsumerService(access)
    this.state.readOutcomes(access.consumerId, access.consumerIncarnationId, 0, 1)
  }
}
