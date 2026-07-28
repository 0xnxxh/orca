import {
  samePtySourceDelivery,
  type PtySourceDeliveryIdentity,
  type PtySourceSpan
} from '../../shared/pty-source-credit-contract'
import {
  SshPtySourceAckCoalescer,
  type SshPtySourceAckCoalescerOptions
} from './ssh-pty-source-ack-coalescer'
import {
  SshPtySourceObligationLedger,
  type SshPtySourceAdmissionReservation,
  type SshPtySourceConsumerId,
  type SshPtySourceObligationState,
  type SshPtySourceTokenSnapshot
} from './ssh-pty-source-obligation-ledger'

export type SshPtySourceObligationTransition = Readonly<{
  identity: PtySourceDeliveryIdentity
  spanId: string
  consumer: SshPtySourceConsumerId
  reason: string
}>

export class SshPtySourceObligationCoordinator {
  private readonly ledger: SshPtySourceObligationLedger
  private readonly acknowledgements: SshPtySourceAckCoalescer
  private disposed = false

  constructor(options: SshPtySourceAckCoalescerOptions) {
    this.ledger = new SshPtySourceObligationLedger(options.onTokenClosed)
    this.acknowledgements = new SshPtySourceAckCoalescer(options)
  }

  open(identity: PtySourceDeliveryIdentity, checkpointSourceEndSu = 0): void {
    if (this.disposed) {
      throw new Error('SSH PTY source obligation coordinator is disposed')
    }
    this.ledger.open(identity, checkpointSourceEndSu)
  }

  reserve(
    identity: PtySourceDeliveryIdentity,
    span: PtySourceSpan,
    requiredConsumers: readonly SshPtySourceConsumerId[]
  ): SshPtySourceAdmissionReservation {
    return this.ledger.reserve(identity, span, requiredConsumers)
  }

  commit(reservation: SshPtySourceAdmissionReservation): void {
    this.ledger.commit(reservation)
  }

  rollback(reservation: SshPtySourceAdmissionReservation): boolean {
    return this.ledger.rollback(reservation)
  }

  rollbackCommitted(reservation: SshPtySourceAdmissionReservation): boolean {
    return this.ledger.rollbackCommitted(reservation)
  }

  settle(transition: SshPtySourceObligationTransition): boolean {
    this.requireSpanIdentity(transition)
    const changed = this.ledger.settle(transition.spanId, transition.consumer, transition.reason)
    this.queueEligibleAck(transition.identity)
    return changed
  }

  beginTransfer(transition: SshPtySourceObligationTransition, to: SshPtySourceConsumerId): boolean {
    this.requireSpanIdentity(transition)
    return this.ledger.beginTransfer(transition.spanId, transition.consumer, to, transition.reason)
  }

  commitTransfer(transition: Omit<SshPtySourceObligationTransition, 'reason'>): boolean {
    this.requireSpanIdentity(transition)
    const changed = this.ledger.commitTransfer(transition.spanId, transition.consumer)
    this.queueEligibleAck(transition.identity)
    return changed
  }

  cancelTransfer(transition: SshPtySourceObligationTransition): boolean {
    this.requireSpanIdentity(transition)
    const changed = this.ledger.cancelTransfer(
      transition.spanId,
      transition.consumer,
      transition.reason
    )
    this.queueEligibleAck(transition.identity)
    return changed
  }

  seal(identity: PtySourceDeliveryIdentity): void {
    this.ledger.seal(identity)
  }

  markExitPublished(identity: PtySourceDeliveryIdentity): void {
    this.queueEligibleAck(identity)
    this.ledger.markExitPublished(identity)
  }

  beginExitTimeout(identity: PtySourceDeliveryIdentity) {
    return this.ledger.beginExitTimeout(identity)
  }

  applyCancellationProof(
    identity: PtySourceDeliveryIdentity,
    proof: Readonly<{ sentEndSu: number; creditedEndSu: number }>
  ): void {
    this.ledger.applyCancellationProof(identity, proof)
  }

  closeGeneration(providerGeneration: number, reason: string): number {
    const closed = this.ledger.closeGeneration(providerGeneration, reason)
    this.acknowledgements.cancelGeneration(providerGeneration, reason)
    return closed
  }

  snapshot(identity: PtySourceDeliveryIdentity): SshPtySourceTokenSnapshot {
    return this.ledger.snapshot(identity)
  }

  obligation(spanId: string, consumer: SshPtySourceConsumerId): SshPtySourceObligationState {
    return this.ledger.obligation(spanId, consumer)
  }

  spanIdentity(spanId: string): PtySourceSpan {
    return this.ledger.spanIdentity(spanId)
  }

  flushAcknowledgements(): void {
    this.acknowledgements.flush()
  }

  dispose(reason?: string): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.ledger.closeAll(reason ?? 'SSH PTY source obligation coordinator disposed')
    this.acknowledgements.dispose(reason)
  }

  private queueEligibleAck(identity: PtySourceDeliveryIdentity): void {
    const publication = this.ledger.queueAck(identity)
    if (publication) {
      this.acknowledgements.enqueue(publication)
    }
  }

  private requireSpanIdentity(
    transition: Pick<SshPtySourceObligationTransition, 'identity' | 'spanId'>
  ): void {
    if (!samePtySourceDelivery(this.ledger.spanIdentity(transition.spanId), transition.identity)) {
      throw new Error('SSH PTY source obligation transition has a stale delivery identity')
    }
  }
}
