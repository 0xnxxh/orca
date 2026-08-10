import { describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { IssueInfo } from '../../../shared/types'
import { subscribeGitHubIssueCacheEntry } from './use-github-issue-cache-entry'

function issue(number: number): IssueInfo {
  return {
    number,
    title: `Issue ${number}`,
    state: 'open',
    url: `https://example.com/issues/${number}`,
    labels: []
  }
}

describe('GitHub issue cache entry subscriptions', () => {
  it('uses one store listener and notifies only changed cache keys', () => {
    const initialCache = useAppStore.getState().issueCache
    const subscribeSpy = vi.spyOn(useAppStore, 'subscribe')
    const firstListener = vi.fn()
    const secondListener = vi.fn()
    const unsubscribeFirst = subscribeGitHubIssueCacheEntry('issue-a', firstListener)
    const unsubscribeSecond = subscribeGitHubIssueCacheEntry('issue-b', secondListener)

    try {
      expect(subscribeSpy).toHaveBeenCalledTimes(1)
      useAppStore.setState({ issueCache: { 'issue-b': { data: issue(2), fetchedAt: 1 } } })
      expect(firstListener).not.toHaveBeenCalled()
      expect(secondListener).toHaveBeenCalledTimes(1)

      const issueA = issue(1)
      useAppStore.setState((state) => ({
        issueCache: { ...state.issueCache, 'issue-a': { data: issueA, fetchedAt: 2 } }
      }))
      expect(firstListener).toHaveBeenCalledTimes(1)
      useAppStore.setState((state) => ({
        issueCache: { ...state.issueCache, 'issue-a': { data: issueA, fetchedAt: 3 } }
      }))
      expect(firstListener).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribeFirst()
      unsubscribeSecond()
      useAppStore.setState({ issueCache: initialCache })
      subscribeSpy.mockRestore()
    }
  })
})
