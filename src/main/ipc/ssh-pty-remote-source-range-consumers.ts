import {
  sameTerminalOutputSourceIdentity,
  type TerminalOutputSourceRange
} from '../../shared/terminal-output-source-range'
import type {
  RemoteTerminalSourceRangeConsumerHooks,
  RemoteTerminalSourceRangeStreamIdentity
} from '../runtime/remote-terminal-source-range-consumer'
import type { SshPtySourceConsumerId } from './ssh-pty-source-obligation-contract'
import type { SshPtySourceObligationCoordinator } from './ssh-pty-source-obligation-coordinator'

function remoteConsumerId(
  identity: RemoteTerminalSourceRangeStreamIdentity
): SshPtySourceConsumerId {
  return `remote:${identity.consumerId}`
}

function replacementConsumerId(
  identity: RemoteTerminalSourceRangeStreamIdentity
): SshPtySourceConsumerId {
  return `remote:snapshot:${identity.consumerId}`
}

function uniqueSpanIds(ranges: readonly TerminalOutputSourceRange[]): string[] {
  return Array.from(new Set(ranges.map((range) => range.spanId)))
}

type RemoteConsumerState = {
  streamGeneration: string
  spanGenerations: Map<string, number>
  ackedEndBySpan: Map<string, number>
}

export class SshPtyRemoteSourceRangeConsumers {
  private readonly consumersByPty = new Map<string, Map<string, RemoteConsumerState>>()

  constructor(
    private readonly coordinator: SshPtySourceObligationCoordinator,
    private readonly onProgress: (range: TerminalOutputSourceRange) => void = () => {}
  ) {}

  readonly hooks: RemoteTerminalSourceRangeConsumerHooks = {
    attach: (identity) => this.attach(identity),
    settle: (identity, ranges) => this.settle(identity, ranges),
    transfer: (identity, ranges, reason) => this.transfer(identity, ranges, reason),
    cancel: (identity, ranges, reason) => this.cancel(identity, ranges, reason)
  }

  requiredConsumers(ptyId: string): readonly SshPtySourceConsumerId[] {
    return Object.freeze(
      Array.from(this.consumersByPty.get(ptyId)?.keys() ?? []).map(
        (consumerId) => `remote:${consumerId}` as const
      )
    )
  }

  trackSpan(
    ptyId: string,
    spanId: string,
    requiredConsumers: readonly SshPtySourceConsumerId[]
  ): void {
    for (const [consumerId, state] of this.consumersByPty.get(ptyId) ?? []) {
      if (requiredConsumers.includes(`remote:${consumerId}`)) {
        state.spanGenerations.set(spanId, this.coordinator.spanIdentity(spanId).providerGeneration)
      }
    }
  }

  closeGeneration(providerGeneration: number): void {
    for (const consumers of this.consumersByPty.values()) {
      for (const state of consumers.values()) {
        for (const [spanId, generation] of state.spanGenerations) {
          if (generation === providerGeneration) {
            state.spanGenerations.delete(spanId)
            state.ackedEndBySpan.delete(spanId)
          }
        }
      }
    }
  }

  private attach(identity: RemoteTerminalSourceRangeStreamIdentity): boolean {
    const consumers =
      this.consumersByPty.get(identity.ptyId) ?? new Map<string, RemoteConsumerState>()
    const current = consumers.get(identity.consumerId)
    if (current && current.streamGeneration !== identity.streamGeneration) {
      return false
    }
    consumers.set(
      identity.consumerId,
      current ?? {
        streamGeneration: identity.streamGeneration,
        spanGenerations: new Map(),
        ackedEndBySpan: new Map()
      }
    )
    this.consumersByPty.set(identity.ptyId, consumers)
    return true
  }

