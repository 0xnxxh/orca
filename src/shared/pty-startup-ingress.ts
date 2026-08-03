import {
  parseTerminalOscColorQuery,
  terminalOscColorQueryReplies,
  type TerminalOscColorQuerySlot
} from './terminal-osc-color-reply'
import type { PtyStartupIngressIntent } from './pty-startup-ingress-intent'
import type { PtyOwnerBackend } from './pty-owner-backend'
import { PtyStartupReplyDelivery } from './pty-startup-reply-delivery'
import {
  combinePtyIngressSourceSpans,
  slicePtyIngressSourceSpan,
  type PtyIngressEmission,
  type PtyIngressSourceSpan,
  type PtyStartupIngressOperation,
  type PtyStartupIngressOptions
} from './pty-startup-ingress-contract'

export {
  PTY_STARTUP_INGRESS_VERSION,
  parsePtyStartupIngressIntent
} from './pty-startup-ingress-intent'
export type { PtyStartupIngressIntent } from './pty-startup-ingress-intent'
export type { PtyIngressEmission, PtyStartupIngressOptions } from './pty-startup-ingress-contract'

const MAX_QUERY_CANDIDATE_CHARS = 64
// Why short: a held partial echo is real output if the rest never arrives, and the
// startup deadline is far too long to stall a pane on that guess.
const ECHO_CONTINUATION_HOLD_MS = 50

/**
 * Serialized source-side startup classifier. Its raw sequence begins after
 * shell-ready preprocessing and every accepted range is emitted exactly once.
 */
