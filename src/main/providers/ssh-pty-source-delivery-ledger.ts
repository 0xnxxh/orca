import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import type { PtySourceReceivingActivation } from '../../shared/pty-source-receiving-activation'
import type { SshPtySourceFrame } from './ssh-pty-source-frame'

export type PendingSshPtySourceData = Readonly<{
  relayPtyId: string
  params: Record<string, unknown>
  data: string
  source?: SshPtySourceFrame
}>

type SourceDeliveryLeaseState = {
  phase: 'provisional' | 'committing' | 'committed' | 'retired'
  pendingData: PendingSshPtySourceData[]
}

type SourceDeliveryState = Readonly<{
  activation: PtySourceReceivingActivation
  sourceEndSu: number
  lease: SourceDeliveryLeaseState
  previous?: SourceDeliveryState
}>

export type SshPtyReceivingActivationLease = Readonly<{
  commit: () => void
  rollback: () => Promise<boolean>
}>

export class SshPtySourceDeliveryLedger {
  private readonly deliveryByPty = new Map<string, SourceDeliveryState>()

  constructor(
    private readonly mux: SshChannelMultiplexer,
    private readonly publishData: (pending: PendingSshPtySourceData) => void
  ) {}

  install(
    relayPtyId: string,
    activation: PtySourceReceivingActivation
  ): SshPtyReceivingActivationLease {
    if (!relayPtyId || activation.ptyIncarnation.length === 0) {
      throw new Error('ssh_source_receiving_activation_invalid')
    }
    const previous = this.deliveryByPty.get(relayPtyId)
    if (previous && sameReceivingActivation(previous.activation, activation)) {
      if (previous.lease.phase !== 'committed') {
        throw new Error('ssh_source_receiving_activation_stale')
      }
      return settledReceivingActivationLease()
    }
    if (
      previous &&
      (activation.clientGeneration <= previous.activation.clientGeneration ||
        activation.ownerGeneration <= previous.activation.ownerGeneration ||
        activation.deliveryToken === previous.activation.deliveryToken)
    ) {
      throw new Error('ssh_source_receiving_activation_stale')
    }
    return this.installProvisional(relayPtyId, activation, previous)
  }

  admit(pending: PendingSshPtySourceData & { source: SshPtySourceFrame }): boolean {
    const current = this.deliveryByPty.get(pending.relayPtyId)
    if (!acceptsSourceFrame(current, pending.params, pending.source)) {
      return false
    }
    const accepted = Object.freeze({
      ...current,
      sourceEndSu: pending.source.sourceEndSu
    }) as SourceDeliveryState
    this.deliveryByPty.set(pending.relayPtyId, accepted)
    if (accepted.lease.phase !== 'committed') {
      accepted.lease.pendingData.push(pending)
    } else {
      this.publishData(pending)
    }
    return true
  }

  recordExit(relayPtyId: string): void {
    if (this.deliveryByPty.get(relayPtyId)?.lease.phase === 'committed') {
      this.deliveryByPty.delete(relayPtyId)
    }
  }

  private installProvisional(
    relayPtyId: string,
    activation: PtySourceReceivingActivation,
    previous: SourceDeliveryState | undefined
  ): SshPtyReceivingActivationLease {
    const leaseState: SourceDeliveryLeaseState = {
      phase: 'provisional',
      pendingData: []
    }
    this.deliveryByPty.set(
      relayPtyId,
      Object.freeze({
        activation,
        sourceEndSu: activation.checkpointSourceEndSu,
        lease: leaseState,
        ...(previous ? { previous } : {})
      })
    )
    let settled = false
    let rollbackSettlement: Promise<boolean> | undefined
    return Object.freeze({
      commit: () => {
        if (settled) {
          return
        }
        settled = true
        this.commit(relayPtyId, leaseState)
      },
      rollback: () => {
        if (rollbackSettlement) {
          return rollbackSettlement
        }
        if (settled) {
          return Promise.resolve(false)
        }
        settled = true
        this.retire(relayPtyId, previous, leaseState)
        rollbackSettlement = settleExactSourceDeliveryCancellation(this.mux, relayPtyId, activation)
        return rollbackSettlement
      }
    })
  }

  private commit(relayPtyId: string, lease: SourceDeliveryLeaseState): void {
    if (this.deliveryByPty.get(relayPtyId)?.lease !== lease) {
      lease.phase = 'retired'
      lease.pendingData.splice(0)
      return
    }
    lease.phase = 'committing'
    while (lease.pendingData.length > 0) {
      this.publishData(lease.pendingData.shift()!)
    }
    lease.phase = 'committed'
    const current = this.deliveryByPty.get(relayPtyId)
    if (current?.lease === lease && current.previous) {
      this.deliveryByPty.set(
        relayPtyId,
        Object.freeze({
          activation: current.activation,
          sourceEndSu: current.sourceEndSu,
          lease: current.lease
        })
      )
    }
  }

  private retire(
    relayPtyId: string,
    previous: SourceDeliveryState | undefined,
    lease: SourceDeliveryLeaseState
  ): void {
    lease.phase = 'retired'
    lease.pendingData.splice(0)
    if (this.deliveryByPty.get(relayPtyId)?.lease !== lease) {
      return
    }
    const predecessor = activePredecessor(previous)
    if (predecessor) {
      this.deliveryByPty.set(relayPtyId, predecessor)
    } else {
      this.deliveryByPty.delete(relayPtyId)
    }
  }
}

function settledReceivingActivationLease(): SshPtyReceivingActivationLease {
  return Object.freeze({ commit: () => {}, rollback: async () => true })
}

function activePredecessor(
  previous: SourceDeliveryState | undefined
): SourceDeliveryState | undefined {
  let candidate = previous
  while (candidate?.lease.phase === 'retired') {
    candidate = candidate.previous
  }
  return candidate
}

function sameReceivingActivation(
  left: PtySourceReceivingActivation,
  right: PtySourceReceivingActivation
): boolean {
  return (
    left.clientGeneration === right.clientGeneration &&
    left.ownerGeneration === right.ownerGeneration &&
    left.ptyIncarnation === right.ptyIncarnation &&
    left.deliveryToken === right.deliveryToken &&
    left.checkpointSourceEndSu === right.checkpointSourceEndSu &&
    left.recoveryEndSu === right.recoveryEndSu
  )
}

function acceptsSourceFrame(
  current: SourceDeliveryState | undefined,
  params: Record<string, unknown>,
  source: SshPtySourceFrame
): current is SourceDeliveryState {
  return Boolean(
    current &&
    current.lease.phase !== 'retired' &&
    current.activation.ptyIncarnation === params.ptyIncarnation &&
    current.activation.deliveryToken === source.deliveryToken &&
    current.activation.clientGeneration === source.clientGeneration &&
    current.activation.ownerGeneration === source.ownerGeneration &&
    current.sourceEndSu === source.sourceStartSu
  )
}

async function settleExactSourceDeliveryCancellation(
  mux: SshChannelMultiplexer,
  relayPtyId: string,
  activation: PtySourceReceivingActivation
): Promise<boolean> {
  try {
    const result = (await mux.request('pty.cancelDelivery', {
      id: relayPtyId,
      clientGeneration: activation.clientGeneration,
      ownerGeneration: activation.ownerGeneration,
      deliveryToken: activation.deliveryToken
    })) as Record<string, unknown>
    return (
      result.canceled === true &&
      nonNegativeSafeInteger(result.sentEndSu) &&
      nonNegativeSafeInteger(result.creditedEndSu) &&
      result.creditedEndSu <= result.sentEndSu
    )
  } catch {
    return false
  }
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}
