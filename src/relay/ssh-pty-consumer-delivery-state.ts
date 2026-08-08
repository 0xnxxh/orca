import type { PtyConsumerSessionGrant } from '../shared/pty-consumer-session'
import type {
  PtySourceDeliveryIdentity,
  PtySourceDeliverySnapshot,
  PtySourceSpan,
  PtySourceTransform
} from '../shared/pty-source-credit-contract'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import {
  admitsSshPtyDataPublication,
  sshPtyDeliveryMode,
  type SshPtyDeliveryMode
} from './ssh-pty-data-publication-admission'
import type { PtySourceSendReservation } from './pty-source-credit-ledger'
import { SshPtySourceCreditAdapter } from './ssh-pty-source-credit-adapter'

const MAX_HELD_PRODUCER_PAUSES = 4_096

type HeldProducerPause = Readonly<{
  id: string
  incarnationId: string
  token: string
  clientGeneration: number
  ownerGeneration: number
}>

export type SshPtyDeliveryPauseHandler = (
  id: string,
  paused: boolean,
  identity?: PtySourceDeliveryIdentity,
  heldPause?: Readonly<{ incarnationId: string; token: string }>
) => boolean | Promise<boolean> | void

export class SshPtyConsumerDeliveryState {
  private readonly sourceCredit: SshPtySourceCreditAdapter
  private readonly pausedDeliveryByPty = new Map<string, PtySourceDeliveryIdentity>()
  private readonly heldProducerPauses = new Map<string, HeldProducerPause>()

  constructor(
    dispatcher: RelayDispatcher,
    private readonly activeGrant: (clientId: number) => Readonly<PtyConsumerSessionGrant> | null,
    private readonly setDeliveryPaused?: SshPtyDeliveryPauseHandler,
    onSourceCreditAvailable?: (id: string, identity?: PtySourceDeliveryIdentity) => void
  ) {
    this.sourceCredit = new SshPtySourceCreditAdapter(
      (proof) =>
        dispatcher.notifyControl(
          'pty.deliveryCanceled',
          proof as unknown as Record<string, unknown>
        ),
      undefined,
      (identity) => onSourceCreditAvailable?.(identity.id, identity)
    )
    dispatcher.registerPtyDataPublicationAdmission((clientId, params) =>
      admitsSshPtyDataPublication(this.activeGrant(clientId), params, this.sourceCredit)
    )
    dispatcher.onNotification('pty.setDeliveryPaused', (params, context) => {
      this.setPausedDelivery(params, context)
    })
    dispatcher.onRequest('pty.setDeliveryPaused', async (params, context) =>
      this.setHeldProducerPause(params, context)
    )
    dispatcher.onNotification('pty.ackData', (params, context) => {
      this.sourceCredit.acknowledge(params, this.activeGrant(context.clientId))
    })
    dispatcher.onRequest('pty.cancelDelivery', async (params, context) =>
      this.sourceCredit.cancel(params, this.activeGrant(context.clientId))
    )
    dispatcher.onDisposed(() => this.dispose())
  }

  detach(grant: Readonly<PtyConsumerSessionGrant>): void {
    this.clearPausedForGrant(grant)
    this.clearHeldPausesForGrant(grant)
    this.sourceCredit.retainOrCloseOnDetach(grant)
  }

  open(
    clientId: number,
    id: string,
    ptyIncarnation: string,
    checkpointSourceEndSu = 0
  ): PtySourceDeliveryIdentity | null {
    return this.sourceCredit.open(
      this.activeGrant(clientId),
      id,
      ptyIncarnation,
      checkpointSourceEndSu
    )
  }

  rotate(oldIdentity: PtySourceDeliveryIdentity, newClientId: number, acceptedSourceEndSu: number) {
    this.clearPausedIdentity(oldIdentity)
    return this.sourceCredit.rotate(oldIdentity, this.activeGrant(newClientId), acceptedSourceEndSu)
  }

  append(
    identity: PtySourceDeliveryIdentity,
    input: Readonly<{
      spanId: string
      data: string
      displayStart: number
      displayEnd: number
      splittable: boolean
      transform: PtySourceTransform
    }>
  ): PtySourceSpan {
    return this.sourceCredit.append(identity, input)
  }

  reserveSend(
    identity: PtySourceDeliveryIdentity,
    maxSourceSu?: number
  ): PtySourceSendReservation | null {
    return this.sourceCredit.reserveSend(identity, maxSourceSu)
  }

  commitSend(reservation: PtySourceSendReservation): void {
    this.sourceCredit.commitSend(reservation)
  }

  rollbackSend(reservation: PtySourceSendReservation): void {
    this.sourceCredit.rollbackSend(reservation)
  }

  seal(identity: PtySourceDeliveryIdentity): void {
    this.sourceCredit.seal(identity)
  }

  settleExit(
    identity: PtySourceDeliveryIdentity,
    result: { ok: true } | { ok: false; error: Error }
  ): void {
    this.sourceCredit.settleExit(identity, result)
  }

  snapshot(identity: PtySourceDeliveryIdentity): PtySourceDeliverySnapshot {
    return this.sourceCredit.snapshot(identity)
  }

  snapshotIfKnown(identity: PtySourceDeliveryIdentity): PtySourceDeliverySnapshot | null {
    return this.sourceCredit.snapshotIfKnown(identity)
  }

  cancel(identity: PtySourceDeliveryIdentity, reason: string): void {
    this.clearPausedIdentity(identity)
    this.sourceCredit.cancelIdentity(identity, reason)
  }

  debugSnapshot(): Readonly<{
    deliveryTokens: number
    graceTimers: number
    sourceSu: number
    dataBytes: number
    spans: number
  }> {
    return this.sourceCredit.retentionSnapshot()
  }

