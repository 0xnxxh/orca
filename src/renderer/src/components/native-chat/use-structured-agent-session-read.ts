import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type {
  AgentSessionHistoryResult,
  AgentSessionSubscribeEvent
} from '../../../../shared/agent-session-wire'
import { createStructuredAgentSessionEventCoalescer } from '../../../../shared/structured-agent-session-coalescer'
import {
  EMPTY_STRUCTURED_AGENT_SESSION,
  oldestStructuredAgentSessionCursor,
  reduceStructuredAgentSession,
  shouldAdvanceStructuredResumeCursor
} from '../../../../shared/structured-agent-session-reducer'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import {
  callStructuredAgentSession,
  subscribeStructuredAgentSession
} from '@/runtime/structured-agent-session-client'

export function useStructuredAgentSessionRead(args: {
  sessionId: string
  target: RuntimeClientTarget
}) {
  const { sessionId, target } = args
  const [state, dispatch] = useReducer(reduceStructuredAgentSession, EMPTY_STRUCTURED_AGENT_SESSION)
  const stateRef = useRef(state)
  stateRef.current = state
  const resumeCursorRef = useRef(state.cursor)
  const [loadingOlder, setLoadingOlder] = useState(false)

  useEffect(() => {
    resumeCursorRef.current = null
    dispatch({ type: 'loading' })
    let stopped = false
    let connected = false
    let opening = false
    let unsubscribe = (): void => {}
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    const coalescer = createStructuredAgentSessionEventCoalescer((event) =>
      dispatch({ type: 'event', event })
    )
    function scheduleReconnect(delay = 750): void {
      if (stopped || reconnectTimer) {
        return
      }
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        if (!connected) {
          void open()
        }
      }, delay)
    }
    async function open(): Promise<void> {
      if (stopped || connected) {
        return
      }
      if (opening) {
        scheduleReconnect()
        return
      }
      opening = true
      unsubscribe()
      unsubscribe = (): void => {}
      try {
        const cursor = resumeCursorRef.current
        const handle = await subscribeStructuredAgentSession(
          target,
          { sessionId, ...(cursor ? { cursor } : {}) },
          (event: AgentSessionSubscribeEvent) => {
            if (event.type === 'snapshot' || event.type === 'reset') {
              resumeCursorRef.current = event.snapshot.cursor
            } else if (
              event.type === 'batch' &&
              shouldAdvanceStructuredResumeCursor(resumeCursorRef.current, event.batch.cursor)
            ) {
              resumeCursorRef.current = event.batch.cursor
            } else if (event.type === 'end') {
              connected = false
              scheduleReconnect()
            }
            coalescer.push(event)
          },
          (error) => {
            connected = false
            dispatch({ type: 'error', message: String(error) })
            scheduleReconnect()
          }
        )
        if (stopped) {
          handle.unsubscribe()
        } else {
          connected = true
          unsubscribe = handle.unsubscribe
        }
      } catch (error) {
        connected = false
        dispatch({ type: 'error', message: String(error) })
        scheduleReconnect()
      } finally {
        opening = false
      }
    }
    async function refreshTail(): Promise<void> {
      const result = await callStructuredAgentSession<AgentSessionHistoryResult>(
        target,
        'agentSession.history',
        { sessionId, direction: 'tail', limit: 40 }
      )
      if (stopped) {
        return
      }
      if (result.ok) {
        dispatch({ type: 'tail-page', page: result.page })
        resumeCursorRef.current = result.page.liveCursor ?? null
      } else {
        dispatch({
          type: 'event',
          event: {
            type: 'reset',
            sessionId,
            reset: result.reset,
            snapshot: result.snapshot,
            fence: result.fence ?? 0
          }
        })
        resumeCursorRef.current = result.snapshot.cursor
      }
    }
    const refreshOnFocus = (): void => {
      if (!document.hasFocus()) {
        return
      }
      void refreshTail()
        .catch((error) => dispatch({ type: 'error', message: String(error) }))
        .finally(() => {
          if (!connected) {
            scheduleReconnect(0)
          }
        })
    }
    window.addEventListener('focus', refreshOnFocus)
    void refreshTail()
      .then(() => open())
      .catch((error) => {
        dispatch({ type: 'error', message: String(error) })
        scheduleReconnect()
      })
    return () => {
      stopped = true
      window.removeEventListener('focus', refreshOnFocus)
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
      }
      coalescer.dispose()
      unsubscribe()
    }
  }, [sessionId, target])

  const loadOlder = useCallback(async (): Promise<void> => {
    const cursor = oldestStructuredAgentSessionCursor(stateRef.current)
    if (!cursor || !stateRef.current.hasOlder || loadingOlder) {
      return
    }
    setLoadingOlder(true)
    try {
      const result = await callStructuredAgentSession<AgentSessionHistoryResult>(
        target,
        'agentSession.history',
        { sessionId, direction: 'before', cursor, limit: 40 }
      )
      if (result.ok) {
        dispatch({ type: 'older-page', requestedEpoch: cursor.epoch, page: result.page })
      }
    } catch (error) {
      dispatch({ type: 'error', message: String(error) })
    } finally {
      setLoadingOlder(false)
    }
  }, [loadingOlder, sessionId, target])

  return { state, loadingOlder, loadOlder }
}
