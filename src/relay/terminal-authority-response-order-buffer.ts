import type { TerminalAuthorityEventMethod } from '../shared/terminal-authority-routing'
import type { ResponseSettlement } from './dispatcher'
import type {
  BufferedAuthorityEvent,
  TerminalAuthorityEventBuffer
} from './terminal-authority-event-delivery'

export type TerminalAuthorityResponseOrderFence = {
  ptyId: string
  pendingSettlements: number
  failure: Error | null
  events: BufferedAuthorityEvent[]
}

export class TerminalAuthorityResponseOrderBuffer {
  private admissionEvents: BufferedAuthorityEvent[] = []
  private readonly responseFences = new Map<string, TerminalAuthorityResponseOrderFence>()

  constructor(
    private readonly eventBuffer: TerminalAuthorityEventBuffer,
    private readonly publishEvent: (
      method: TerminalAuthorityEventMethod,
      params: Record<string, unknown>
    ) => void,
    private readonly fail: (error: Error) => void
  ) {}

  accept(
    admissionPending: boolean,
    method: TerminalAuthorityEventMethod,
    params: Record<string, unknown>
  ): boolean {
    const target = admissionPending
      ? this.admissionEvents
      : this.responseFenceForEvent(method, params)?.events
    if (!target) {
      return false
    }
    if (!this.eventBuffer.push(target, method, params)) {
      this.fail(new Error('Terminal authority response-order buffer exceeded its bounded capacity'))
    }
    return true
  }

  register(value: unknown): TerminalAuthorityResponseOrderFence | null {
    if (typeof value !== 'string' || value.length === 0) {
      return null
    }
    const existing = this.responseFences.get(value)
    if (existing) {
      existing.pendingSettlements++
      return existing
    }
    const fence: TerminalAuthorityResponseOrderFence = {
      ptyId: value,
      pendingSettlements: 1,
      failure: null,
      events: []
    }
    this.responseFences.set(value, fence)
    return fence
  }

  takeAdmissionEvents(): readonly BufferedAuthorityEvent[] {
    const events = this.admissionEvents
    this.admissionEvents = []
    this.eventBuffer.release(events)
    return events
  }

  settleFence(fence: TerminalAuthorityResponseOrderFence, settlement: ResponseSettlement): void {
    if (this.responseFences.get(fence.ptyId) !== fence) {
      return
    }
    if (!settlement.ok && settlement.responseDelivered !== true && fence.failure === null) {
      fence.failure = settlement.error
    }
    fence.pendingSettlements--
    if (fence.pendingSettlements > 0) {
      return
    }
    this.responseFences.delete(fence.ptyId)
    this.eventBuffer.release(fence.events)
    if (fence.failure) {
      this.fail(
        new Error(
          `Terminal authority response did not reach the gateway client: ${fence.failure.message}`
        )
      )
      return
    }
    for (const event of fence.events) {
      this.publishEvent(event.method, event.params)
    }
  }

  clear(): void {
    this.eventBuffer.release(this.admissionEvents)
    this.admissionEvents = []
    for (const fence of this.responseFences.values()) {
      this.eventBuffer.release(fence.events)
    }
    this.responseFences.clear()
  }

  private responseFenceForEvent(
    method: TerminalAuthorityEventMethod,
    params: Record<string, unknown>
  ): TerminalAuthorityResponseOrderFence | null {
    if (!method.startsWith('pty.') || typeof params.id !== 'string') {
      return null
    }
    return this.responseFences.get(params.id) ?? null
  }
}
