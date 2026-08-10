import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { AgentSessionHistoryResult } from '../../../../shared/agent-session-wire'
import {
  projectStructuredAgentSessionStatus,
  structuredAgentSessionPaneKey
} from '../../../../shared/structured-agent-session-projection'
import {
  EMPTY_STRUCTURED_AGENT_SESSION,
  reduceStructuredAgentSession,
  shouldAdvanceStructuredResumeCursor,
  type StructuredAgentSessionState
} from '../../../../shared/structured-agent-session-reducer'
import type { Tab } from '../../../../shared/types'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { useAppStore } from '@/store'
import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import {
  callStructuredAgentSession,
  subscribeStructuredAgentSession
} from '@/runtime/structured-agent-session-client'

type StructuredTab = Tab & { contentType: 'agent-session' }

function latestPrompt(state: StructuredAgentSessionState): string {
  for (let index = state.items.length - 1; index >= 0; index -= 1) {
    const body = state.items[index]?.body
    if (body?.kind === 'message' && body.role === 'user') {
      return body.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
    }
  }
  return ''
}

function projectStatus(tab: StructuredTab, state: StructuredAgentSessionState): void {
  const projection = projectStructuredAgentSessionStatus(state.items)
  const store = useAppStore.getState()
  store.setAgentStatus(
    structuredAgentSessionPaneKey(tab.id, tab.entityId),
    {
      state: projection === 'working' ? 'working' : projection === 'attention' ? 'blocked' : 'done',
      prompt: latestPrompt(state),
      agentType: tab.agentSessionAgent ?? 'codex',
      sessionBoundary: projection === 'idle'
    },
    tab.label,
    undefined,
    { tabId: tab.id, worktreeId: tab.worktreeId },
    { providerSession: { key: 'session_id', id: tab.entityId } }
  )
}

function startStatusProjection(tab: StructuredTab): () => void {
  const environmentId = getRuntimeEnvironmentIdForWorktree(useAppStore.getState(), tab.worktreeId)
  const target = getActiveRuntimeTarget({ activeRuntimeEnvironmentId: environmentId })
  let state = EMPTY_STRUCTURED_AGENT_SESSION
  let stopped = false
  let connected = false
  let opening = false
  let unsubscribe = (): void => {}
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  const apply = (action: Parameters<typeof reduceStructuredAgentSession>[1]): void => {
    state = reduceStructuredAgentSession(state, action)
    projectStatus(tab, state)
  }
  const scheduleReconnect = (): void => {
    if (stopped || connected || reconnectTimer) {
      return
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void open()
    }, 750)
  }
  const open = async (): Promise<void> => {
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
      const handle = await subscribeStructuredAgentSession(
        target,
        { sessionId: tab.entityId, ...(state.cursor ? { cursor: state.cursor } : {}) },
        (event) => {
          if (
            event.type === 'batch' &&
            !shouldAdvanceStructuredResumeCursor(state.cursor, event.batch.cursor)
          ) {
            return
          }
          if (event.type === 'end') {
            connected = false
            scheduleReconnect()
          }
          apply({ type: 'event', event })
        },
        () => {
          connected = false
          scheduleReconnect()
        }
      )
      if (stopped) {
        handle.unsubscribe()
      } else {
        connected = true
        unsubscribe = handle.unsubscribe
      }
    } catch {
      connected = false
      scheduleReconnect()
    } finally {
      opening = false
    }
  }
  void callStructuredAgentSession<AgentSessionHistoryResult>(target, 'agentSession.history', {
    sessionId: tab.entityId,
    direction: 'tail',
    limit: 40
  })
    .then(async (result) => {
      if (stopped) {
        return
      }
      if (result.ok) {
        apply({ type: 'tail-page', page: result.page })
      } else {
        apply({
          type: 'event',
          event: {
            type: 'reset',
            sessionId: tab.entityId,
            reset: result.reset,
            snapshot: result.snapshot,
            fence: result.fence ?? 0
          }
        })
      }
      await open()
    })
    .catch(scheduleReconnect)
  return () => {
    stopped = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
    }
    unsubscribe()
    useAppStore.getState().removeAgentStatus(structuredAgentSessionPaneKey(tab.id, tab.entityId))
  }
}

export function StructuredAgentSessionStatusBridge(): null {
  const tabs = useAppStore(
    useShallow((state) =>
      Object.values(state.unifiedTabsByWorktree)
        .flat()
        .filter((tab): tab is StructuredTab => tab.contentType === 'agent-session')
    )
  )
  useEffect(() => {
    const stops = tabs.map(startStatusProjection)
    return () => stops.forEach((stop) => stop())
  }, [tabs])
  return null
}