export class PtyStartupIngress {
  private readonly intent: PtyStartupIngressIntent | undefined
  private readonly ownerBackend: PtyOwnerBackend
  private readonly delivery: PtyStartupReplyDelivery
  private readonly onEmission: (emission: PtyIngressEmission) => void
  private readonly operations: PtyStartupIngressOperation[] = []
  private readonly answeredSlots = new Set<TerminalOscColorQuerySlot>()
  private processing = false
  private closed = false
  private queryOpen: boolean
  private rawHighWater = 0
  private queryPending: PtyIngressSourceSpan | null = null
  private echoPending: PtyIngressSourceSpan | null = null
  private echoHoldTimer: ReturnType<typeof setTimeout> | null = null
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: PtyStartupIngressOptions) {
    this.intent = options.intent
    this.ownerBackend = options.ownerBackend ?? 'posix-pty'
    this.delivery = new PtyStartupReplyDelivery(this.ownerBackend, options.write)
    this.onEmission = options.onEmission
    this.queryOpen = options.intent !== undefined
    if (options.intent) {
      this.deadlineTimer = setTimeout(
        () => this.enqueue({ kind: 'expire' }),
        Math.max(0, options.intent.deadlineMs)
      )
      this.deadlineTimer.unref?.()
    }
  }

  get acceptedRawSequence(): number {
    return this.rawHighWater
  }

  accept(data: string): void {
    if (this.closed || data.length === 0) {
      return
    }
    const rawStartSeq = this.rawHighWater
    this.rawHighWater += data.length
    this.enqueue({
      kind: 'data',
      chunk: { data, rawStartSeq, rawEndSeq: this.rawHighWater }
    })
  }

  closeQueryAuthority(): number {
    this.enqueue({ kind: 'close-query' })
    return this.rawHighWater
  }

  snapshotBarrier(): number {
    this.enqueue({ kind: 'snapshot' })
    return this.rawHighWater
  }

  drainAndClose(): number {
    this.enqueue({ kind: 'teardown' })
    return this.rawHighWater
  }

  private enqueue(operation: PtyStartupIngressOperation): void {
    if (this.closed) {
      return
    }
    this.operations.push(operation)
    if (this.processing) {
      return
    }
    this.processing = true
    try {
      let next: PtyStartupIngressOperation | undefined
      while ((next = this.operations.shift())) {
        this.applyOperation(next)
      }
    } finally {
      this.processing = false
    }
  }

  private applyOperation(operation: PtyStartupIngressOperation): void {
    switch (operation.kind) {
      case 'data':
        this.processEchoSpan(operation.chunk)
        return
      case 'close-query':
        if (this.ownerBackend !== 'windows-conpty') {
          this.queryOpen = false
          this.releaseQueryPending()
        }
        // Why: ConPTY cannot safely transfer color-query authority to a downstream view.
        return
      case 'expire':
        this.queryOpen = false
        this.releasePendingInSourceOrder(false)
        this.delivery.reset()
        this.clearDeadline()
        return
      case 'snapshot':
      case 'release-echo':
        this.releasePendingInSourceOrder(false)
        return
      case 'teardown':
        this.queryOpen = false
        this.releasePendingInSourceOrder(true)
        this.delivery.close()
        this.clearDeadline()
        this.closed = true
    }
  }

  private processEchoSpan(span: PtyIngressSourceSpan): void {
    let input = combinePtyIngressSourceSpans(this.takeEchoPending(), span)

    while (this.delivery.hasExpectedEcho && input.data.length > 0) {
      const match = this.delivery.matchEcho(input.data)
      if (match.kind !== 'complete') {
        // Why so narrow: holding a tail that merely looks like an echo head steals a
        // BEL that terminates a torn query. Only a whole span with no query outstanding
        // is worth the guess; the projection survives the miss either way.
        if (match.kind === 'partial' && match.offset === 0 && !this.queryPending) {
          this.echoPending = input
          this.armEchoHold()
          return
        }
        break
      }
      if (match.offset > 0) {
        this.processQuerySpan(slicePtyIngressSourceSpan(input, 0, match.offset))
      }
      // Why release first: a retained torn candidate cannot straddle the suppressed
      // range without desynchronizing its raw sequence arithmetic.
      this.releaseQueryPending()
      const echoEnd = match.offset + match.length
      this.emit(slicePtyIngressSourceSpan(input, match.offset, echoEnd), true, '')
      input = slicePtyIngressSourceSpan(input, echoEnd)
    }

    if (input.data.length > 0) {
      this.processQuerySpan(input)
    }
  }

  private processQuerySpan(span: PtyIngressSourceSpan): void {
    const input = combinePtyIngressSourceSpans(this.queryPending, span)
    this.queryPending = null
    const suppressConptyQuery = this.ownerBackend === 'windows-conpty'
    if ((!this.queryOpen || !this.intent) && !suppressConptyQuery) {
      this.emit(input, false)
      return
    }

    let scanOffset = 0
    let emittedOffset = 0
    while (scanOffset < input.data.length) {
      const candidateIndex = input.data.indexOf('\x1b', scanOffset)
      if (candidateIndex === -1) {
        this.emit(slicePtyIngressSourceSpan(input, emittedOffset), false)
        return
      }
      const query = parseTerminalOscColorQuery(input.data, candidateIndex)
      if (query.kind === 'none') {
        scanOffset = candidateIndex + 1
        continue
      }
      if (query.kind === 'partial') {
        if (candidateIndex > emittedOffset) {
          this.emit(slicePtyIngressSourceSpan(input, emittedOffset, candidateIndex), false)
        }
        const candidate = slicePtyIngressSourceSpan(input, candidateIndex)
        if (candidate.data.length <= MAX_QUERY_CANDIDATE_CHARS) {
          this.queryPending = candidate
        } else {
          this.emit(candidate, false)
        }
        return
      }

      if (candidateIndex > emittedOffset) {
        this.emit(slicePtyIngressSourceSpan(input, emittedOffset, candidateIndex), false)
      }
      const querySpan = slicePtyIngressSourceSpan(input, candidateIndex, query.endIndex)
      const answered = this.queryOpen && this.intent && this.answerQuery(query.slots)
      if (answered || suppressConptyQuery) {
        this.emit(querySpan, true, '')
      } else {
        this.emit(querySpan, false)
      }
      scanOffset = query.endIndex
      emittedOffset = query.endIndex
    }
  }

  private answerQuery(slots: readonly TerminalOscColorQuerySlot[]): boolean {
    if (slots.some((slot) => this.answeredSlots.has(slot)) || !this.intent) {
      return false
    }
    const replies = terminalOscColorQueryReplies(this.intent.colors, slots)
    if (!replies) {
      return false
    }

    let wroteAny = false
    for (const [index, reply] of replies.entries()) {
      const slot = slots[index]
      if (slot === undefined) {
        return wroteAny
      }
      this.answeredSlots.add(slot)
      if (!this.delivery.answer(reply)) {
        this.answeredSlots.delete(slot)
        return wroteAny
      }
      wroteAny = true
    }

    if (this.answeredSlots.has(10) && this.answeredSlots.has(11)) {
      this.queryOpen = false
    }
    return wroteAny
  }

  private releaseQueryPending(): void {
    if (!this.queryPending) {
      return
    }
    const pending = this.queryPending
    this.queryPending = null
    this.emit(pending, false)
  }

  /** Why this order: queryPending always holds strictly earlier source bytes than echoPending. */
  private releasePendingInSourceOrder(includeConptyQuery: boolean): void {
    if (includeConptyQuery || this.ownerBackend !== 'windows-conpty') {
      this.releaseQueryPending()
    }
    const pending = this.takeEchoPending()
    if (pending) {
      this.emit(pending, false)
    }
  }

  private takeEchoPending(): PtyIngressSourceSpan | null {
    const pending = this.echoPending
    this.echoPending = null
    if (this.echoHoldTimer) {
      clearTimeout(this.echoHoldTimer)
      this.echoHoldTimer = null
    }
    return pending
  }

  private armEchoHold(): void {
    if (this.echoHoldTimer) {
      return
    }
    this.echoHoldTimer = setTimeout(
      () => this.enqueue({ kind: 'release-echo' }),
      ECHO_CONTINUATION_HOLD_MS
    )
    this.echoHoldTimer.unref?.()
  }

  private emit(span: PtyIngressSourceSpan, transformed: boolean, data = span.data): void {
    this.onEmission({
      data,
      rawStartSeq: span.rawStartSeq,
      rawEndSeq: span.rawEndSeq,
      transformed
    })
  }

  private clearDeadline(): void {
    if (!this.deadlineTimer) {
      return
    }
    clearTimeout(this.deadlineTimer)
    this.deadlineTimer = null
  }
}
