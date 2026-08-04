import { useCallback, useEffect, useRef, useState } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { buildNativeChatSubscriptionId } from '../../../src/shared/native-chat-stream-unsubscribe'
import type { RpcClient } from '../transport/rpc-client'
import { createNativeChatMerger, replaceList } from './mobile-native-chat-merge'
import {
  applyMobileNativeChatStreamFrame,
  type MobileNativeChatStreamFrame
} from './mobile-native-chat-stream-frame'

export type MobileNativeChatStatus = 'idle' | 'loading' | 'waiting-session' | 'ready' | 'error'

export type MobileNativeChatSession = {
  messages: NativeChatMessage[]
  status: MobileNativeChatStatus
  /** True while `messages` cannot be trusted as this session's real history:
   *  the read is in flight, OR the subscription effect has not yet caught up to
   *  a just-changed agent/session, so `messages`/`status` still describe the
   *  previous tab. Consumers that decide something from an empty transcript
   *  (the launch-draft seed) must wait for this to clear. */
  transcriptLoading: boolean
  error?: string
  /** True when an older page may exist (the last read filled the window). */
  hasMore: boolean
  /** Whether an older-history page is currently loading. */
  loadingEarlier: boolean
  /** Set when the last older-history page failed; retry via `loadEarlier`. */
  loadEarlierError: string | null
  /** Grow the window to page in older history. */
  loadEarlier: () => void
}

// Stable empty reference so a not-yet-current read doesn't churn consumers.
const EMPTY_MESSAGES: NativeChatMessage[] = []

// Small first page for a fast first paint; grows by a page as the user scrolls.
const INITIAL_LIMIT = 40
const PAGE = 60
const MAX_MESSAGES = 2000

const LOAD_EARLIER_ERROR = 'Couldn’t load earlier messages'

type ReadSessionResult =
  | { messages: NativeChatMessage[]; hasMore?: boolean; beforeOffset?: number }
  | { error: string }
/** Subscribe to an agent's native-chat transcript over the paired connection.
 *  Reads a small recent window for a fast first paint, tails it for live turns,
 *  and pages in older history on demand. Read results replace the list (they are
 *  an ordered tail); live appends merge by id so order stays stable. */
