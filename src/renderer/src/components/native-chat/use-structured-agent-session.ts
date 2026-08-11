import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session-journal-types'
import type { AgentType } from '../../../../shared/agent-status-types'
import type {
  AgentSessionMutationResult,
  AgentSessionHandoffDirection,
  AgentSessionHandoffMode,
  AgentSessionHandoffResult,
  AgentSessionOptionsResult,
  AgentSessionPromptResult
} from '../../../../shared/agent-session-wire'
import { getAgentSessionOptionCatalog } from '../../../../shared/agent-session-option-catalog'
import type { SessionOptionsSurface } from '../../../../shared/native-chat-session-options'
import { structuredAgentSessionPayloadFingerprint } from '../../../../shared/structured-agent-session-mutation'
import {
  applyStructuredAgentSessionOptions,
  canSetStructuredAgentSessionOption,
  commitStructuredAgentSessionOption,
  createStructuredAgentSessionOptionState,
  structuredAgentSessionOptionSnapshot
} from '../../../../shared/structured-agent-session-options'
import {
  activeStructuredAgentSessionTurnId,
  projectStructuredItemsToNativeChat
} from '../../../../shared/structured-agent-session-projection'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import {
  structuredSessionOperationId,
  useStructuredAgentSessionOutbox
} from './use-structured-agent-session-outbox'
import { useStructuredAgentSessionRead } from './use-structured-agent-session-read'

export type StructuredPromptItem = AgentJournalRenderItem & {
  body: Extract<AgentJournalRenderItem['body'], { kind: 'approval' | 'question' }>
}

export function useStructuredAgentSession(args: {
  sessionId: string
  target: RuntimeClientTarget
  agent: AgentType
}) {
  const { agent, sessionId, target } = args
  const { state, loadingOlder, loadOlder } = useStructuredAgentSessionRead({ sessionId, target })
  const stateRef = useRef(state)
  const [writeError, setWriteError] = useState<string | null>(null)
  const operationIds = useRef(new Map<string, string>())
  const [optionState, setOptionState] = useState(() =>
    createStructuredAgentSessionOptionState(agent)
  )
  const optionCatalog = useMemo(() => getAgentSessionOptionCatalog(agent), [agent])
  const outboxController = useStructuredAgentSessionOutbox({
    sessionId,
    target,
    fence: state.fence,
    submissions: state.submissions
  })

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const mutate = useCallback(
    async <T>(
      method: string,
      fingerprintMethod: string,
      fields: Record<string, unknown>,
      operationIdOverride?: string | null
    ): Promise<T | null> => {
      if (stateRef.current.fence === null) {
        return null
      }
      const key = `${fingerprintMethod}:${JSON.stringify(fields)}`
      const clientOperationId =
        operationIdOverride ?? operationIds.current.get(key) ?? structuredSessionOperationId()
      operationIds.current.set(key, clientOperationId)
      const result = await callStructuredAgentSession<AgentSessionMutationResult<T>>(
        target,
        method,
        {
          envelope: {
            sessionId,
            clientOperationId,
            expectedRuntimeFence: stateRef.current.fence,
            payloadFingerprint: structuredAgentSessionPayloadFingerprint({
              method: fingerprintMethod,
              sessionId,
              fields
            })
          },
          ...fields
        }
      )
      if (!result.ok) {
        setWriteError(result.refusal.message)
        return null
      }
      operationIds.current.delete(key)
      setWriteError(null)
      return result.value
    },
    [sessionId, target]
  )

  useEffect(() => {
    if (!optionCatalog) {
      return
    }
    void callStructuredAgentSession<AgentSessionOptionsResult>(target, 'agentSession.options', {
      sessionId
    }).then((result) =>
      setOptionState((current) =>
        applyStructuredAgentSessionOptions(current, optionCatalog, result)
      )
    )
  }, [optionCatalog, sessionId, target])

  const optionSnapshot = useMemo(
    () => structuredAgentSessionOptionSnapshot(optionState),
    [optionState]
  )
  const setStructuredOption = useCallback(
    async (id: string, value: string | boolean): Promise<boolean> => {
      if (
        !canSetStructuredAgentSessionOption(optionState, id, value) ||
        typeof value !== 'string'
      ) {
        return false
      }
      const targetRecord = optionState.record
      setOptionState((current) => ({ ...current, pendingId: id }))
      try {
        const result = await mutate('agentSession.setOption', 'agentSession.setOption', {
          key: id,
          value
        })
        if (result) {
          setOptionState((current) =>
            current.record === targetRecord
              ? commitStructuredAgentSessionOption(current, id, value)
              : current
          )
        }
        return Boolean(result)
      } finally {
        setOptionState((current) =>
          current.record === targetRecord && current.pendingId === id
            ? { ...current, pendingId: null }
            : current
        )
      }
    },
    [mutate, optionState]
  )
  const setOption = useCallback(
    async (id: string, value: string | boolean) => {
      await setStructuredOption(id, value)
      return { snapshot: optionSnapshot }
    },
    [optionSnapshot, setStructuredOption]
  )
  const optionSurface = useMemo<SessionOptionsSurface>(
    () => ({
      getSnapshot: () => optionSnapshot,
      setOption,
      invokeAction: async () => ({ snapshot: optionSnapshot }),
      subscribe: () => () => {}
    }),
    [optionSnapshot, setOption]
  )

  const prompts = state.items.filter(
    (item): item is StructuredPromptItem =>
      (item.body.kind === 'approval' || item.body.kind === 'question') &&
      item.body.resolution.state === 'pending'
  )
  const turnId = activeStructuredAgentSessionTurnId(state.items)
  return {
    messages: [
      ...projectStructuredItemsToNativeChat(state.items),
      ...outboxController.outbox.map((entry) => ({
        id: entry.clientMessageId,
        role: 'user' as const,
        source: 'transcript' as const,
        timestamp: entry.queuedAt,
        blocks: entry.body.blocks
      }))
    ],
    status: state.status,
    error: state.error ?? writeError ?? outboxController.error,
    hasOlder: state.hasOlder,
    loadingOlder,
    loadOlder,
    prompts,
    outbox: outboxController.outbox,
    blockedClientMessageId: outboxController.blockedClientMessageId,
    send: outboxController.send,
    retry: outboxController.retry,
    isWorking: turnId !== null,
    turnId,
    cancel: (turnId: string) => mutate('agentSession.cancel', 'agentSession.cancel', { turnId }),
    respond: (item: StructuredPromptItem, optionId: string) =>
      mutate<AgentSessionPromptResult>(
        item.body.kind === 'approval'
          ? 'agentSession.respondToApproval'
          : 'agentSession.respondToQuestion',
        `agentSession.respondTo:${item.body.kind}`,
        { itemId: item.itemId, expectedRevision: item.revision, optionId }
      ),
    optionSnapshot,
    optionSurface,
    setStructuredOption,
    requestHandoff: (
      direction: AgentSessionHandoffDirection,
      mode: AgentSessionHandoffMode,
      action: 'start' | 'cancel-queued' | 'retry' = 'start'
    ) =>
      mutate<AgentSessionHandoffResult>(
        'agentSession.requestHandoff',
        'agentSession.requestHandoff',
        { direction, mode, action },
        action === 'retry' ? stateRef.current.handoff?.operationId : null
      ),
    handoff: state.handoff
  }
}
