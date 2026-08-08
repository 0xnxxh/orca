import type {
  TerminalAuthorityDurableOutcome,
  TerminalAuthorityOutcome,
  TerminalSessionAuthorityEffect
} from '../shared/terminal-session-authority-mutation'
import {
  TERMINAL_AUTHORITY_OUTCOME_ACK_NOTIFICATION,
  TERMINAL_AUTHORITY_OUTCOME_DELIVERY_VERSION,
  parseTerminalAuthorityOutcomeDeliveryIdentity,
  terminalAuthorityOutcomeDeliveryKey,
  type TerminalAuthorityOutcomeDeliveryIdentity
} from '../shared/terminal-authority-outcome-delivery'
import type { RelayDispatcher } from './dispatcher'
import type { SshPtyConsumerSessionAdapter } from './ssh-pty-consumer-session-adapter'

const MAX_PENDING_AUTHORITY_OUTCOMES = 4_096

type TerminalExitedEffect = Extract<TerminalSessionAuthorityEffect, { kind: 'terminal-exited' }>

type PublishedClient = Readonly<{
  clientGeneration: number
  ownerGeneration: number
}>

type PendingOutcome = {
  outcome: TerminalAuthorityOutcome
  effect: TerminalExitedEffect
  identity: TerminalAuthorityOutcomeDeliveryIdentity
  promise: Promise<void>
  resolve: () => void
  publishedClients: Map<number, PublishedClient>
  orderedComplete: boolean
}

export type TerminalAuthorityOutcomeDeliveryAttempt = Readonly<{
  identity: TerminalAuthorityOutcomeDeliveryIdentity
  supportsClient: (clientId: number) => boolean
  markPublished: (clientIds: readonly number[]) => void
  markOrderedComplete: () => void
}>

export type TerminalAuthorityOutcomePublicationConsumer = (
  outcome: TerminalAuthorityOutcome,
  effect: TerminalExitedEffect,
  attempt: TerminalAuthorityOutcomeDeliveryAttempt
) => boolean

export class TerminalSessionAuthorityOutcomeDelivery {
  private readonly pending = new Map<string, PendingOutcome>()
  private readonly removeCapacityListener: () => void
  private readonly removeClientListener: () => void
  private readonly removeDisposeListener: () => void
  private consumer: TerminalAuthorityOutcomePublicationConsumer | null = null
  private disposed = false

  constructor(
    private readonly dispatcher: RelayDispatcher,
    private readonly session: SshPtyConsumerSessionAdapter
  ) {
    dispatcher.onNotification(TERMINAL_AUTHORITY_OUTCOME_ACK_NOTIFICATION, (params, context) => {
      this.acknowledge(context.clientId, params.authorityOutcome ?? params)
    })
    this.removeCapacityListener = dispatcher.onLegacyPtyCapacity(() => this.retryStandalone())
    this.removeClientListener = session.onTerminalAuthorityOutcomeDeliveryClient(() =>
      this.retryStandalone()
    )
    this.removeDisposeListener = dispatcher.onDisposed(() => this.dispose())
  }

  installConsumer(consumer: TerminalAuthorityOutcomePublicationConsumer): () => void {
    if (this.consumer) {
      throw new Error('terminal authority outcome publication consumer is already installed')
    }
    this.consumer = consumer
    return () => {
      if (this.consumer === consumer) {
        this.consumer = null
      }
    }
  }

  async publish(outcome: TerminalAuthorityDurableOutcome): Promise<void> {
    this.assertOpen()
    if (outcome.kind === 'semantic') {
      throw new Error('terminal authority semantic outcome delivery is unavailable')
    }
    const effect = terminalExitedEffect(outcome)
    if (!effect) {
      return
    }
    const identity = outcomeDeliveryIdentity(outcome, effect)
    const key = terminalAuthorityOutcomeDeliveryKey(identity)
    const current = this.pending.get(key)
    if (current) {
      await current.promise
      return
    }
    if (this.pending.size >= MAX_PENDING_AUTHORITY_OUTCOMES) {
      throw new Error('terminal authority outcome delivery capacity exceeded')
    }
    const pending = createPendingOutcome(outcome, effect, identity)
    this.pending.set(key, pending)
    const attempt = this.attemptFor(key, pending)
    let ordered = false
    try {
      ordered = this.consumer?.(outcome, effect, attempt) ?? false
    } catch (error) {
      this.pending.delete(key)
      throw error
    }
    if (!ordered) {
      pending.orderedComplete = true
      this.publishStandalone(pending)
    }
    await pending.promise
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.removeCapacityListener()
    this.removeClientListener()
    this.removeDisposeListener()
    this.consumer = null
    this.pending.clear()
  }