  private settle(
    identity: RemoteTerminalSourceRangeStreamIdentity,
    ranges: readonly TerminalOutputSourceRange[]
  ): void {
    if (!this.isCurrent(identity)) {
      return
    }
    const state = this.requireState(identity)
    const consumer = remoteConsumerId(identity)
    const nextEnds = new Map(state.ackedEndBySpan)
    const completed = new Set<string>()
    for (const range of ranges) {
      if (!state.spanGenerations.has(range.spanId)) {
        continue
      }
      const source = this.coordinator.spanIdentity(range.spanId)
      const currentEnd = nextEnds.get(range.spanId) ?? source.sourceStartSu
      if (
        !sameTerminalOutputSourceIdentity(source, range) ||
        range.sourceStartSu !== currentEnd ||
        range.sourceEndSu > source.sourceEndSu
      ) {
        throw new Error('ssh_remote_source_range_settlement_invalid')
      }
      nextEnds.set(range.spanId, range.sourceEndSu)
      if (range.sourceEndSu === source.sourceEndSu) {
        completed.add(range.spanId)
      }
    }
    state.ackedEndBySpan = nextEnds
    for (const spanId of completed) {
      const source = this.coordinator.spanIdentity(spanId)
      this.coordinator.settle({
        identity: source,
        spanId,
        consumer,
        reason: 'remote-frame-ack'
      })
      state.spanGenerations.delete(spanId)
      state.ackedEndBySpan.delete(spanId)
    }
    for (const range of ranges) {
      this.onProgress(range)
    }
  }

  private transfer(
    identity: RemoteTerminalSourceRangeStreamIdentity,
    ranges: readonly TerminalOutputSourceRange[],
    reason: string
  ): void {
    if (!this.isCurrent(identity)) {
      throw new Error('ssh_remote_source_range_stale_generation')
    }
    const consumer = remoteConsumerId(identity)
    const replacement = replacementConsumerId(identity)
    const state = this.requireState(identity)
    const spanIds = Array.from(
      new Set([
        ...state.spanGenerations.keys(),
        ...uniqueSpanIds(ranges).filter((spanId) => state.spanGenerations.has(spanId))
      ])
    )
    for (const spanId of spanIds) {
      if (this.coordinator.obligation(spanId, consumer).state !== 'open') {
        throw new Error('ssh_remote_source_range_transfer_invalid')
      }
    }
    for (const spanId of spanIds) {
      const source = this.coordinator.spanIdentity(spanId)
      this.coordinator.beginTransfer({ identity: source, spanId, consumer, reason }, replacement)
    }
    for (const spanId of spanIds) {
      const source = this.coordinator.spanIdentity(spanId)
      this.coordinator.commitTransfer({ identity: source, spanId, consumer })
    }
    this.detachIdentity(identity)
    for (const range of ranges) {
      this.onProgress(range)
    }
  }

  private cancel(
    identity: RemoteTerminalSourceRangeStreamIdentity,
    ranges: readonly TerminalOutputSourceRange[],
    reason: string
  ): void {
    if (!this.isCurrent(identity)) {
      return
    }
    const consumer = remoteConsumerId(identity)
    const state = this.requireState(identity)
    const spanIds = new Set([
      ...state.spanGenerations.keys(),
      ...uniqueSpanIds(ranges).filter((spanId) => state.spanGenerations.has(spanId))
    ])
    for (const spanId of spanIds) {
      const source = this.coordinator.spanIdentity(spanId)
      const transition = { identity: source, spanId, consumer, reason }
      if (this.coordinator.beginTransfer(transition, consumer)) {
        this.coordinator.cancelTransfer(transition)
      }
    }
    this.detachIdentity(identity)
    for (const range of ranges) {
      this.onProgress(range)
    }
  }

  private isCurrent(identity: RemoteTerminalSourceRangeStreamIdentity): boolean {
    return (
      this.consumersByPty.get(identity.ptyId)?.get(identity.consumerId)?.streamGeneration ===
      identity.streamGeneration
    )
  }

  private requireState(identity: RemoteTerminalSourceRangeStreamIdentity): RemoteConsumerState {
    const state = this.consumersByPty.get(identity.ptyId)?.get(identity.consumerId)
    if (!state || state.streamGeneration !== identity.streamGeneration) {
      throw new Error('ssh_remote_source_range_stale_generation')
    }
    return state
  }

  private detachIdentity(identity: RemoteTerminalSourceRangeStreamIdentity): void {
    const consumers = this.consumersByPty.get(identity.ptyId)
    if (
      !consumers ||
      consumers.get(identity.consumerId)?.streamGeneration !== identity.streamGeneration
    ) {
      return
    }
    consumers.delete(identity.consumerId)
    if (consumers.size === 0) {
      this.consumersByPty.delete(identity.ptyId)
    }
  }
}
