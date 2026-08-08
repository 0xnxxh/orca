import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'

export class TerminalSessionAuthorityPolicyConsumerLifecycle {
  private observer: ReturnType<TerminalSessionAuthorityService['subscribeProjection']> | null = null
  private producerHold: Readonly<{ release(): void }> | null = null

  constructor(private readonly service: TerminalSessionAuthorityService) {
    this.retainProducerHold()
  }

  subscribe(consumerId: string, onProjection: () => void): void {
    this.observer = this.service.subscribeProjection(consumerId, onProjection)
  }

  revokeObserver(): void {
    const observer = this.observer
    this.observer = null
    if (!observer) {
      return
    }
    try {
      this.service.revokeObserver(observer)
    } catch {
      // The authority service may already be closing.
    }
  }

  retainProducerHold(): void {
    this.producerHold ??= this.service.acquireProducerHold(this.service.writerAccess)
  }

  releaseCaughtUpHold(acknowledgedSequence: number, outcomeHighWatermark: number): void {
    if (acknowledgedSequence >= outcomeHighWatermark) {
      this.releaseProducerHold()
    }
  }

  releaseProducerHold(): void {
    const hold = this.producerHold
    this.producerHold = null
    hold?.release()
  }
}
