import type {
  PtySourceCreditAck,
  PtySourceDeliveryIdentity
} from '../shared/pty-source-credit-contract'

export type LegacyPtyProxyCursorCheckpoint = Readonly<{
  checkpointId: string
  acknowledgementId: string
  identity: PtySourceDeliveryIdentity
  downstreamIdentity?: PtySourceDeliveryIdentity
  creditedEndSu: number
}>

export type LegacyPtyProxyCheckpointStore = Readonly<{
  commit: (checkpoint: LegacyPtyProxyCursorCheckpoint) => Promise<void>
}>

export type LegacyPtyProxyRestoredCursor = Readonly<{
  durableDownstreamAckedEndSu: number
  upstreamAckedEndSu: number
}>

export class LegacyPtyProxyCursor {
  private durableEndSu: number
  private publishedEndSu: number
  private requestedEndSu: number
  private drain: Promise<void> | null = null

  constructor(
    private readonly identity: PtySourceDeliveryIdentity,
    checkpointSourceEndSu: number,
    restored: LegacyPtyProxyRestoredCursor | undefined,
    private readonly store: LegacyPtyProxyCheckpointStore,
    private readonly publish: (ack: PtySourceCreditAck, acknowledgementId: string) => Promise<void>
  ) {
    const durableEndSu = restored?.durableDownstreamAckedEndSu ?? checkpointSourceEndSu
    const publishedEndSu = restored?.upstreamAckedEndSu ?? checkpointSourceEndSu
    if (
      !Number.isSafeInteger(checkpointSourceEndSu) ||
      checkpointSourceEndSu < 0 ||
      !Number.isSafeInteger(durableEndSu) ||
      !Number.isSafeInteger(publishedEndSu) ||
      publishedEndSu > durableEndSu ||
      durableEndSu < checkpointSourceEndSu
    ) {
      throw new Error('legacy PTY proxy restored cursor is invalid')
    }
    this.durableEndSu = durableEndSu
    this.publishedEndSu = publishedEndSu
    this.requestedEndSu = durableEndSu
  }

  get downstreamAckedEndSu(): number {
    return this.durableEndSu
  }

  get upstreamAckedEndSu(): number {
    return this.publishedEndSu
  }

  acknowledge(creditedEndSu: number): Promise<void> {
    if (creditedEndSu < this.durableEndSu) {
      return Promise.resolve()
    }
    this.requestedEndSu = Math.max(this.requestedEndSu, creditedEndSu)
    return this.startDrain()
  }

  retry(): Promise<void> {
    this.requestedEndSu = Math.max(this.requestedEndSu, this.durableEndSu)
    return this.startDrain()
  }

  private startDrain(): Promise<void> {
    if (this.drain) {
      return this.drain
    }
    const operation = Promise.resolve().then(() => this.commitAndPublishRequested())
    this.drain = operation
    void operation
      .finally(() => {
        if (this.drain === operation) {
          this.drain = null
        }
      })
      .catch(() => {})
    return operation
  }

  private async commitAndPublishRequested(): Promise<void> {
    while (true) {
      const requestedEndSu = this.requestedEndSu
      if (requestedEndSu > this.durableEndSu) {
        await this.store.commit(this.checkpoint(requestedEndSu))
        this.durableEndSu = requestedEndSu
      }
      if (this.durableEndSu > this.publishedEndSu) {
        const checkpoint = this.checkpoint(this.durableEndSu)
        await this.publish(
          {
            id: this.identity.id,
            clientGeneration: this.identity.clientGeneration,
            ownerGeneration: this.identity.ownerGeneration,
            deliveryToken: this.identity.deliveryToken,
            creditedEndSu: this.durableEndSu
          },
          checkpoint.acknowledgementId
        )
        this.publishedEndSu = this.durableEndSu
      }
      if (this.requestedEndSu <= this.durableEndSu && this.durableEndSu <= this.publishedEndSu) {
        return
      }
    }
  }

  private checkpoint(creditedEndSu: number): LegacyPtyProxyCursorCheckpoint {
    const checkpointId = `legacy-pty-cursor:${this.identity.providerGeneration}:${this.identity.deliveryToken}`
    return Object.freeze({
      checkpointId,
      acknowledgementId: `${checkpointId}:${creditedEndSu}`,
      identity: this.identity,
      creditedEndSu
    })
  }
}
