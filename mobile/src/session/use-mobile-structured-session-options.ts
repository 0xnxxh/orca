import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getAgentSessionOptionCatalog,
  type AgentSessionOptionCatalog
} from '../../../src/shared/agent-session-option-catalog'
import {
  buildNativeChatSessionOptionSnapshot,
  resolveEffectiveNativeChatModelId
} from '../../../src/shared/native-chat-session-option-snapshot'
import {
  createNativeChatSessionOptionRecord,
  applyNativeChatReportedSessionOptions,
  setTrackedSessionOption
} from '../../../src/shared/native-chat-session-option-state'
import type { SessionOptionValue } from '../../../src/shared/native-chat-session-options'
import type { AgentSessionOptionsResult } from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import { mobileStructuredOptionCatalog } from './mobile-structured-session-option-catalog'
import type { MobileStructuredAgent } from './mobile-structured-session-create'
import type { MobileNativeChatSessionOptionsController } from './use-mobile-native-chat-session-options'

export function useMobileStructuredSessionOptions(args: {
  client: RpcClient | null
  connected: boolean
  sessionId: string | null
  agent: MobileStructuredAgent | null
  setOption: (key: string, value: string) => Promise<boolean>
}): MobileNativeChatSessionOptionsController {
  const { client, connected, sessionId, agent, setOption: dispatchOption } = args
  const [version, setVersion] = useState(0)
  const [catalog, setCatalog] = useState<AgentSessionOptionCatalog | null>(null)
  const [pickerRequest, setPickerRequest] = useState<{ id: string; token: number } | null>(null)
  const [pending, setPending] = useState<{
    sessionId: string
    id: string
    record: ReturnType<typeof createNativeChatSessionOptionRecord>
  } | null>(null)
  const record = useMemo(
    () => createNativeChatSessionOptionRecord(agent ?? 'codex'),
    [agent, sessionId]
  )
  const activeRecordRef = useRef(record)
  useEffect(() => {
    activeRecordRef.current = record
  }, [record])
  const pendingId = pending?.record === record ? pending.id : null

  useEffect(() => {
    setCatalog(null)
    setPickerRequest(null)
    const seed = agent ? getAgentSessionOptionCatalog(agent) : null
    if (!client || !connected || !sessionId || !seed) {
      return
    }
    let stale = false
    void client
      .sendRequest('agentSession.options', { sessionId })
      .then((response) => {
        if (stale || !response.ok) {
          return
        }
        const result = response.result as AgentSessionOptionsResult
        const live = mobileStructuredOptionCatalog(seed, result)
        applyNativeChatReportedSessionOptions(record, {
          model: result.current.model,
          ...(result.current.effort ? { effort: result.current.effort } : {})
        })
        setCatalog(live)
        setVersion((current) => current + 1)
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [agent, client, connected, record, sessionId])

  const snapshot = useMemo(() => {
    void version
    if (!catalog || !sessionId) {
      return []
    }
    return buildNativeChatSessionOptionSnapshot({
      catalog,
      models: catalog.models,
      record,
      mode: 'live',
      modelLabel: 'Model'
    })
  }, [catalog, record, sessionId, version])

  const setOption = useCallback(
    async (id: string, value: SessionOptionValue): Promise<boolean> => {
      const descriptor = snapshot.find((entry) => entry.id === id)
      if (
        !catalog ||
        !sessionId ||
        typeof value !== 'string' ||
        pendingId !== null ||
        !descriptor ||
        descriptor.kind.type !== 'select' ||
        !descriptor.kind.choices.some((choice) => choice.value === value)
      ) {
        return false
      }
      const targetSessionId = sessionId
      const targetRecord = record
      setPending({ sessionId: targetSessionId, id, record: targetRecord })
      try {
        const applied = await dispatchOption(id, value)
        if (!applied || activeRecordRef.current !== targetRecord) {
          return false
        }
        const effectiveModel = resolveEffectiveNativeChatModelId(
          catalog,
          catalog.models,
          targetRecord
        )
        setTrackedSessionOption(targetRecord, id, value, 'dispatched', effectiveModel)
        setVersion((current) => current + 1)
        return true
      } finally {
        setPending((current) =>
          current?.record === targetRecord && current.id === id ? null : current
        )
      }
    },
    [catalog, dispatchOption, pendingId, record, sessionId, snapshot]
  )

  const invokeAction = useCallback(
    async (id: string): Promise<boolean> => {
      if (!snapshot.some((descriptor) => descriptor.id === id)) {
        return false
      }
      setPickerRequest({ id, token: Date.now() })
      return true
    },
    [snapshot]
  )

  return useMemo(
    () => ({
      snapshot,
      pendingId,
      setOption,
      invokeAction,
      recordCommand: () => {},
      pickerRequest,
      dismissPickerRequest: (token: number) =>
        setPickerRequest((current) => (current?.token === token ? null : current))
    }),
    [invokeAction, pendingId, pickerRequest, setOption, snapshot]
  )
}
