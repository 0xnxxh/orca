import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type {
  TerminalAuthorityDurableOutcome,
  TerminalAuthorityOutcome
} from '../../shared/terminal-session-authority-mutation'
import type { TerminalAuthorityConsumerAccess } from './terminal-session-authority-access'
import type { TerminalSessionAuthorityHostEffectApplierSlot } from './terminal-session-authority-host-effect-applier'
import type { TerminalSessionAuthorityRegistry } from './terminal-session-authority-registry'
import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'

const OUTCOME_READ_PAGE_SIZE = 64
const HOST_EFFECT_RETRY_MS = 100

export function terminalAuthorityHostEffectConsumerId(authorityHostId: string): string {
  return `host-effects:${authorityHostId}`
}

type HostEffectRuntime = {
  service: TerminalSessionAuthorityService
  consumer: TerminalAuthorityConsumerAccess
  observer: ReturnType<TerminalSessionAuthorityService['subscribeProjection']>
  requested: boolean
  pump: Promise<void> | null
  retryTimer: ReturnType<typeof setTimeout> | null
}

export class TerminalSessionAuthorityHostEffectConsumer {
  private readonly runtimes = new Map<string, Promise<HostEffectRuntime>>()
  private startPromise: Promise<void> | null = null
  private disposed = false

  constructor(
    private readonly registry: TerminalSessionAuthorityRegistry,
    private readonly consumerIncarnationId: string,
    private readonly applier: TerminalSessionAuthorityHostEffectApplierSlot
  ) {}

  start(): Promise<void> {
    this.startPromise ??= Promise.all(
      this.registry.registeredNamespaces().map(async ({ namespace }) => {
        const service = await this.registry.openNamespace(namespace)
        await this.ensure(service)
      })
    ).then(() => undefined)
    return this.startPromise
  }

  async ensure(service: TerminalSessionAuthorityService): Promise<void> {
    const runtime = await this.open(service)
    this.requestRuntime(runtime)
  }

  assertApplierInstalled(): void {
    if (!this.applier.isInstalled()) {
      throw new Error('terminal session authority host effect applier is unavailable')
    }
  }

  requestAll(): void {
    for (const opening of this.runtimes.values()) {
      void opening.then(
        (runtime) => this.requestRuntime(runtime),
        () => undefined
      )
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    for (const opening of this.runtimes.values()) {
      void opening.then(
        (runtime) => {
          if (runtime.retryTimer) {
            clearTimeout(runtime.retryTimer)
            runtime.retryTimer = null
          }
          try {
            runtime.service.revokeObserver(runtime.observer)
          } catch {
            // The authority service may already be closing.
          }
        },
        () => undefined
      )
    }
  }

  private open(service: TerminalSessionAuthorityService): Promise<HostEffectRuntime> {
    const key = namespaceKey(service.namespace)
    const existing = this.runtimes.get(key)
    if (existing) {
      return existing
    }
    const opening = this.openRuntime(service)
    this.runtimes.set(key, opening)
    void opening.catch(() => this.runtimes.delete(key))
    return opening
  }

  private async openRuntime(service: TerminalSessionAuthorityService): Promise<HostEffectRuntime> {
    const consumerId = terminalAuthorityHostEffectConsumerId(service.namespace.authorityHostId)
    const expectedIncarnationId = service.activeConsumerIncarnation(
      service.writerAccess,
      consumerId
    )
    const consumer = await service.claimConsumer(service.writerAccess, {
      consumerId,
      expectedIncarnationId,
      consumerIncarnationId: this.consumerIncarnationId
    })
    let runtime!: HostEffectRuntime
    const observer = service.subscribeProjection(consumerId, () => this.requestRuntime(runtime))
    runtime = {
      service,
      consumer,
      observer,
      requested: false,
      pump: null,
      retryTimer: null
    }
    return runtime
  }

  private requestRuntime(runtime: HostEffectRuntime): void {
    if (this.disposed) {
      return
    }
    if (runtime.retryTimer) {
      clearTimeout(runtime.retryTimer)
      runtime.retryTimer = null
    }
    runtime.requested = true
    this.startPump(runtime)
  }

  private startPump(runtime: HostEffectRuntime): void {
    if (runtime.pump) {
      return
    }
    const pump = this.runPump(runtime)
    runtime.pump = pump
    void pump.then(() => {
      if (runtime.pump !== pump) {
        return
      }
      runtime.pump = null
      if (runtime.requested) {
        this.startPump(runtime)
      }
    })
  }

  private async runPump(runtime: HostEffectRuntime): Promise<void> {
    while (runtime.requested) {
      runtime.requested = false
      try {
        await this.drain(runtime)
      } catch {
        this.scheduleRetry(runtime)
        return
      }
    }
  }

  private scheduleRetry(runtime: HostEffectRuntime): void {
    if (this.disposed || runtime.retryTimer) {
      return
    }
    runtime.retryTimer = setTimeout(() => {
      runtime.retryTimer = null
      this.requestRuntime(runtime)
    }, HOST_EFFECT_RETRY_MS)
    runtime.retryTimer.unref?.()
  }

  private async drain(runtime: HostEffectRuntime): Promise<void> {
    let cursor = (await runtime.service.snapshotForConsumer(runtime.consumer)).acknowledgedSequence
    while (true) {
      const snapshot = await runtime.service.snapshotForConsumer(runtime.consumer)
      if (cursor >= snapshot.outcomeHighWatermark) {
        return
      }
      const read = await runtime.service.readOutcomes(
        runtime.consumer,
        cursor,
        OUTCOME_READ_PAGE_SIZE
      )
      if (read.kind !== 'entries') {
        throw new Error(`terminal authority host effect replay requires ${read.reason}`)
      }
      if (read.entries.length === 0) {
        throw new Error('terminal authority host effect replay made no progress')
      }
      for (const outcome of read.entries) {
        await this.apply(outcome)
        cursor = outcome.sequence
      }
      await runtime.service.acknowledgeOutcomes(runtime.consumer, cursor)
    }
  }

  private async apply(outcome: TerminalAuthorityDurableOutcome): Promise<void> {
    if (outcome.kind === 'semantic') {
      return
    }
    await this.applyMutation(outcome)
  }

  private async applyMutation(outcome: TerminalAuthorityOutcome): Promise<void> {
    for (const effect of outcome.result.effects) {
      if (effect.kind !== 'binding-retired') {
        continue
      }
      await this.applier.ensureBindingRetired(
        Object.freeze({
          namespace: Object.freeze({ ...outcome.result.namespace }),
          pane: Object.freeze({
            paneKey: outcome.result.pane.paneKey,
            paneGenerationId: outcome.result.pane.paneGenerationId
          }),
          binding: Object.freeze({ ...effect.binding })
        }),
        effect.reason
      )
    }
  }
}

function namespaceKey(namespace: TerminalAuthorityNamespace): string {
  return JSON.stringify([namespace.authorityHostId, namespace.namespaceId])
}
