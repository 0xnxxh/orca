import {
  TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
  terminalAuthorityAppProjectionRowKey,
  type TerminalAuthorityAppBellClearRequest,
  type TerminalAuthorityAppEventKey,
  type TerminalAuthorityAppFactProjection,
  type TerminalAuthorityAppPaneProjection,
  type TerminalAuthorityAppProjectionDelta,
  type TerminalAuthorityAppProjectionSnapshot,
  type TerminalAuthorityAppProjectionSubscribe
} from '../../../shared/terminal-authority-app-projection'
import {
  parseTerminalAuthorityAppProjectionDelta,
  parseTerminalAuthorityAppProjectionSnapshot
} from '../../../shared/terminal-authority-app-projection-validation'
import {
  applyTerminalAuthorityAppProjectionExit,
  applyTerminalAuthorityAppProjectionFact
} from './terminal-authority-app-projection-policy'

const MAX_BUFFERED_DELTAS = 64

export type TerminalAuthorityAppOutcomeIdentity = TerminalAuthorityAppEventKey
export type TerminalAuthorityOutcomeProjectionKind = 'event-keyed-idempotent'

export type TerminalAuthorityAppProjectionTransport = Readonly<{
  onDelta(listener: (value: unknown) => void): () => void
  subscribe(request: TerminalAuthorityAppProjectionSubscribe): Promise<unknown>
  clearBell(request: TerminalAuthorityAppBellClearRequest): Promise<boolean>
}>

export type TerminalAuthorityAppProjectionControllerOptions = Readonly<{
  transport: TerminalAuthorityAppProjectionTransport
  subscriptionIncarnationId: string
  expectedSubscriptionIncarnationId?: string | null
  onError?: (error: Error) => void
}>

export class TerminalAuthorityAppProjectionController {
  private readonly rows = new Map<string, TerminalAuthorityAppPaneProjection>()
  private readonly appliedEvents = new Map<string, string>()
  private readonly pendingRows = new Map<string, TerminalAuthorityAppPaneProjection>()
  private readonly failedRows = new Set<string>()
  private epoch = 0
  private active = false
  private initialized = false
  private unsubscribe: (() => void) | null = null
  private racingDeltas: TerminalAuthorityAppProjectionDelta[] | null = null
  private drainPromise: Promise<void> | null = null

  constructor(private readonly options: TerminalAuthorityAppProjectionControllerOptions) {}

  async start(): Promise<void> {
    if (this.active) {
      throw new Error('terminal_authority_projection_controller_started')
    }
    const epoch = ++this.epoch
    this.active = true
    this.racingDeltas = []
    this.unsubscribe = this.options.transport.onDelta((value) => this.receive(epoch, value))
    try {
      const value = await this.options.transport.subscribe({
        version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
        subscriptionIncarnationId: this.options.subscriptionIncarnationId,
        expectedSubscriptionIncarnationId: this.options.expectedSubscriptionIncarnationId ?? null
      })
      if (!this.isCurrent(epoch)) {
        return
      }
      const snapshot = parseTerminalAuthorityAppProjectionSnapshot(value)
      if (
        !snapshot ||
        snapshot.subscriptionIncarnationId !== this.options.subscriptionIncarnationId
      ) {
        throw new Error('terminal_authority_projection_snapshot_invalid')
      }
      this.installSnapshot(snapshot)
      const racing = this.racingDeltas ?? []
      this.racingDeltas = null
      this.initialized = true
      for (const delta of racing) {
        this.applyDelta(delta)
      }
      this.kick(epoch)
    } catch (error) {
      if (!this.isCurrent(epoch)) {
        return
      }
      const failure = asError(error)
      this.report(failure)
      this.dispose()
      throw failure
    }
  }

  dispose(): void {
    if (!this.active) {
      return
    }
    this.active = false
    this.initialized = false
    this.epoch += 1
    this.unsubscribe?.()
    this.unsubscribe = null
    this.racingDeltas = null
    this.rows.clear()
    this.pendingRows.clear()
    this.failedRows.clear()
    this.appliedEvents.clear()
  }

  retryFailedRows(): void {
    if (!this.active || !this.initialized) {
      return
    }
    for (const key of this.failedRows) {
      const row = this.rows.get(key)
      if (row) {
        this.pendingRows.set(key, row)
      }
    }
    this.failedRows.clear()
    this.kick(this.epoch)
  }

  snapshotRows(): readonly TerminalAuthorityAppPaneProjection[] {
    return Object.freeze([...this.rows.values()])
  }

