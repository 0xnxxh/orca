import { yieldToEventLoop } from '../../../../shared/event-loop-yield'
import {
  isTerminalInputTooLargeWithDeferredMeasurement,
  iterateTerminalInputChunks
} from '../../../../shared/terminal-input'
import { needsCookedEchoSafeQueryReply } from '../../../../shared/terminal-query-reply'

// Why: 4096 UTF-16 code units encode to at most ~12KB UTF-8, safely under the
// 16KB TERMINAL_INPUT_CHUNK_MAX_BYTES cap without paying byte measurement on
// the hot input path.
export const TERMINAL_INPUT_COALESCE_MAX_CODE_UNITS = 4096
// Match host delivery's reply ceiling while keeping all retained reply text under one PTY chunk.
export const PTY_INPUT_WRITE_QUEUE_MAX_PENDING_REPLIES = 64
export const PTY_INPUT_WRITE_QUEUE_MAX_PENDING_REPLY_CODE_UNITS =
  TERMINAL_INPUT_COALESCE_MAX_CODE_UNITS

type PendingPtyInputWrite = {
  id: string
  text: string
  replyOnly: boolean
  tooLarge: boolean | Promise<boolean>
  chunks?: Iterator<string>
  nextChunk?: string
}

export type PtyInputWriteQueue = {
  enqueue: (id: string, data: string) => boolean
  waitForDrain: () => Promise<void>
  clear: () => void
}

export type PtyInputWriteQueueDeps = {
  isWritable: (id: string) => boolean
  write: (id: string, data: string) => void
  yieldBetweenWrites?: () => Promise<void>
}

function isCoalescibleText(text: string): boolean {
  // Echo-risk replies stay atomic so host classifiers cannot miss them (#13137).
  return (
    text.length <= TERMINAL_INPUT_COALESCE_MAX_CODE_UNITS && !needsCookedEchoSafeQueryReply(text)
  )
}

export function createPtyInputWriteQueue(deps: PtyInputWriteQueueDeps): PtyInputWriteQueue {
  const yieldBetweenWrites = deps.yieldBetweenWrites ?? yieldToEventLoop
  let pending: PendingPtyInputWrite[] = []
  let pendingReplies = 0
  let pendingReplyCodeUnits = 0
  let drainPromise: Promise<void> | null = null

  function removePendingAt(index: number): PendingPtyInputWrite | undefined {
    const [removed] = pending.splice(index, 1)
    if (removed?.replyOnly) {
      pendingReplies -= 1
      pendingReplyCodeUnits -= removed.text.length
    }
    return removed
  }

  function shiftPending(): PendingPtyInputWrite | undefined {
    return removePendingAt(0)
  }

  function admitReply(text: string): boolean {
    if (text.length > PTY_INPUT_WRITE_QUEUE_MAX_PENDING_REPLY_CODE_UNITS) {
      return false
    }
    while (
      pendingReplies >= PTY_INPUT_WRITE_QUEUE_MAX_PENDING_REPLIES ||
      pendingReplyCodeUnits + text.length > PTY_INPUT_WRITE_QUEUE_MAX_PENDING_REPLY_CODE_UNITS
    ) {
      // Keep ordinary input intact while retaining the newest bounded reply window.
      const oldestReply = pending.findIndex((item) => item.replyOnly)
      if (oldestReply === -1) {
        return false
      }
      removePendingAt(oldestReply)
    }
    return true
  }

  async function drain(): Promise<void> {
    while (pending.length > 0) {
      const next = pending[0]
      if (!next) {
        shiftPending()
        continue
      }
      if (!deps.isWritable(next.id)) {
        shiftPending()
        continue
      }
      if (next.tooLarge !== false) {
        next.tooLarge = await Promise.resolve(next.tooLarge).catch(() => true)
        if (next.tooLarge) {
          shiftPending()
          continue
        }
        if (!deps.isWritable(next.id)) {
          shiftPending()
          continue
        }
      }
      // Why: dense input streams (SGR wheel reports during trackpad momentum,
      // key auto-repeat) enqueue one tiny item per event. Writing one item per
      // macrotask turn lets Chromium's nested-timer clamp pace the drain at
      // ≥4ms per item, so a fast gesture's reports reach the PTY seconds after
      // the gesture ended and the TUI visibly replays them one by one.
      // Coalescing consecutive validated small items into a single write keeps
      // the PTY byte stream identical while draining the backlog in one turn.
      if (next.chunks === undefined && isCoalescibleText(next.text)) {
        let payload = next.text
        shiftPending()
        while (pending.length > 0) {
          const peek = pending[0]
          if (
            !peek ||
            peek.id !== next.id ||
            peek.tooLarge !== false ||
            peek.chunks !== undefined ||
            !isCoalescibleText(peek.text) ||
            payload.length + peek.text.length > TERMINAL_INPUT_COALESCE_MAX_CODE_UNITS
          ) {
            break
          }
          payload += peek.text
          shiftPending()
        }
        deps.write(next.id, payload)
        if (pending.length > 0) {
          await yieldBetweenWrites()
        }
        continue
      }
      next.chunks ??= iterateTerminalInputChunks(next.text)
      const chunk =
        next.nextChunk === undefined ? next.chunks.next() : { done: false, value: next.nextChunk }
      next.nextChunk = undefined
      if (chunk.done) {
        shiftPending()
        continue
      }
      deps.write(next.id, chunk.value)
      const following = next.chunks.next()
      if (following.done) {
        shiftPending()
      } else {
        next.nextChunk = following.value
      }
      if (pending.length > 0) {
        await yieldBetweenWrites()
      }
    }
  }

  function scheduleDrain(): void {
    if (drainPromise) {
      return
    }
    drainPromise = drain().finally(() => {
      drainPromise = null
      if (pending.length > 0) {
        scheduleDrain()
      }
    })
  }

  return {
    enqueue(id: string, data: string): boolean {
      try {
        const replyOnly = needsCookedEchoSafeQueryReply(data)
        if (replyOnly && !admitReply(data)) {
          return false
        }
        const tooLarge = isTerminalInputTooLargeWithDeferredMeasurement(data)
        if (tooLarge === true) {
          return false
        }
        pending.push({ id, text: data, replyOnly, tooLarge })
        if (replyOnly) {
          pendingReplies += 1
          pendingReplyCodeUnits += data.length
        }
        scheduleDrain()
        return true
      } catch {
        return false
      }
    },

    async waitForDrain(): Promise<void> {
      while (drainPromise) {
        await drainPromise
      }
    },

    clear(): void {
      pending = []
      pendingReplies = 0
      pendingReplyCodeUnits = 0
    }
  }
}
