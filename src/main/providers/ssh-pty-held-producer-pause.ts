import type { PtyIncarnationId } from '../../shared/pty-incarnation'
import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'

const SSH_HELD_PRODUCER_PAUSE_TIMEOUT_MS = 10_000

export type SshPtyHeldProducerPauseCapability = Readonly<{
  version: 1
  clientGeneration: number
  ownerGeneration: number
  isCurrentProviderGeneration: () => boolean
}>

type SshPtyHeldProducerPauseOptions = {
  mux: SshChannelMultiplexer
  capability?: SshPtyHeldProducerPauseCapability
  toRelayPtyId: (id: string) => string
  getPtyIncarnation: (relayPtyId: string) => string | undefined
}

export class SshPtyHeldProducerPause {
  constructor(private readonly options: SshPtyHeldProducerPauseOptions) {}

  supports(id: string, incarnationId: PtyIncarnationId): boolean {
    const relayPtyId = this.options.toRelayPtyId(id)
    return Boolean(
      this.options.capability?.version === 1 &&
      this.options.capability.isCurrentProviderGeneration() &&
      this.options.getPtyIncarnation(relayPtyId) === incarnationId
    )
  }

  async acquire(id: string, incarnationId: PtyIncarnationId, token: string): Promise<boolean> {
    if (!this.supports(id, incarnationId)) {
      return false
    }
    const applied = await this.request(id, incarnationId, token, true)
    if (applied && !this.options.capability?.isCurrentProviderGeneration()) {
      await this.request(id, incarnationId, token, false).catch(() => false)
      return false
    }
    return applied
  }

  async release(id: string, incarnationId: PtyIncarnationId, token: string): Promise<boolean> {
    if (!this.options.capability || this.options.mux.isDisposed()) {
      return false
    }
    return await this.request(id, incarnationId, token, false)
  }

  private async request(
    id: string,
    incarnationId: PtyIncarnationId,
    token: string,
    paused: boolean
  ): Promise<boolean> {
    const capability = this.options.capability
    if (!capability) {
      return false
    }
    const response = (await this.options.mux.request(
      'pty.setDeliveryPaused',
      {
        id: this.options.toRelayPtyId(id),
        paused,
        clientGeneration: capability.clientGeneration,
        ownerGeneration: capability.ownerGeneration,
        ptyIncarnationId: incarnationId,
        heldPauseToken: token
      },
      { timeoutMs: SSH_HELD_PRODUCER_PAUSE_TIMEOUT_MS }
    )) as { applied?: unknown }
    return response?.applied === true
  }
}
