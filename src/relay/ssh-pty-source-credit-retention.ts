import {
  PTY_CONSUMER_OWNER_GRACE_MS,
  type PtyConsumerSessionGrant
} from '../shared/pty-consumer-session'
import type {
  PtySourceDeliveryCancellation,
  PtySourceDeliveryIdentity
} from '../shared/pty-source-credit-contract'
import { RecentPtySourceCancellationIndex } from './pty-source-cancellation-index'
import { notifyPtySourceCreditAvailability } from './pty-source-credit-notification'
import { RelayPtySourceCreditLedger } from './pty-source-credit-ledger'

export class SshPtySourceCreditRetention {
  readonly sourceCredit = new RelayPtySourceCreditLedger()
  readonly identityByToken = new Map<string, PtySourceDeliveryIdentity>()
  readonly graceTimers = new Map<number, ReturnType<typeof setTimeout>>()
  readonly recentCancellations = new RecentPtySourceCancellationIndex()
  readonly relayProviderGeneration = 1

  constructor(
    private readonly publishCancellation?: (proof: PtySourceDeliveryCancellation) => void,
    private readonly onCreditAvailable?: (id: string) => void,
    private readonly onExactCreditAvailable?: (identity: PtySourceDeliveryIdentity) => void
  ) {}

  notifyCreditAvailable(identity: PtySourceDeliveryIdentity): void {
    notifyPtySourceCreditAvailability(this.onCreditAvailable, this.onExactCreditAvailable, identity)
  }

  publishCancellationProof(proof: PtySourceDeliveryCancellation): void {
    this.publishCancellation?.(proof)
  }

  pruneClosed(token: string, identity: PtySourceDeliveryIdentity): void {
    if (
      this.sourceCredit.snapshot(identity).state === 'closed' &&
      this.identityByToken.get(token) === identity
    ) {
      this.identityByToken.delete(token)
      this.clearGraceWhenSettled(identity.ownerGeneration)
    }
  }

  clearGraceWhenSettled(ownerGeneration: number): void {
    if (!this.hasOwnerDeliveries(ownerGeneration)) {
      this.clearGraceTimer(ownerGeneration)
    }
  }

  retainOrCloseOnDetach(grant: Readonly<PtyConsumerSessionGrant>): void {
    if (grant.role === 'session-owner' && grant.capabilities?.outputFlowControl) {
      if (this.hasOwnerDeliveries(grant.ownerGeneration!)) {
        this.scheduleGraceExpiry(grant.ownerGeneration!)
      }
      return
    }
    this.closeClientDeliveries(grant.clientGeneration)
  }

  cancelIdentity(identity: PtySourceDeliveryIdentity, reason: string): void {
    const token = identity.deliveryToken
    if (this.identityByToken.get(token) !== identity) {
      return
    }
    this.cancelExact(token, identity, reason)
  }

  dispose(): void {
    this.graceTimers.forEach((timer) => clearTimeout(timer))
    this.graceTimers.clear()
    this.sourceCredit.closeGeneration(this.relayProviderGeneration)
    this.identityByToken.clear()
    this.recentCancellations.clear()
  }

  private closeClientDeliveries(clientGeneration: number): void {
    for (const [token, identity] of this.identityByToken) {
      if (identity.clientGeneration !== clientGeneration) {
        continue
      }
      this.cancelExact(token, identity, 'client-detached')
      this.notifyCreditAvailable(identity)
    }
  }

  private scheduleGraceExpiry(ownerGeneration: number): void {
    this.clearGraceTimer(ownerGeneration)
    const timer = setTimeout(() => {
      this.graceTimers.delete(ownerGeneration)
      for (const [token, identity] of this.identityByToken) {
        if (identity.ownerGeneration !== ownerGeneration) {
          continue
        }
        this.cancelExact(token, identity, 'reconnect-grace-expired')
        this.notifyCreditAvailable(identity)
      }
    }, PTY_CONSUMER_OWNER_GRACE_MS)
    timer.unref?.()
    this.graceTimers.set(ownerGeneration, timer)
  }

  private cancelExact(token: string, identity: PtySourceDeliveryIdentity, reason: string): void {
    const snapshot = this.sourceCredit.snapshotIfKnown(identity)
    if (snapshot && snapshot.state !== 'closed') {
      const proof = this.sourceCredit.cancel(identity, reason)
      this.recentCancellations.remember(proof)
      this.publishCancellationProof(proof)
    }
    if (this.identityByToken.get(token) === identity) {
      this.identityByToken.delete(token)
    }
    this.clearGraceWhenSettled(identity.ownerGeneration)
  }

  private hasOwnerDeliveries(ownerGeneration: number): boolean {
    return Array.from(this.identityByToken.values()).some(
      (identity) => identity.ownerGeneration === ownerGeneration
    )
  }

  private clearGraceTimer(ownerGeneration: number): void {
    clearTimeout(this.graceTimers.get(ownerGeneration))
    this.graceTimers.delete(ownerGeneration)
  }
}
