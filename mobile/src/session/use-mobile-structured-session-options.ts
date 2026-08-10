import { useCallback, useMemo, useRef, useState } from 'react'
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
  const [pendingId, setPendingId] = useState<string | null>(null)
  const recordRef = useRef(createNativeChatSessionOptionRecord('codex'))
  const sessionRef = useRef(sessionId)
  if (sessionRef.current !== sessionId) {
    sessionRef.current = sessionId
    recordRef.current = createNativeChatSessionOptionRecord('codex')
  }

  const snapshot = useMemo(() => {
    void version
    if (!CODEX_CATALOG || !sessionId) {
      return []
    }
    return buildNativeChatSessionOptionSnapshot({
      catalog: CODEX_CATALOG,
      models: CODEX_CATALOG.models,
      record: recordRef.current,
      mode: 'live',
      modelLabel: 'Model'
    })
  }, [sessionId, version])

  const setOption = useCallback(
    async (id: string, value: SessionOptionValue): Promise<boolean> => {
      if (!CODEX_CATALOG || !sessionId || typeof value !== 'string' || pendingId !== null) {
        return false
      }
      setPendingId(id)
      try {
        const applied = await dispatchOption(id, value)
        if (!applied) {
          return false
        }
        const effectiveModel = resolveEffectiveNativeChatModelId(
          CODEX_CATALOG,
          CODEX_CATALOG.models,
          recordRef.current
        )
        setTrackedSessionOption(recordRef.current, id, value, 'dispatched', effectiveModel)
        setVersion((current) => current + 1)
        return true
      } finally {
        setPendingId(null)
      }
    },
    [dispatchOption, pendingId, sessionId]
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
