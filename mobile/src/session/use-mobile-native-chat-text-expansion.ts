import { useCallback, useMemo, useState } from 'react'
import type { NativeChatTextRetrieval } from '../../../src/shared/native-chat-types'

type FullTextLoader = (messageId: string, retrieval: NativeChatTextRetrieval) => Promise<string>

type CachedText = { key: string; text: string }
type ExpansionRequest = { key: string }
type ExpansionState = {
  source: FullTextLoader
  cached: CachedText | null
  expandedKey: string | null
  request: ExpansionRequest | null
  errorKey: string | null
}

export type MobileNativeChatTextExpansion = {
  cached: CachedText | null
  expandedKey: string | null
  loadingKey: string | null
  errorKey: string | null
  toggle: (messageId: string, retrieval: NativeChatTextRetrieval) => void
}

export function mobileNativeChatTextKey(
  messageId: string,
  retrieval: NativeChatTextRetrieval
): string {
  return `${messageId}\0${retrieval.recordOffset}\0${retrieval.blockIndex}\0${retrieval.originalChars}`
}

/** Retains at most one full block and reuses it across collapse/re-expand. */
export function useMobileNativeChatTextExpansion(
  loadFullText: FullTextLoader
): MobileNativeChatTextExpansion {
  const [state, setState] = useState<ExpansionState>(() => emptyState(loadFullText))
  let current = state
  if (current.source !== loadFullText) {
    current = emptyState(loadFullText)
    setState(current)
  }

  const toggle = useCallback(
    (messageId: string, retrieval: NativeChatTextRetrieval): void => {
      const key = mobileNativeChatTextKey(messageId, retrieval)
      if (current.request?.key === key) {
        return
      }
      if (current.expandedKey === key) {
        setState({ ...current, expandedKey: null })
        return
      }
      if (current.cached?.key === key) {
        setState({ ...current, expandedKey: key, errorKey: null })
        return
      }
      const request = { key }
      setState({
        source: loadFullText,
        cached: null,
        expandedKey: null,
        request,
        errorKey: null
      })
      void loadFullText(messageId, retrieval)
        .then((text) => {
          setState((latest) =>
            latest.source === loadFullText && latest.request === request
              ? {
                  source: loadFullText,
                  cached: { key, text },
                  expandedKey: key,
                  request: null,
                  errorKey: null
                }
              : latest
          )
        })
        .catch(() => {
          setState((latest) =>
            latest.source === loadFullText && latest.request === request
              ? { ...latest, request: null, errorKey: key }
              : latest
          )
        })
    },
    [current, loadFullText]
  )

  return useMemo(
    () => ({
      cached: current.cached,
      expandedKey: current.expandedKey,
      loadingKey: current.request?.key ?? null,
      errorKey: current.errorKey,
      toggle
    }),
    [current, toggle]
  )
}

function emptyState(source: FullTextLoader): ExpansionState {
  return { source, cached: null, expandedKey: null, request: null, errorKey: null }
}
