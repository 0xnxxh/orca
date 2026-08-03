import type { PtyOwnerBackend } from './pty-owner-backend'

// Why this module exists: a startup color reply is written to the PTY master, so
// whatever line discipline sits between Orca and the querying program can echo it
// straight back out as ordinary output. ConPTY always does this; a POSIX tty does
// it until the querying program finishes tcsetattr(~ECHO) (#12112). Answering
// inside the query's own turn always loses that race on POSIX, so there the write
// is deferred one turn and its echo shapes are recognized so they are never shown.
//
// Deliberately NO re-send on a matched echo: POSIX ECHO copies bytes to the master
// but does not consume them from the slave's input queue, so an echo is not
// evidence of non-delivery. Re-writing would inject a duplicate reply into the
// program's stdin once it enters raw mode.

export type PtyStartupReplyEchoMatch =
  | { kind: 'complete'; offset: number; length: number }
  | { kind: 'partial'; offset: number }
  | { kind: 'none' }

// Why bounded: the echo trails the write by a read or two, so a projection that never
// lands must stop shadowing the stream instead of living for the rest of the session.
const ECHO_SEARCH_BUDGET_CHARS = 8192

type ExpectedEcho = { projections: readonly string[]; remainingChars: number }

/** Only a POSIX tty both echoes the reply and still delivers a deferred write. */
function defersWrite(ownerBackend: PtyOwnerBackend): boolean {
  return ownerBackend === 'posix-pty'
}

function replyEchoProjections(reply: string, ownerBackend: PtyOwnerBackend): readonly string[] {
  if (ownerBackend === 'windows-conpty') {
    // Why: ConPTY's projection is the documented, deterministic ESC-stripped form.
    return [reply.replaceAll('\x1b', '')]
  }
  if (!defersWrite(ownerBackend)) {
    // wsl.exe is ConPTY-hosted but its echo shape is unverified; suppress nothing.
    return []
  }
  return [
    // ECHOCTL (default cooked tty) renders each control byte as its caret form.
    reply.replaceAll('\x1b', '^['),
    // readline: `ESC ]` is an unbound binding, so it is eaten (with a bell) and
    // the remainder self-inserts; the ST is eaten the same way.
    reply.replaceAll('\x1b]', '\x07').replaceAll('\x1b\\', '')
  ]
}

/** Earliest offset whose suffix of `data` is a strict prefix of `projection`, else -1. */
function suffixPrefixOffset(projection: string, data: string): number {
  for (
    let offset = Math.max(0, data.length - projection.length + 1);
    offset < data.length;
    offset += 1
  ) {
    if (projection.startsWith(data.slice(offset))) {
      return offset
    }
  }
  return -1
}

// Why search the whole span: the tty coalesces its echo with whatever the shell and the
// program wrote around it, so anchoring at offset 0 recognizes almost no real echo.
function locateEcho(projections: readonly string[], data: string): PtyStartupReplyEchoMatch {
  let complete: { offset: number; length: number } | null = null
  let partialOffset = -1
  for (const projection of projections) {
    const at = data.indexOf(projection)
    if (at !== -1) {
      if (!complete || at < complete.offset) {
        complete = { offset: at, length: projection.length }
      }
      continue
    }
    const suffix = suffixPrefixOffset(projection, data)
    if (suffix !== -1 && (partialOffset === -1 || suffix < partialOffset)) {
      partialOffset = suffix
    }
  }
  if (complete) {
    return { kind: 'complete', ...complete }
  }
  return partialOffset === -1 ? { kind: 'none' } : { kind: 'partial', offset: partialOffset }
}

function isBetterEchoMatch(
  candidate: PtyStartupReplyEchoMatch,
  best: PtyStartupReplyEchoMatch
): boolean {
  if (candidate.kind === 'none') {
    return false
  }
  if (best.kind === 'none') {
    return true
  }
  if (candidate.kind !== best.kind) {
    return candidate.kind === 'complete'
  }
  return candidate.offset < best.offset
}

/** Owns when a startup color reply is written and how its own echo is recognized. */
export class PtyStartupReplyDelivery {
  private readonly expectedEchoes: ExpectedEcho[] = []
  private readonly pendingWrites: string[] = []
  private writeTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(
    private readonly ownerBackend: PtyOwnerBackend,
    private readonly writeProvider: (data: string) => void
  ) {}

  get hasExpectedEcho(): boolean {
    return this.expectedEchoes.length > 0
  }

  /** True once the reply has been written or accepted for a later write. */
  answer(reply: string): boolean {
    if (this.closed) {
      return false
    }
    if (!defersWrite(this.ownerBackend)) {
      // Why: ConPTY answers the query itself unless Orca beats it in this turn.
      return this.writeReply(reply)
    }
    this.pendingWrites.push(reply)
    this.armWriteTimer()
    return true
  }

  /** Recognizes any written reply's echo anywhere in the span, earliest match first. */
  matchEcho(data: string): PtyStartupReplyEchoMatch {
    let best: PtyStartupReplyEchoMatch = { kind: 'none' }
    let bestIndex = -1
    for (const [index, expected] of this.expectedEchoes.entries()) {
      const match = locateEcho(expected.projections, data)
      if (isBetterEchoMatch(match, best)) {
        best = match
        bestIndex = index
      }
    }
    if (best.kind === 'complete') {
      this.expectedEchoes.splice(bestIndex, 1)
      return best
    }
    // Why charge on a miss instead of dropping: the echo can trail program output, so one
    // unmatched span is not evidence the reply was never echoed.
    this.chargeEchoSearch(data.length)
    return best
  }

  /** Startup window closed. Keeps replies already written on the wire answerable and unechoed. */
  reset(): void {
    this.flushPendingWrites()
  }

  /** Teardown: the pty is gone, so an unwritten reply has nowhere left to go. */
  close(): void {
    this.closed = true
    this.clearWriteTimer()
    this.pendingWrites.length = 0
    this.expectedEchoes.length = 0
  }

  private chargeEchoSearch(chars: number): void {
    for (let index = this.expectedEchoes.length - 1; index >= 0; index -= 1) {
      const expected = this.expectedEchoes[index]
      if (!expected) {
        continue
      }
      expected.remainingChars -= chars
      if (expected.remainingChars <= 0) {
        this.expectedEchoes.splice(index, 1)
      }
    }
  }

  private armWriteTimer(): void {
    if (this.writeTimer) {
      return
    }
    this.writeTimer = setTimeout(() => this.flushPendingWrites(), 0)
    this.writeTimer.unref?.()
  }

  private flushPendingWrites(): void {
    this.clearWriteTimer()
    for (const reply of this.pendingWrites.splice(0)) {
      this.writeReply(reply)
    }
  }

  private clearWriteTimer(): void {
    if (!this.writeTimer) {
      return
    }
    clearTimeout(this.writeTimer)
    this.writeTimer = null
  }

  private writeReply(reply: string): boolean {
    if (this.closed) {
      return false
    }
    const projections = replyEchoProjections(reply, this.ownerBackend)
    // Why: register before write because node-pty can synchronously re-enter onData.
    if (projections.length > 0) {
      this.expectedEchoes.push({ projections, remainingChars: ECHO_SEARCH_BUDGET_CHARS })
    }
    try {
      this.writeProvider(reply)
      return true
    } catch {
      if (projections.length > 0) {
        this.expectedEchoes.pop()
      }
      return false
    }
  }
}