  private receive(epoch: number, value: unknown): void {
    if (!this.isCurrent(epoch)) {
      return
    }
    const delta = parseTerminalAuthorityAppProjectionDelta(value)
    if (!delta || delta.subscriptionIncarnationId !== this.options.subscriptionIncarnationId) {
      this.report(new Error('terminal_authority_projection_delta_invalid'))
      return
    }
    if (this.racingDeltas) {
      if (this.racingDeltas.length >= MAX_BUFFERED_DELTAS) {
        this.report(new Error('terminal_authority_projection_delta_capacity_exceeded'))
        this.dispose()
        return
      }
      this.racingDeltas.push(delta)
      return
    }
    this.applyDelta(delta)
    this.kick(epoch)
  }

  private installSnapshot(snapshot: TerminalAuthorityAppProjectionSnapshot): void {
    this.rows.clear()
    this.pendingRows.clear()
    for (const row of snapshot.rows) {
      this.installRow(row)
    }
  }

  private applyDelta(delta: TerminalAuthorityAppProjectionDelta): void {
    for (const identity of delta.deleted ?? []) {
      const key = terminalAuthorityAppProjectionRowKey(identity)
      this.rows.delete(key)
      this.pendingRows.delete(key)
      this.failedRows.delete(key)
      for (const appliedKey of this.appliedEvents.keys()) {
        if (appliedKey.startsWith(`${key}:`)) {
          this.appliedEvents.delete(appliedKey)
        }
      }
    }
    for (const row of delta.rows) {
      this.installRow(row)
    }
  }

  private installRow(row: TerminalAuthorityAppPaneProjection): void {
    const key = terminalAuthorityAppProjectionRowKey(row)
    this.rows.set(key, row)
    this.pendingRows.set(key, row)
    this.failedRows.delete(key)
  }

  private kick(epoch: number): void {
    if (this.drainPromise || !this.isCurrent(epoch)) {
      return
    }
    const drain = this.drain(epoch)
    this.drainPromise = drain
    void drain.finally(() => {
      if (this.drainPromise !== drain) {
        return
      }
      this.drainPromise = null
      if (this.pendingRows.size > 0 && this.isCurrent(epoch)) {
        this.kick(epoch)
      }
    })
  }

  private async drain(epoch: number): Promise<void> {
    while (this.pendingRows.size > 0 && this.isCurrent(epoch)) {
      const entry = this.pendingRows.entries().next().value as
        | [string, TerminalAuthorityAppPaneProjection]
        | undefined
      if (!entry) {
        return
      }
      const [key, row] = entry
      this.pendingRows.delete(key)
      try {
        await this.applyRow(epoch, key, row)
      } catch (error) {
        if (!this.isCurrent(epoch)) {
          return
        }
        this.failedRows.add(key)
        this.report(asError(error))
      }
    }
  }

  private async applyRow(
    epoch: number,
    rowKey: string,
    row: TerminalAuthorityAppPaneProjection
  ): Promise<void> {
    const facts = Object.values(row.facts)
      .filter((field): field is TerminalAuthorityAppFactProjection => Boolean(field))
      .sort((left, right) => left.event.sequence - right.event.sequence)
    for (const field of facts) {
      const appliedKey = `${rowKey}:fact:${field.fact.kind}`
      if (this.appliedEvents.get(appliedKey) === eventKey(field.event)) {
        continue
      }
      if (!(await applyTerminalAuthorityAppProjectionFact(row, field))) {
        throw new Error('terminal_authority_projection_policy_unavailable')
      }
      this.assertCurrent(epoch)
      if (field.fact.kind === 'bell' && row.attention.pendingBellCount > 0) {
        await this.clearBell(row, field.event)
        this.assertCurrent(epoch)
      }
      this.appliedEvents.set(appliedKey, eventKey(field.event))
    }
    if (row.exit) {
      const appliedKey = `${rowKey}:exit`
      if (this.appliedEvents.get(appliedKey) !== eventKey(row.exit.event)) {
        if (!(await applyTerminalAuthorityAppProjectionExit(row))) {
          throw new Error('terminal_authority_projection_exit_policy_unavailable')
        }
        this.assertCurrent(epoch)
        this.appliedEvents.set(appliedKey, eventKey(row.exit.event))
      }
    }
  }

  private clearBell(
    row: TerminalAuthorityAppPaneProjection,
    expectedEvent: TerminalAuthorityAppEventKey
  ): Promise<boolean> {
    return this.options.transport.clearBell({
      version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
      consumerId: row.consumerId,
      namespace: row.namespace,
      pane: row.pane,
      expectedEvent
    })
  }

  private assertCurrent(epoch: number): void {
    if (!this.isCurrent(epoch)) {
      throw new Error('terminal_authority_projection_callback_stale')
    }
  }

  private isCurrent(epoch: number): boolean {
    return this.active && epoch === this.epoch
  }

  private report(error: Error): void {
    this.options.onError?.(error)
  }
}

function eventKey(event: TerminalAuthorityAppEventKey): string {
  return JSON.stringify([
    event.consumerId,
    event.namespace.authorityHostId,
    event.namespace.namespaceId,
    event.sequence,
    event.outcomeId
  ])
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
