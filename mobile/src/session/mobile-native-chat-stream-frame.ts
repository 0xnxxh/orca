import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { applyAppend, replaceList, type NativeChatMerger } from './mobile-native-chat-merge'

export type MobileNativeChatStreamFrame = {
  type?: string
  messages?: NativeChatMessage[]
  hasMore?: boolean
  beforeOffset?: number
  error?: string
  message?: string
}

export type AppliedMobileNativeChatFrame =
  | { kind: 'ignored' }
  | { kind: 'error'; error: string }
  | {
      kind: 'messages'
      messages: NativeChatMessage[]
      hasMore?: boolean
      beforeOffset?: number
      cursorInvalidated?: boolean
      /** The frame replaced the whole retained window (replacement, first
       *  snapshot, or a replay snapshot disjoint from local history) — the
       *  caller must reset its paging window/cursor to the frame's. */
      windowReplaced?: boolean
    }

/** Applies runtime stream frames while preserving the initial-snapshot versus
 *  reconnect-replay distinction owned by the session hook. A replay snapshot
 *  that overlaps the retained list merges in by id — paged-in history survives
 *  a socket blip instead of collapsing to the replayed window. A disjoint
 *  replay (long outage, compaction while away) can't be stitched without a
 *  gap, so it falls back to replacing with the fresh authoritative window. */
export function applyMobileNativeChatStreamFrame(args: {
  merger: NativeChatMerger
  frame: MobileNativeChatStreamFrame
  limit: number
  replaceSnapshot: boolean
}): AppliedMobileNativeChatFrame {
  const { merger, frame, limit, replaceSnapshot } = args
  if (frame.type === 'error') {
    return { kind: 'error', error: frame.message ?? frame.error ?? 'Transcript stream failed' }
  }
  if (frame.type !== 'snapshot' && frame.type !== 'replacement' && frame.type !== 'appended') {
    return { kind: 'ignored' }
  }
  if (frame.error) {
    return { kind: 'error', error: frame.error }
  }
  if (!Array.isArray(frame.messages)) {
    return { kind: 'ignored' }
  }
  const replayOverlapsHistory =
    frame.type === 'snapshot' &&
    !replaceSnapshot &&
    merger.list.length > 0 &&
    frame.messages.some((message) => merger.indexById.has(message.id))
  if (frame.type === 'replacement' || (frame.type === 'snapshot' && !replayOverlapsHistory)) {
    replaceList(merger, frame.messages)
    return {
      kind: 'messages',
      messages: merger.list,
      hasMore: frame.hasMore,
      windowReplaced: true,
      ...(frame.beforeOffset == null ? {} : { beforeOffset: frame.beforeOffset })
    }
  }
  const previousFirstId = merger.list[0]?.id
  const messages = applyAppend(merger, frame.messages, limit)
  return {
    kind: 'messages',
    messages,
    // Why: once the bounded live window drops its oldest row, the snapshot's
    // byte cursor no longer describes the oldest retained message.
    ...(previousFirstId && messages[0]?.id !== previousFirstId ? { cursorInvalidated: true } : {})
  }
}