  mode(clientId: number): SshPtyDeliveryMode {
    return sshPtyDeliveryMode(this.activeGrant(clientId))
  }

  private setPausedDelivery(params: Record<string, unknown>, context: RequestContext): void {
    const grant = this.activeGrant(context.clientId)
    if (
      !grant ||
      grant.clientGeneration !== params.clientGeneration ||
      grant.ownerGeneration !== params.ownerGeneration ||
      typeof params.id !== 'string' ||
      typeof params.paused !== 'boolean'
    ) {
      return
    }
    let identity: PtySourceDeliveryIdentity | null = null
    if (grant.capabilities?.outputFlowControl) {
      const token = typeof params.deliveryToken === 'string' ? params.deliveryToken : ''
      identity = this.sourceCredit.ownsDelivery(token, grant, params.id)
      if (!identity) {
        return
      }
      if (params.paused) {
        this.pausedDeliveryByPty.set(params.id, identity)
      } else if (this.pausedDeliveryByPty.get(params.id) !== identity) {
        return
      } else {
        this.pausedDeliveryByPty.delete(params.id)
      }
    }
    this.setDeliveryPaused?.(params.id, params.paused, identity ?? undefined)
  }

  private async setHeldProducerPause(
    params: Record<string, unknown>,
    context: RequestContext
  ): Promise<{ applied: boolean }> {
    const grant = this.activeGrant(context.clientId)
    const requestedPause = parseHeldProducerPause(params, grant)
    if (!requestedPause) {
      return { applied: false }
    }
    const key = heldProducerPauseKey(requestedPause)
    const current = this.heldProducerPauses.get(key)
    if (
      current &&
      (current.id !== requestedPause.id || current.incarnationId !== requestedPause.incarnationId)
    ) {
      return { applied: false }
    }
    if (requestedPause.paused && current) {
      return { applied: true }
    }
    if (requestedPause.paused && this.heldProducerPauses.size >= MAX_HELD_PRODUCER_PAUSES) {
      return { applied: false }
    }
    const applied =
      (await this.setDeliveryPaused?.(requestedPause.id, requestedPause.paused, undefined, {
        incarnationId: requestedPause.incarnationId,
        token: requestedPause.token
      })) === true
    if (requestedPause.paused && applied) {
      this.heldProducerPauses.set(key, requestedPause)
    } else if (!requestedPause.paused) {
      this.heldProducerPauses.delete(key)
    }
    return { applied }
  }

  private clearPausedIdentity(identity: PtySourceDeliveryIdentity): void {
    if (this.pausedDeliveryByPty.get(identity.id) === identity) {
      this.pausedDeliveryByPty.delete(identity.id)
      this.setDeliveryPaused?.(identity.id, false)
    }
  }

  private clearPausedForGrant(grant: Readonly<PtyConsumerSessionGrant>): void {
    for (const [id, identity] of this.pausedDeliveryByPty) {
      if (
        identity.clientGeneration === grant.clientGeneration &&
        identity.ownerGeneration === grant.ownerGeneration
      ) {
        this.pausedDeliveryByPty.delete(id)
        this.setDeliveryPaused?.(id, false)
      }
    }
  }

  private clearHeldPausesForGrant(grant: Readonly<PtyConsumerSessionGrant>): void {
    for (const [key, pause] of this.heldProducerPauses) {
      if (
        pause.clientGeneration === grant.clientGeneration &&
        pause.ownerGeneration === grant.ownerGeneration
      ) {
        this.heldProducerPauses.delete(key)
        this.releaseHeldProducerPause(pause)
      }
    }
  }

  private releaseHeldProducerPause(pause: HeldProducerPause): void {
    try {
      const releasing = this.setDeliveryPaused?.(pause.id, false, undefined, {
        incarnationId: pause.incarnationId,
        token: pause.token
      })
      void Promise.resolve(releasing).catch(() => undefined)
    } catch {
      /* PTY disposal is the final release boundary. */
    }
  }

  private dispose(): void {
    for (const id of this.pausedDeliveryByPty.keys()) {
      this.setDeliveryPaused?.(id, false)
    }
    for (const pause of this.heldProducerPauses.values()) {
      this.releaseHeldProducerPause(pause)
    }
    this.pausedDeliveryByPty.clear()
    this.heldProducerPauses.clear()
    this.sourceCredit.dispose()
  }
}

function parseHeldProducerPause(
  params: Record<string, unknown>,
  grant: Readonly<PtyConsumerSessionGrant> | null
): (HeldProducerPause & Readonly<{ paused: boolean }>) | null {
  if (
    grant?.role !== 'session-owner' ||
    grant.capabilities?.heldProducerPause?.version !== 1 ||
    grant.ownerGeneration === undefined ||
    grant.clientGeneration !== params.clientGeneration ||
    grant.ownerGeneration !== params.ownerGeneration ||
    typeof params.id !== 'string' ||
    params.id.length === 0 ||
    params.id.length > 4_096 ||
    typeof params.ptyIncarnationId !== 'string' ||
    params.ptyIncarnationId.length === 0 ||
    params.ptyIncarnationId.length > 512 ||
    typeof params.heldPauseToken !== 'string' ||
    params.heldPauseToken.length === 0 ||
    params.heldPauseToken.length > 512 ||
    typeof params.paused !== 'boolean'
  ) {
    return null
  }
  return Object.freeze({
    id: params.id,
    incarnationId: params.ptyIncarnationId,
    token: params.heldPauseToken,
    clientGeneration: grant.clientGeneration,
    ownerGeneration: grant.ownerGeneration,
    paused: params.paused
  })
}

function heldProducerPauseKey(pause: HeldProducerPause): string {
  return `${pause.clientGeneration}:${pause.ownerGeneration}:${pause.token}`
}
