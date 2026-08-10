import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getAgentSessionOptionCatalog } from '../../../src/shared/agent-session-option-catalog'
import {
  buildNativeChatSessionOptionSnapshot,
  resolveEffectiveNativeChatModelId
} from '../../../src/shared/native-chat-session-option-snapshot'
import {
  createNativeChatSessionOptionRecord,
  setTrackedSessionOption
} from '../../../src/shared/native-chat-session-option-state'
import type { SessionOptionValue } from '../../../src/shared/native-chat-session-options'
import type { MobileNativeChatSessionOptionsController } from './use-mobile-native-chat-session-options'

const CODEX_CATALOG = getAgentSessionOptionCatalog('codex')

export function useMobileStructuredSessionOptions(args: {
  sessionId: string | null
  setOption: (key: string, value: string) => Promise<boolean>
}): MobileNativeChatSessionOptionsController {
  const { sessionId, setOption: dispatchOption } = args
  const [version, setVersion] = useState(0)
  const [pending, setPending] = useState<{
    sessionId: string
    id: string
    record: ReturnType<typeof createNativeChatSessionOptionRecord>
  } | null>(null)
  const record = useMemo(() => createNativeChatSessionOptionRecord('codex'), [sessionId])
  const activeRecordRef = useRef(record)
  useEffect(() => {
    activeRecordRef.current = record
  }, [record])
  const pendingId = pending?.record === record ? pending.id : null

  const snapshot = useMemo(() => {
    void version
    if (!CODEX_CATALOG || !sessionId) {
      return []
    }
    return buildNativeChatSessionOptionSnapshot({
      catalog: CODEX_CATALOG,
      models: CODEX_CATALOG.models,
      record,
      mode: 'live',
      modelLabel: 'Model'
    })
  }, [record, sessionId, version])

  const setOption = useCallback(
    async (id: string, value: SessionOptionValue): Promise<boolean> => {
      if (!CODEX_CATALOG || !sessionId || typeof value !== 'string' || pendingId !== null) {
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
          CODEX_CATALOG,
          CODEX_CATALOG.models,
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
    [dispatchOption, pendingId, record, sessionId]
  )

  return useMemo(
    () => ({
      snapshot,
      pendingId,
      setOption,
      invokeAction: async () => false,
      recordCommand: () => {}
    }),
    [pendingId, setOption, snapshot]
  )
}
