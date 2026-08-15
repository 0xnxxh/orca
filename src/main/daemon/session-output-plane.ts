import { HeadlessEmulator } from './headless-emulator'
import { normalizePtySize } from './daemon-pty-size'
import { PendingOutputBuffer, type PendingOutputDrain } from './session-pending-output-buffer'
import type { Terminal } from '@xterm/headless'
import type { PtyIngressEmission } from '../../shared/pty-startup-ingress'
import type { PendingOutputRecord, TerminalSnapshot } from './types'

export type AttachedClient = {
  token: symbol
  onData: (data: string, rawLength?: number, transformed?: boolean, seq?: number) => void
  onExit: (code: number, incarnationId: string) => void
}

export type SessionOutputPlaneOptions = {
  cols: number
  rows: number
  scrollback?: number
  wslDistro?: string
  historySeedChunks?: readonly string[]
  /** Startup DA1 queries the daemon answered must not reach the renderer; the shell-ready barrier owns the filter. */
  filterRendererBoundOutput: (data: string) => string
  onAllClientsDetached: () => void
}

/** Everything the renderer sees: the headless emulator, the absolute output sequence, the pending
 *  record buffer and the attached-client fan-out. Orthogonal to process lifecycle. */
export class SessionOutputPlane {
  private readonly emulator: HeadlessEmulator
  private attachedClients: AttachedClient[] = []
  private readonly pendingOutput = new PendingOutputBuffer()
  private outputSequence = 0
  readonly historySeeded: boolean | undefined

  constructor(private readonly opts: SessionOutputPlaneOptions) {
    const size = normalizePtySize(opts.cols, opts.rows)
    this.emulator = new HeadlessEmulator({
      cols: size.cols,
      rows: size.rows,
      scrollback: opts.scrollback,
      wslDistro: opts.wslDistro
      // No onData: the daemon emulator must never reply to query sequences — the renderer's xterm is
      // the authoritative responder and a daemon reply would race ahead and clobber it. See HeadlessEmulator.
      // The one exception is DA1 while the shell-ready barrier holds (below): the renderer's reply
      // would be queued behind the marker it is needed to produce, so it cannot be authoritative there.
    })
    // Why: seed recovery must precede listener registration; shells can emit their prompt synchronously once onData subscribes.
    // Why the every() short-circuit is safe: writeSync only fails emulator-wide (disposed / no sync write API), so later
    // chunks could not land either — and writing them past a dropped chunk would seed a torn stream.
    this.historySeeded =
      opts.historySeedChunks === undefined
        ? undefined
        : opts.historySeedChunks.every((chunk) => this.emulator.writeSync(chunk))
  }

  /** The barrier's daemon-side DA1 responder registers here. */
  get responderParser(): Terminal['parser'] {
    return this.emulator.responderParser
  }

  /** A viewing client is attached; a dropped transport must clear this or pause/resume semantics leak. */
  get hasAttachedClients(): boolean {
    return this.attachedClients.length > 0
  }

  get clients(): readonly AttachedClient[] {
    return this.attachedClients
  }

  attachClient(client: Omit<AttachedClient, 'token'>): symbol {
    const token = Symbol('attach')
    this.attachedClients.push({ token, ...client })
    return token
  }

  detachClient(token: symbol): void {
    const idx = this.attachedClients.findIndex((c) => c.token === token)
    if (idx !== -1) {
      this.attachedClients.splice(idx, 1)
    }
    // Why: with no attached client nobody will send resumePty, so a paused shell would wedge until the failsafe; resume eagerly.
    if (this.attachedClients.length === 0) {
      this.opts.onAllClientsDetached()
    }
  }

  detachAllClients(): void {
    this.attachedClients.length = 0
    this.opts.onAllClientsDetached()
  }

  /** Drops the client list on teardown. Unlike detachAllClients it does not touch producer pause —
   *  Session.dispose() owns that ordering. */
  clearClients(): void {
    this.attachedClients = []
  }

  emit(emission: PtyIngressEmission): void {
    let { data } = emission
    const rawLength = emission.rawEndSeq - emission.rawStartSeq
    // Why: absolute raw count (daemon stream thinning can drop bytes) lets a snapshot cover the gaps while the renderer dedups the tail.
    this.outputSequence += rawLength
    if (data.length > 0) {
      this.emulator.write(data)
      data = this.opts.filterRendererBoundOutput(data)
    }
    if (data.length > 0) {
      this.pendingOutput.record({ kind: 'output', data })
    }

    // Broadcast to attached clients
    for (const client of this.attachedClients) {
      if (emission.transformed || rawLength !== data.length) {
        client.onData(data, rawLength, true, this.outputSequence)
      } else {
        client.onData(data)
      }
    }
  }

  /** Fans out query bytes the barrier withheld from the renderer while it owned DA1. */
  releaseFilteredQueryBytes(pending: string): void {
    this.pendingOutput.record({ kind: 'output', data: pending })
    for (const client of this.attachedClients) {
      client.onData(pending, 0, true, this.outputSequence)
    }
  }

  resize(cols: number, rows: number): void {
    this.emulator.resize(cols, rows)
    // Why: the record stream must mirror the emulator's apply order, or cold-restore replay reflows at the wrong point.
    this.pendingOutput.record({ kind: 'resize', cols, rows })
  }

  clearScrollback(): void {
    this.emulator.clearScrollback()
    this.pendingOutput.record({ kind: 'clear' })
  }

  record(record: PendingOutputRecord): void {
    this.pendingOutput.record(record)
  }

  drainPendingOutput(includeSnapshot: boolean): PendingOutputDrain {
    return this.pendingOutput.drain(includeSnapshot)
  }

  getSnapshot(opts: { scrollbackRows?: number } = {}): TerminalSnapshot {
    return { ...this.emulator.getSnapshot(opts), outputSequence: this.outputSequence }
  }

  getPartialEscapeTailAnsi(): string {
    return this.emulator.partialEscapeTailAnsi
  }

  getAppliedSize(): { cols: number; rows: number } {
    return this.emulator.getAppliedSize()
  }

  getCwd(): string | null {
    return this.emulator.getCwd()
  }

  isCursorOnEmptyPromptLine(): boolean {
    return this.emulator.isCursorOnEmptyPromptLine()
  }

  dispose(): void {
    this.emulator.dispose()
  }
}
