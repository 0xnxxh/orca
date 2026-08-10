import { useCallback, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import type { IssueInfo } from '../../../shared/types'

type IssueCacheEntryListener = () => void

const listenersByCacheKey = new Map<string, Set<IssueCacheEntryListener>>()
let unsubscribeFromStore: (() => void) | null = null

function getGitHubIssueCacheEntryData(cacheKey: string | null): IssueInfo | null | undefined {
  return cacheKey ? useAppStore.getState().issueCache[cacheKey]?.data : undefined
}

function installStoreSubscription(): void {
  unsubscribeFromStore ??= useAppStore.subscribe((state, previousState) => {
    if (state.issueCache === previousState.issueCache) {
      return
    }
    for (const [cacheKey, listeners] of listenersByCacheKey) {
      if (state.issueCache[cacheKey]?.data === previousState.issueCache[cacheKey]?.data) {
        continue
      }
      for (const listener of listeners) {
        listener()
      }
    }
  })
}

export function subscribeGitHubIssueCacheEntry(
  cacheKey: string | null,
  listener: IssueCacheEntryListener
): () => void {
  if (!cacheKey) {
    return () => {}
  }
  const listeners = listenersByCacheKey.get(cacheKey) ?? new Set<IssueCacheEntryListener>()
  listeners.add(listener)
  listenersByCacheKey.set(cacheKey, listeners)
  installStoreSubscription()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      listenersByCacheKey.delete(cacheKey)
    }
    if (listenersByCacheKey.size === 0) {
      unsubscribeFromStore?.()
      unsubscribeFromStore = null
    }
  }
}

export function useGitHubIssueCacheEntryData(
  cacheKey: string | null
): IssueInfo | null | undefined {
  const subscribe = useCallback(
    (listener: IssueCacheEntryListener) => subscribeGitHubIssueCacheEntry(cacheKey, listener),
    [cacheKey]
  )
  const getSnapshot = useCallback(() => getGitHubIssueCacheEntryData(cacheKey), [cacheKey])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