export function useMobileNativeChatSession(args: {
  client: RpcClient | null
  agent: string | null
  sessionId: string | null
  transcriptPath: string | null
}): MobileNativeChatSession {
  const { client, agent, sessionId, transcriptPath } = args
  const [messages, setMessages] = useState<NativeChatMessage[]>([])
  const identity = `${agent ?? ''}\0${sessionId ?? ''}\0${transcriptPath ?? ''}`
  // Pre-read status is a pure function of the props, so derive it rather than
  // letting the effect write it a commit later.
  const initialStatus: MobileNativeChatStatus =
    !client || !agent ? 'idle' : !sessionId ? 'waiting-session' : 'loading'
  // Only the settled outcome is genuinely async, and it is tagged with the
  // identity it describes so a just-switched tab is never judged by the
  // previous tab's transcript — the effect that clears `messages` is passive
  // and lands a commit late.
  const [read, setRead] = useState<{
    client: RpcClient
    identity: string
    status: MobileNativeChatStatus
  } | null>(null)
  // Drop it the moment its subscription stops being the live one — identity and
  // client are the effect's only inputs, so together they catch every re-run.
  // Without this a toggle out of chat view and back (agent null, then the same
  // identity again) would resurface a settled 'ready' over an emptied list.
  let current = read
  if (current !== null && (current.identity !== identity || current.client !== client)) {
    current = null
    setRead(null)
  }
  // A settled read only counts while the props still call for one: losing the
  // client/agent/session means idle or waiting-session outranks it outright.
  const settled = initialStatus === 'loading' ? current : null
  const status = settled ? settled.status : initialStatus
  const [error, setError] = useState<string | undefined>(undefined)
  const [hasMore, setHasMore] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [loadEarlierError, setLoadEarlierError] = useState<string | null>(null)
  const loadingEarlierRef = useRef(false)
  const beforeOffsetRef = useRef<number | null>(null)
  // Stateful id-dedup merger: caches the id→index map so each live append frame
  // costs O(incoming), not O(existing+incoming) (#18). `replaceList` resets the
  // base (read / loadEarlier ordered tails); `applyAppend` folds live frames in.
  const mergerRef = useRef(createNativeChatMerger())
  const limitRef = useRef(INITIAL_LIMIT)
  // Tracks the live session so a late loadEarlier resolve can detect a swap.
  const sessionIdRef = useRef<string | null>(sessionId)
  sessionIdRef.current = sessionId
  const streamGenerationRef = useRef(0)
  // Whether this subscription already delivered its base snapshot; later
  // snapshots on the same subscription are reconnect replays, not fresh bases.
  const snapshotSeenRef = useRef(false)
  // Last list a settled read produced, keyed by the identity it belongs to. A
  // reconnect swaps the client without moving the identity; keep rendering this
  // while the swapped client's read is in flight instead of collapsing to a
  // full-screen spinner (UI stays steady while loading).
  const lastListRef = useRef<{ identity: string; messages: NativeChatMessage[] } | null>(null)
  const settledReady = settled?.status === 'ready'
  useEffect(() => {
    // Post-commit capture: while a swap is re-reading, `settled` is null and
    // the previous commit's capture keeps serving this identity.
    if (settledReady) {
      lastListRef.current = { identity, messages }
    }
  }, [settledReady, identity, messages])

  // Replace the base list (read results are an ordered tail). Resets the merger
  // cache so the index is rebuilt once over the new base.
  const setList = useCallback((next: readonly NativeChatMessage[]) => {
    replaceList(mergerRef.current, next)
    setMessages(mergerRef.current.list)
  }, [])

  useEffect(() => {
    let cancelled = false
    // Why: disconnect/agent/session loss must invalidate a page request before
    // the early idle/waiting return can clear the visible source.
    streamGenerationRef.current += 1
    limitRef.current = INITIAL_LIMIT
    loadingEarlierRef.current = false
    snapshotSeenRef.current = false
    setLoadingEarlier(false)
    setLoadEarlierError(null)
    setList([])
    setError(undefined)
    setHasMore(false)
    beforeOffsetRef.current = null
    if (!client || !agent) {
      return
    }
    if (!sessionId) {
      return
    }

    const unsubscribe = client.subscribe(
      'nativeChat.subscribe',
      {
        agent,
        sessionId,
        limit: limitRef.current,
        subscriptionId: buildNativeChatSubscriptionId(agent, sessionId),
        ...(transcriptPath ? { transcriptPath } : {})
      },
      (raw) => {
        if (cancelled) {
          return
        }
        const frame = raw as MobileNativeChatStreamFrame
        const applied = applyMobileNativeChatStreamFrame({
          merger: mergerRef.current,
          frame,
          limit: limitRef.current,
          replaceSnapshot: !snapshotSeenRef.current
        })
        if (applied.kind === 'ignored') {
          return
        }
        if (applied.kind === 'error') {
          setRead({ client, identity, status: 'error' })
          setError(applied.error)
          return
        }
        if (frame.type === 'snapshot') {
          snapshotSeenRef.current = true
        }
        if (applied.windowReplaced || frame.type === 'snapshot') {
          // Why: any authoritative window (and any replay merge) invalidates an
          // in-flight older-page request; stale results must not land on it.
          streamGenerationRef.current += 1
          loadingEarlierRef.current = false
          setLoadingEarlier(false)
          setLoadEarlierError(null)
        }
        if (applied.windowReplaced) {
          // Only a genuinely fresh window resets the grown read window — an
          // overlapping reconnect replay keeps the paged-in history and limit.
          limitRef.current = INITIAL_LIMIT
        }
        setMessages(applied.messages)
        if (applied.hasMore != null) {
          setHasMore(applied.hasMore)
        }
        if (applied.beforeOffset != null) {
          beforeOffsetRef.current = applied.beforeOffset
        }
        if (applied.cursorInvalidated) {
          // Fall back to a growing-tail read so history trimmed by live appends
          // cannot leave a gap between the retained window and the old cursor.
          streamGenerationRef.current += 1
          loadingEarlierRef.current = false
          setLoadingEarlier(false)
          beforeOffsetRef.current = null
        }
        setRead({ client, identity, status: 'ready' })
      }
    )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [client, agent, sessionId, transcriptPath, identity, setList])

  const loadEarlier = useCallback(() => {
    if (!client || !agent || !sessionId || loadingEarlierRef.current || !hasMore) {
      return
    }
    // Capture the session this page belongs to; a swap underneath us must not
    // apply this read's result onto the new session (mirrors desktop's guard).
    const requestSessionId = sessionId
    const requestGeneration = streamGenerationRef.current
    const nextLimit = Math.min(limitRef.current + PAGE, MAX_MESSAGES)
    const pageLimit = nextLimit - limitRef.current
    if (pageLimit <= 0) {
      setHasMore(false)
      return
    }
    const beforeOffset = beforeOffsetRef.current
    loadingEarlierRef.current = true
    setLoadingEarlier(true)
    setLoadEarlierError(null)
    const requestIsCurrent = (): boolean =>
      sessionIdRef.current === requestSessionId && streamGenerationRef.current === requestGeneration
    void (async () => {
      try {
        const response = await client.sendRequest('nativeChat.readSession', {
          agent,
          sessionId,
          limit: beforeOffset === null ? nextLimit : pageLimit,
          ...(beforeOffset === null ? {} : { beforeOffset }),
          ...(transcriptPath ? { transcriptPath } : {})
        })
        const result = response.ok ? (response.result as ReadSessionResult) : null
        if (!result || 'error' in result) {
          // Surface the failed page (silently doing nothing reads as a dead
          // scroll); the header row offers a retry through loadEarlier.
          if (requestIsCurrent()) {
            setLoadEarlierError(LOAD_EARLIER_ERROR)
          }
          return
        }
        // Drop a stale resolve from a session that swapped underneath us.
        if (!requestIsCurrent()) {
          return
        }
        limitRef.current = nextLimit
        if (beforeOffset !== null && result.beforeOffset != null) {
          beforeOffsetRef.current = result.beforeOffset
          setList([...result.messages, ...mergerRef.current.list])
          setHasMore(
            nextLimit < MAX_MESSAGES && (result.hasMore ?? result.messages.length >= pageLimit)
          )
        } else {
          // Older runtimes ignore the cursor and return the growing tail.
          setList(result.messages)
          setHasMore(result.messages.length >= nextLimit)
        }
      } catch {
        // A rejected transport request (disconnect mid-page) is a failed page too.
        if (requestIsCurrent()) {
          setLoadEarlierError(LOAD_EARLIER_ERROR)
        }
      } finally {
        // A late page from a prior tab must not unlock the current tab's request.
        if (requestIsCurrent()) {
          loadingEarlierRef.current = false
          setLoadingEarlier(false)
        }
      }
    })()
  }, [client, agent, sessionId, transcriptPath, hasMore, setList])

  // While the swapped-client read is in flight the previous settled list for
  // this same identity keeps rendering; `transcriptLoading` still tells
  // consumers not to trust it as settled history.
  const heldMessages =
    !settled && status === 'loading' && lastListRef.current?.identity === identity
      ? lastListRef.current.messages
      : EMPTY_MESSAGES

  return {
    // Withheld until the settled read belongs to this identity: the effect that
    // clears the previous tab's list is passive, so `messages` lags a commit.
    messages: settled ? messages : heldMessages,
    status,
    transcriptLoading: status === 'loading',
    error,
    hasMore,
    loadingEarlier,
    loadEarlierError,
    loadEarlier
  }
}
