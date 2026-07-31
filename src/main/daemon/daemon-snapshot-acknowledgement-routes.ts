import type { IPtyProvider, PtyProviderBufferSnapshot } from '../providers/types'
import type { DaemonPtyAdapter } from './daemon-pty-adapter'

export class DaemonSnapshotAcknowledgementRoutes {
  private readonly producers = new Map<string, DaemonPtyAdapter>()

  async capture(
    sessionId: string,
    opts: { scrollbackRows?: number } | undefined,
    provider: IPtyProvider,
    adapters: readonly DaemonPtyAdapter[]
  ): Promise<PtyProviderBufferSnapshot | null> {
    const snapshot = (await provider.getBufferSnapshot?.(sessionId, opts)) ?? null
    this.recordAdapter(sessionId, snapshot, provider, adapters)
    return snapshot
  }

  record(
    sessionId: string,
    snapshot: PtyProviderBufferSnapshot | null,
    producer: DaemonPtyAdapter
  ): void {
    if (snapshot) {
      this.producers.set(sessionId, producer)
    } else {
      this.producers.delete(sessionId)
    }
  }

  recordAdapter(
    sessionId: string,
    snapshot: PtyProviderBufferSnapshot | null,
    provider: IPtyProvider,
    adapters: readonly DaemonPtyAdapter[]
  ): void {
    const producer = adapters.find((adapter) => adapter === provider)
    if (producer) {
      this.record(sessionId, snapshot, producer)
    } else {
      this.producers.delete(sessionId)
    }
  }

  acknowledge(sessionId: string): void {
    const producer = this.producers.get(sessionId)
    this.producers.delete(sessionId)
    producer?.ackColdRestore(sessionId)
  }

  drop(sessionId: string): void {
    this.producers.delete(sessionId)
  }
}
