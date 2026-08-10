import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import type {
  AgentSessionHistoryResult,
  AgentSessionSubscribeEvent
} from '../../../src/shared/agent-session-wire'
import type { AgentJournalCursor } from '../../../src/shared/agent-session-journal-types'
import type { RpcClient } from '../transport/rpc-client'
import { createMobileStructuredEventCoalescer } from './mobile-structured-agent-session-coalescer'
import { projectStructuredItemsToNativeChat } from './mobile-structured-agent-session-projection'
import {
  EMPTY_MOBILE_STRUCTURED_AGENT_SESSION,
  oldestMobileStructuredCursor,
  reduceMobileStructuredAgentSession
} from './mobile-structured-agent-session-reducer'
import {
  createMobileStructuredReconnectState,
  noteStructuredBackground,
  noteStructuredStreamClosed,
  noteStructuredStreamOpened,
  resumeStructuredSession,
  STRUCTURED_STREAM_STABLE_MS
} from './mobile-structured-session-reconnect'

export function useMobileStructuredAgentSession(args: {
  client: RpcClient | null
  sessionId: string | null
}): {
  messages: ReturnType<typeof projectStructuredItemsToNativeChat>
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
  hasOlder: boolean
  loadingOlder: boolean
  loadOlder: () => Promise<boolean>
} {
  const { client, sessionId } = args
  const [state, dispatch] = useReducer(
    reduceMobileStructuredAgentSession,
    EMPTY_MOBILE_STRUCTURED_AGENT_SESSION
  )
  const stateRef = useRef(state)
  stateRef.current = state
  const resumeCursorRef = useRef<AgentJournalCursor | null>(state.cursor)
  resumeCursorRef.current = state.cursor
  const [loadingOlder, setLoadingOlder] = useState(false)
  const reconnectRef = useRef(createMobileStructuredReconnectState())
  const longevityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    dispatch({ type: 'loading' })
    setLoadingOlder(false)
    if (!client || !sessionId) {
      dispatch({ type: 'error', message: '' })
      return
    }
    let closed = false
    let streamOpened = false
    let unsubscribe = (): void => {}
    const coalescer = createMobileStructuredEventCoalescer((event) => {
      dispatch({ type: 'event', event })
    })
    const subscribe = (cursor: AgentJournalCursor | null): void => {
      if (closed) {
        return
      }
      streamOpened = true
      noteStructuredStreamOpened(reconnectRef.current, Date.now())
      longevityTimerRef.current = setTimeout(() => {
        longevityTimerRef.current = null
        if (!closed) {
          client.confirmStructuredStreamLongevity?.()
        }
      }, STRUCTURED_STREAM_STABLE_MS + 1)
      unsubscribe = client.subscribe(
        'agentSession.subscribe',
        { sessionId, ...(cursor ? { cursor } : {}) },
        (raw) => {
          if (closed) {
            return
          }
          const event = raw as AgentSessionSubscribeEvent | { type: 'error'; message?: string }
          if (event.type === 'error') {
            coalescer.flush()
            dispatch({
              type: 'error',
              message: event.message ?? 'Conversation stream unavailable'
            })
            return
          }
          if (event.type === 'snapshot' || event.type === 'reset') {
            setLoadingOlder(false)
            resumeCursorRef.current = event.snapshot.cursor
          } else if (event.type === 'batch') {
            const current = resumeCursorRef.current
            if (
              !current ||
              (current.epoch === event.batch.cursor.epoch &&
                event.batch.cursor.sequence >= current.sequence)
            ) {
              resumeCursorRef.current = event.batch.cursor
            }
          }
          coalescer.push(event)
        },
        {
          paramsForReconnect: () => ({
            sessionId,
            ...(resumeCursorRef.current ? { cursor: resumeCursorRef.current } : {})
          })
        }
      )
    }
    void client
      .sendRequest('agentSession.history', { sessionId, direction: 'tail', limit: 40 })
      .then((response) => {
        if (closed) {
          return
        }
        if (!response.ok) {
          throw new Error(response.error.message)
        }
        const result = response.result as AgentSessionHistoryResult
        if (result.ok) {
          dispatch({ type: 'tail-page', page: result.page })
          resumeCursorRef.current = result.page.liveCursor ?? null
          subscribe(result.page.liveCursor ?? null)
          return
        }
        dispatch({
          type: 'event',
          event: {
            type: 'reset',
            sessionId,
            reset: result.reset,
            snapshot: result.snapshot,
            fence: 0
          }
        })
        resumeCursorRef.current = result.snapshot.cursor
        subscribe(result.snapshot.cursor)
      })
      .catch((error: unknown) => {
        if (!closed) {
          dispatch({
            type: 'error',
            message: error instanceof Error ? error.message : 'Conversation history unavailable'
          })
        }
      })
    return () => {
      closed = true
      if (longevityTimerRef.current) {
        clearTimeout(longevityTimerRef.current)
        longevityTimerRef.current = null
      }
      if (streamOpened) {
        noteStructuredStreamClosed(reconnectRef.current, Date.now())
      }
      coalescer.dispose()
      unsubscribe()
    }
  }, [client, sessionId])

  useEffect(() => {
    if (!client || !sessionId) {
      return
    }
    const onAppState = (next: AppStateStatus): void => {
      if (next === 'active') {
        if (resumeStructuredSession(reconnectRef.current, Date.now()).reconnect) {
          client.restartAfterStructuredBackground?.()
        }
      } else {
        noteStructuredBackground(reconnectRef.current, Date.now())
      }
    }
    const subscription = AppState.addEventListener('change', onAppState)
    return () => subscription.remove()
  }, [client, sessionId])

  const loadOlder = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current
    const cursor = oldestMobileStructuredCursor(current)
    if (!client || !sessionId || !cursor || !current.hasOlder || loadingOlder) {
      return false
    }
    const requestedEpoch = cursor.epoch
    setLoadingOlder(true)
    try {
      const response = await client.sendRequest('agentSession.history', {
        sessionId,
        direction: 'before',
        cursor,
        limit: 40
      })
      if (!response.ok) {
        return false
      }
      const result = response.result as AgentSessionHistoryResult
      if (!result.ok) {
        dispatch({
          type: 'event',
          event: {
            type: 'reset',
            sessionId,
            reset: result.reset,
            snapshot: result.snapshot,
            fence: 0
          }
        })
        return false
      }
      dispatch({ type: 'older-page', requestedEpoch, page: result.page })
      return stateRef.current.epoch === requestedEpoch && result.page.epoch === requestedEpoch
    } finally {
      setLoadingOlder(false)
    }
  }, [client, loadingOlder, sessionId])

  const messages = useMemo(() => projectStructuredItemsToNativeChat(state.items), [state.items])
  return {
    messages,
    status: !client || !sessionId ? 'idle' : state.status,
    error: state.error || undefined,
    hasOlder: state.hasOlder,
    loadingOlder,
    loadOlder
  }
}