  private attemptFor(
    key: string,
    pending: PendingOutcome
  ): TerminalAuthorityOutcomeDeliveryAttempt {
    return Object.freeze({
      identity: pending.identity,
      supportsClient: (clientId) =>
        this.session.terminalAuthorityOutcomeDelivery(clientId) !== null,
      markPublished: (clientIds) => {
        if (this.pending.get(key) !== pending) {
          return
        }
        for (const clientId of clientIds) {
          const delivery = this.session.terminalAuthorityOutcomeDelivery(clientId)
          if (delivery) {
            pending.publishedClients.set(clientId, delivery)
          }
        }
      },
      markOrderedComplete: () => {
        if (this.pending.get(key) !== pending) {
          return
        }
        pending.orderedComplete = true
        this.publishStandalone(pending)
      }
    })
  }

  private acknowledge(clientId: number, rawIdentity: unknown): void {
    if (this.disposed) {
      return
    }
    const identity = parseTerminalAuthorityOutcomeDeliveryIdentity(rawIdentity)
    if (!identity) {
      return
    }
    const key = terminalAuthorityOutcomeDeliveryKey(identity)
    const pending = this.pending.get(key)
    const published = pending?.publishedClients.get(clientId)
    const current = this.session.terminalAuthorityOutcomeDelivery(clientId)
    if (
      !pending ||
      !published ||
      !current ||
      published.clientGeneration !== current.clientGeneration ||
      published.ownerGeneration !== current.ownerGeneration
    ) {
      return
    }
    this.pending.delete(key)
    pending.resolve()
  }

  private retryStandalone(): void {
    if (this.disposed) {
      return
    }
    for (const pending of this.pending.values()) {
      if (pending.orderedComplete) {
        this.publishStandalone(pending)
      }
    }
  }

  private publishStandalone(pending: PendingOutcome): void {
    const params = outcomeExitParams(pending.effect, pending.identity)
    for (const clientId of this.dispatcher.activeClientIds()) {
      const delivery = this.session.terminalAuthorityOutcomeDelivery(clientId)
      const published = pending.publishedClients.get(clientId)
      if (
        !delivery ||
        (published?.clientGeneration === delivery.clientGeneration &&
          published.ownerGeneration === delivery.ownerGeneration)
      ) {
        continue
      }
      let failedSynchronously = false
      const admitted = this.dispatcher.tryNotifyPtyExitToClient(clientId, params, (settlement) => {
        if (settlement.ok) {
          return
        }
        failedSynchronously = true
        const current = pending.publishedClients.get(clientId)
        if (
          current?.clientGeneration === delivery.clientGeneration &&
          current.ownerGeneration === delivery.ownerGeneration
        ) {
          pending.publishedClients.delete(clientId)
        }
      })
      if (admitted && !failedSynchronously) {
        pending.publishedClients.set(clientId, delivery)
      }
    }
  }

  private assertOpen(): void {
    if (this.disposed) {
      throw new Error('terminal authority outcome delivery is disposed')
    }
  }
}

function createPendingOutcome(
  outcome: TerminalAuthorityOutcome,
  effect: TerminalExitedEffect,
  identity: TerminalAuthorityOutcomeDeliveryIdentity
): PendingOutcome {
  let resolve!: () => void
  const promise = new Promise<void>((accept) => {
    resolve = accept
  })
  return {
    outcome,
    effect,
    identity,
    promise,
    resolve,
    publishedClients: new Map(),
    orderedComplete: false
  }
}

function terminalExitedEffect(outcome: TerminalAuthorityOutcome): TerminalExitedEffect | null {
  const effects = outcome.result.effects.filter(
    (effect): effect is TerminalExitedEffect => effect.kind === 'terminal-exited'
  )
  if (effects.length > 1) {
    throw new Error('terminal authority outcome has multiple terminal exit effects')
  }
  return effects[0] ?? null
}

function outcomeDeliveryIdentity(
  outcome: TerminalAuthorityOutcome,
  effect: TerminalExitedEffect
): TerminalAuthorityOutcomeDeliveryIdentity {
  const parsed = parseTerminalAuthorityOutcomeDeliveryIdentity({
    version: TERMINAL_AUTHORITY_OUTCOME_DELIVERY_VERSION,
    namespace: outcome.result.namespace,
    pane: {
      paneKey: outcome.result.pane.paneKey,
      paneGenerationId: outcome.result.pane.paneGenerationId
    },
    binding: effect.binding,
    outcomeId: outcome.outcomeId,
    sequence: outcome.sequence
  })
  if (!parsed) {
    throw new Error('terminal authority outcome delivery identity is invalid')
  }
  return parsed
}

function outcomeExitParams(
  effect: TerminalExitedEffect,
  identity: TerminalAuthorityOutcomeDeliveryIdentity
): Record<string, unknown> {
  return {
    id: effect.binding.physicalPtyId,
    code: effect.code ?? -1,
    incarnationId: effect.binding.ptyIncarnationId,
    authorityOutcome: identity
  }
}
