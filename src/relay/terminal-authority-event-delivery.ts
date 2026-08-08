import type { TerminalAuthorityEventMethod } from '../shared/terminal-authority-routing'
import type { RelayDispatcher, SinkWriteSettlement } from './dispatcher'
import { MAX_MESSAGE_SIZE } from './protocol'

export type BufferedAuthorityEvent = Readonly<{
  method: TerminalAuthorityEventMethod
  params: Record<string, unknown>
  bytes: number
}>

type PtyDeliveryFence = {
  ptyId: string
  pendingDataSettlements: number
  events: BufferedAuthorityEvent[]
  draining: boolean
}

export class TerminalAuthorityEventBuffer {
  private bytes = 0

  push(
    target: BufferedAuthorityEvent[],
    method: TerminalAuthorityEventMethod,
    params: Record<string, unknown>
  ): boolean {
    const bytes = Buffer.byteLength(JSON.stringify({ method, params }), 'utf8')
    if (this.bytes + bytes > MAX_MESSAGE_SIZE) {
      return false
    }
    target.push({ method, params, bytes })
    this.bytes += bytes
    return true
  }

  release(events: readonly BufferedAuthorityEvent[]): void {
    for (const event of events) {
      this.bytes -= event.bytes
    }
  }

  clear(): void {
    this.bytes = 0
  }
}

export class TerminalAuthorityEventDelivery {
  private readonly fences = new Map<string, PtyDeliveryFence>()

  constructor(
    private readonly dispatcher: RelayDispatcher,
    private readonly buffer: TerminalAuthorityEventBuffer,
    private readonly activeClientId: () => number | null,
    private readonly onFailure: (error: Error) => void
  ) {}

  clear(): void {
    for (const fence of this.fences.values()) {
      this.buffer.release(fence.events)
    }
    this.fences.clear()
  }

  publish(method: TerminalAuthorityEventMethod, params: Record<string, unknown>): void {
    if (this.activeClientId() === null) {
      this.onFailure(new Error(`Terminal authority event has no admitted client: ${method}`))
      return
    }
    const ptyId = method === 'agent.hook' ? null : this.parsePtyId(params)
    if (method !== 'agent.hook' && ptyId === null) {
      this.onFailure(new Error(`Terminal authority published ${method} without a PTY identity`))
      return
    }
    if (ptyId === null) {
      this.publishNow(method, params, null)
      return
    }
    const fence = this.fences.get(ptyId)
    if (
      fence &&
      (fence.events.length > 0 || (method !== 'pty.data' && fence.pendingDataSettlements > 0))
    ) {
      this.bufferEvent(fence, method, params)
      return
    }
    this.publishNow(method, params, ptyId)
  }

  private parsePtyId(params: Record<string, unknown>): string | null {
    return typeof params.id === 'string' && params.id.length > 0 ? params.id : null
  }

  private publishNow(
    method: TerminalAuthorityEventMethod,
    params: Record<string, unknown>,
    ptyId: string | null
  ): void {
    const clientId = this.activeClientId()
    if (clientId === null) {
      this.onFailure(new Error(`Terminal authority event has no admitted client: ${method}`))
      return
    }
    if (method !== 'pty.data' || ptyId === null) {
      if (!this.dispatcher.tryNotifyClient(clientId, method, params)) {
        this.onFailure(new Error(`Terminal authority event could not be forwarded: ${method}`))
      }
      return
    }
    const fence = this.fenceFor(ptyId)
    fence.pendingDataSettlements++
    let settled = false
    const settle = (result: SinkWriteSettlement): void => {
      if (settled) {
        return
      }
      settled = true
      this.settleData(fence, result)
    }
    if (!this.dispatcher.publishTerminalAuthorityData(clientId, params, settle)) {
      settle({ ok: false, error: new Error('Terminal authority data was not admitted') })
    }
  }

  private fenceFor(ptyId: string): PtyDeliveryFence {
    const existing = this.fences.get(ptyId)
    if (existing) {
      return existing
    }
    const fence: PtyDeliveryFence = {
      ptyId,
      pendingDataSettlements: 0,
      events: [],
      draining: false
    }
    this.fences.set(ptyId, fence)
    return fence
  }

  private bufferEvent(
    target: PtyDeliveryFence | BufferedAuthorityEvent[],
    method: TerminalAuthorityEventMethod,
    params: Record<string, unknown>
  ): void {
    const events = Array.isArray(target) ? target : target.events
    if (!this.buffer.push(events, method, params)) {
      this.onFailure(
        new Error('Terminal authority delivery-order buffer exceeded its bounded capacity')
      )
    }
  }

  private settleData(fence: PtyDeliveryFence, result: SinkWriteSettlement): void {
    if (this.fences.get(fence.ptyId) !== fence) {
      return
    }
    fence.pendingDataSettlements--
    if (!result.ok) {
      this.onFailure(new Error('Terminal authority data did not reach the gateway client'))
      return
    }
    this.drain(fence)
  }

  private drain(fence: PtyDeliveryFence): void {
    if (fence.draining || fence.pendingDataSettlements > 0) {
      return
    }
    fence.draining = true
    try {
      while (fence.pendingDataSettlements === 0 && fence.events.length > 0) {
        const event = fence.events.shift()!
        this.buffer.release([event])
        this.publishNow(event.method, event.params, fence.ptyId)
        if (this.fences.get(fence.ptyId) !== fence) {
          return
        }
      }
    } finally {
      fence.draining = false
    }
    if (fence.pendingDataSettlements === 0 && fence.events.length === 0) {
      this.fences.delete(fence.ptyId)
    }
  }
}
