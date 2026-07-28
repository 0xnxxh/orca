import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import type {
  SshPtyDataCallback,
  SshPtyDeliveryPauseAdapter,
  SshPtyExitCallback,
  SshPtyReplayCallback
} from './ssh-pty-provider-contract'
import { subscribeSshPtyNotifications } from './ssh-pty-notification-routing'

export class SshPtyProviderOutputState {
  private readonly dataListeners = new Set<SshPtyDataCallback>()
  private readonly replayListeners = new Set<SshPtyReplayCallback>()
  private readonly exitListeners = new Set<SshPtyExitCallback>()
  private readonly incarnationByRelayPtyId = new Map<string, string>()
  private readonly pausedRelayPtyIds = new Set<string>()
  private deliveryPauseAdapter: SshPtyDeliveryPauseAdapter | null = null
  private legacyIncarnationSerial = 1
  private unsubscribeNotifications: (() => void) | null

  constructor(
    private readonly providerGeneration: number,
    args: {
      mux: SshChannelMultiplexer
      toAppPtyId: (id: string) => string
      livePtyIds: Set<string>
      recordExit: (relayPtyId: string, incarnationId: unknown) => void
    }
  ) {
    this.unsubscribeNotifications = subscribeSshPtyNotifications({
      ...args,
      dataListeners: this.dataListeners,
      replayListeners: this.replayListeners,
      exitListeners: this.exitListeners,
      providerGeneration,
      resolvePtyIncarnation: (relayPtyId, incarnationId) =>
        this.resolvePtyIncarnation(relayPtyId, incarnationId),
      recordExit: (relayPtyId, incarnationId) => {
        args.recordExit(relayPtyId, incarnationId)
        this.incarnationByRelayPtyId.delete(relayPtyId)
        this.pausedRelayPtyIds.delete(relayPtyId)
      }
    })
  }

  dispose(): void {
    this.resumePausedDeliveries()
    this.unsubscribeNotifications?.()
    this.unsubscribeNotifications = null
    this.dataListeners.clear()
    this.replayListeners.clear()
    this.exitListeners.clear()
    this.incarnationByRelayPtyId.clear()
    this.deliveryPauseAdapter = null
  }

  onData(callback: SshPtyDataCallback): () => void {
    this.dataListeners.add(callback)
    return () => this.dataListeners.delete(callback)
  }

  onReplay(callback: SshPtyReplayCallback): () => void {
    this.replayListeners.add(callback)
    return () => this.replayListeners.delete(callback)
  }

  onExit(callback: SshPtyExitCallback): () => void {
    this.exitListeners.add(callback)
    return () => this.exitListeners.delete(callback)
  }

  setDeliveryPauseAdapter(adapter: SshPtyDeliveryPauseAdapter | null): void {
    if (adapter !== this.deliveryPauseAdapter) {
      this.resumePausedDeliveries()
    }
    this.deliveryPauseAdapter = adapter
  }

  hasDeliveryPauseAdapter(): boolean {
    return this.deliveryPauseAdapter !== null
  }

  pause(id: string): void {
    if (!this.deliveryPauseAdapter || this.pausedRelayPtyIds.has(id)) {
      return
    }
    this.pausedRelayPtyIds.add(id)
    this.deliveryPauseAdapter({ id, providerGeneration: this.providerGeneration, paused: true })
  }

  resume(id: string): void {
    if (!this.deliveryPauseAdapter || !this.pausedRelayPtyIds.delete(id)) {
      return
    }
    this.deliveryPauseAdapter({ id, providerGeneration: this.providerGeneration, paused: false })
  }

  rememberPtyIncarnation(relayPtyId: string, incarnationId: unknown): void {
    if (
      !this.incarnationByRelayPtyId.has(relayPtyId) &&
      typeof incarnationId === 'string' &&
      incarnationId.length > 0
    ) {
      this.incarnationByRelayPtyId.set(relayPtyId, incarnationId)
    }
  }

  private resolvePtyIncarnation(relayPtyId: string, incarnationId: unknown): string {
    this.rememberPtyIncarnation(relayPtyId, incarnationId)
    let resolved = this.incarnationByRelayPtyId.get(relayPtyId)
    if (!resolved) {
      resolved = `legacy:${this.providerGeneration}:${this.legacyIncarnationSerial++}:${relayPtyId}`
      this.incarnationByRelayPtyId.set(relayPtyId, resolved)
    }
    return resolved
  }

  private resumePausedDeliveries(): void {
    const adapter = this.deliveryPauseAdapter
    if (!adapter) {
      this.pausedRelayPtyIds.clear()
      return
    }
    for (const id of this.pausedRelayPtyIds) {
      try {
        adapter({ id, providerGeneration: this.providerGeneration, paused: false })
      } catch {
        /* Generation close is the fallback cleanup proof. */
      }
    }
    this.pausedRelayPtyIds.clear()
  }
}
