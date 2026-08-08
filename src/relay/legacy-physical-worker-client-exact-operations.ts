import type { LegacyPhysicalWorkerRpc } from './legacy-physical-worker-client'

type ExactPtyIdentity = Readonly<{ id: string; incarnationId: string }>

type HeldProducerPauseIdentity = Readonly<{
  id: string
  clientGeneration: number
  ownerGeneration: number
  ptyIncarnationId: string
  heldPauseToken: string
  paused: boolean
}>

export class LegacyPhysicalWorkerClientExactOperations {
  constructor(
    private readonly rpc: LegacyPhysicalWorkerRpc,
    private readonly mutationMode: 'exact-v1' | 'legacy-fenced-v1'
  ) {}

  write(id: string, incarnationId: string, data: string): void {
    this.assertExactMutationMode()
    this.rpc.notify('pty.dataExact', { id, incarnationId, data })
  }

  resize(id: string, incarnationId: string, cols: number, rows: number): void {
    this.assertExactMutationMode()
    this.rpc.notify('pty.resizeExact', { id, incarnationId, cols, rows })
  }

  async signal(id: string, incarnationId: string, signal: string): Promise<boolean> {
    this.assertExactMutationMode()
    return await this.exactMutation('pty.sendSignalExact', { id, incarnationId, signal })
  }

  async clear(id: string, incarnationId: string): Promise<boolean> {
    this.assertExactMutationMode()
    return await this.exactMutation('pty.clearBufferExact', { id, incarnationId })
  }

  async shutdown(id: string, incarnationId: string, immediate: boolean): Promise<boolean> {
    this.assertExactMutationMode()
    return await this.exactMutation('pty.shutdownExact', { id, incarnationId, immediate })
  }

  async setHeldProducerPause(identity: HeldProducerPauseIdentity): Promise<boolean> {
    const result = await this.rpc.request('pty.setDeliveryPaused', identity)
    return acceptedResult(result, 'applied')
  }

  private async exactMutation(method: string, params: ExactPtyIdentity & Record<string, unknown>) {
    const result = await this.rpc.request(method, params)
    return acceptedResult(result, 'accepted')
  }

  private assertExactMutationMode(): void {
    if (this.mutationMode !== 'exact-v1') {
      throw new Error('legacy-fenced mutation requires registry verification')
    }
  }
}

function acceptedResult(value: unknown, field: 'accepted' | 'applied'): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)[field] === true
  )
}
