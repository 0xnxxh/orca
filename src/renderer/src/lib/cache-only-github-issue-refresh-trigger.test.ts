import { describe, expect, it, vi } from 'vitest'
import {
  advanceCacheOnlyGitHubIssueRefreshTrigger,
  getCacheOnlyGitHubIssueCatalogKey,
  INITIAL_CACHE_ONLY_GITHUB_ISSUE_REFRESH_TRIGGER_STATE
} from './cache-only-github-issue-refresh-trigger'

describe('cache-only GitHub issue refresh trigger', () => {
  it('does not consume paired-web warming while startup or eligibility is pending', () => {
    const beforeStartup = advanceCacheOnlyGitHubIssueRefreshTrigger(
      INITIAL_CACHE_ONLY_GITHUB_ISSUE_REFRESH_TRIGGER_STATE,
      {
        startupWorktreeRefreshCompleted: false,
        issueCatalogKey: 'issue-a',
        pairedWebEligible: true,
        spaceActive: false,
        windowVisible: true
      }
    )
    const ineligibleAfterStartup = advanceCacheOnlyGitHubIssueRefreshTrigger(beforeStartup.state, {
      startupWorktreeRefreshCompleted: true,
      issueCatalogKey: 'issue-a',
      pairedWebEligible: false,
      spaceActive: false,
      windowVisible: true
    })
    const eligible = advanceCacheOnlyGitHubIssueRefreshTrigger(ineligibleAfterStartup.state, {
      startupWorktreeRefreshCompleted: true,
      issueCatalogKey: 'issue-a',
      pairedWebEligible: true,
      spaceActive: false,
      windowVisible: true
    })

    expect(beforeStartup.shouldRefresh).toBe(false)
    expect(beforeStartup.state.pairedWebCatalogKey).toBeNull()
    expect(ineligibleAfterStartup.shouldRefresh).toBe(false)
    expect(eligible.shouldRefresh).toBe(true)
    expect(eligible.state.pairedWebCatalogKey).toBe('issue-a')
  })

  it('warms once per eligible paired-web issue catalog', () => {
    const first = advanceCacheOnlyGitHubIssueRefreshTrigger(
      INITIAL_CACHE_ONLY_GITHUB_ISSUE_REFRESH_TRIGGER_STATE,
      {
        startupWorktreeRefreshCompleted: true,
        issueCatalogKey: 'issue-a',
        pairedWebEligible: true,
        spaceActive: false,
        windowVisible: true
      }
    )
    const repeated = advanceCacheOnlyGitHubIssueRefreshTrigger(first.state, {
      startupWorktreeRefreshCompleted: true,
      issueCatalogKey: 'issue-a',
      pairedWebEligible: true,
      spaceActive: false,
      windowVisible: true
    })
    const catalogChanged = advanceCacheOnlyGitHubIssueRefreshTrigger(repeated.state, {
      startupWorktreeRefreshCompleted: true,
      issueCatalogKey: 'issue-b',
      pairedWebEligible: true,
      spaceActive: false,
      windowVisible: true
    })

    expect(first.shouldRefresh).toBe(true)
    expect(repeated.shouldRefresh).toBe(false)
    expect(catalogChanged.shouldRefresh).toBe(true)
    expect(catalogChanged.state.pairedWebCatalogKey).toBe('issue-b')
  })

  it('warms the same paired-web catalog after issue decorations are re-enabled', () => {
    const enabled = advanceCacheOnlyGitHubIssueRefreshTrigger(
      INITIAL_CACHE_ONLY_GITHUB_ISSUE_REFRESH_TRIGGER_STATE,
      {
        startupWorktreeRefreshCompleted: true,
        issueCatalogKey: 'issue-a',
        pairedWebEligible: true,
        spaceActive: false,
        windowVisible: true
      }
    )
    const disabled = advanceCacheOnlyGitHubIssueRefreshTrigger(enabled.state, {
      startupWorktreeRefreshCompleted: true,
      issueCatalogKey: 'issue-a',
      pairedWebEligible: false,
      spaceActive: false,
      windowVisible: true
    })
    const reenabled = advanceCacheOnlyGitHubIssueRefreshTrigger(disabled.state, {
      startupWorktreeRefreshCompleted: true,
      issueCatalogKey: 'issue-a',
      pairedWebEligible: true,
      spaceActive: false,
      windowVisible: true
    })

    expect(disabled.shouldRefresh).toBe(false)
    expect(disabled.state.pairedWebCatalogKey).toBeNull()
    expect(reenabled.shouldRefresh).toBe(true)
  })

  it('warms restored Space, later issue rows, and each re-entry', () => {
    const restoredBeforeStartup = advanceCacheOnlyGitHubIssueRefreshTrigger(
      INITIAL_CACHE_ONLY_GITHUB_ISSUE_REFRESH_TRIGGER_STATE,
      {
        startupWorktreeRefreshCompleted: false,
        issueCatalogKey: 'issue-a',
        pairedWebEligible: false,
        spaceActive: true,
        windowVisible: true
      }
    )
    const restoredAfterStartup = advanceCacheOnlyGitHubIssueRefreshTrigger(
      restoredBeforeStartup.state,
      {
        startupWorktreeRefreshCompleted: true,
        issueCatalogKey: 'issue-a',
        pairedWebEligible: false,
        spaceActive: true,
        windowVisible: true
      }
    )
    const stillOpen = advanceCacheOnlyGitHubIssueRefreshTrigger(restoredAfterStartup.state, {
      startupWorktreeRefreshCompleted: true,
      issueCatalogKey: 'issue-a',
      pairedWebEligible: false,
      spaceActive: true,
      windowVisible: true
    })
    const laterIssue = advanceCacheOnlyGitHubIssueRefreshTrigger(stillOpen.state, {
      startupWorktreeRefreshCompleted: true,
      issueCatalogKey: 'issue-b',
      pairedWebEligible: false,
      spaceActive: true,
      windowVisible: true
    })
    const closed = advanceCacheOnlyGitHubIssueRefreshTrigger(laterIssue.state, {
      startupWorktreeRefreshCompleted: true,
      issueCatalogKey: 'issue-b',
      pairedWebEligible: false,
      spaceActive: false,
      windowVisible: true
    })
    const reopened = advanceCacheOnlyGitHubIssueRefreshTrigger(closed.state, {
      startupWorktreeRefreshCompleted: true,
      issueCatalogKey: 'issue-b',
      pairedWebEligible: false,
      spaceActive: true,
      windowVisible: true
    })

    expect(restoredBeforeStartup.shouldRefresh).toBe(false)
    expect(restoredAfterStartup.shouldRefresh).toBe(true)
    expect(stillOpen.shouldRefresh).toBe(false)
    expect(laterIssue.shouldRefresh).toBe(true)
    expect(closed.shouldRefresh).toBe(false)
    expect(reopened.shouldRefresh).toBe(true)
  })

  it('coalesces paired-web startup and restored Space into one refresh', () => {
    const trigger = advanceCacheOnlyGitHubIssueRefreshTrigger(
      INITIAL_CACHE_ONLY_GITHUB_ISSUE_REFRESH_TRIGGER_STATE,
      {
        startupWorktreeRefreshCompleted: true,
        issueCatalogKey: 'issue-a',
        pairedWebEligible: true,
        spaceActive: true,
        windowVisible: true
      }
    )

    expect(trigger.shouldRefresh).toBe(true)
    expect(trigger.state).toEqual({
      pairedWebCatalogKey: 'issue-a',
      spaceCatalogKey: 'issue-a'
    })
  })

  it('records hidden catalog changes without starting background work', () => {
    const hidden = advanceCacheOnlyGitHubIssueRefreshTrigger(
      INITIAL_CACHE_ONLY_GITHUB_ISSUE_REFRESH_TRIGGER_STATE,
      {
        startupWorktreeRefreshCompleted: true,
        issueCatalogKey: 'issue-a',
        pairedWebEligible: true,
        spaceActive: true,
        windowVisible: false
      }
    )
    const laterVisibleMutation = advanceCacheOnlyGitHubIssueRefreshTrigger(hidden.state, {
      startupWorktreeRefreshCompleted: true,
      issueCatalogKey: 'issue-a',
      pairedWebEligible: true,
      spaceActive: true,
      windowVisible: true
    })

    expect(hidden.shouldRefresh).toBe(false)
    expect(hidden.state).toEqual({
      pairedWebCatalogKey: 'issue-a',
      spaceCatalogKey: 'issue-a'
    })
    expect(laterVisibleMutation.shouldRefresh).toBe(false)
  })

  it('reconciles a tracked catalog when its final linked issue disappears', () => {
    const initiallyEmpty = advanceCacheOnlyGitHubIssueRefreshTrigger(
      INITIAL_CACHE_ONLY_GITHUB_ISSUE_REFRESH_TRIGGER_STATE,
      {
        startupWorktreeRefreshCompleted: true,
        issueCatalogKey: '',
        pairedWebEligible: true,
        spaceActive: true,
        windowVisible: true
      }
    )
    const populated = advanceCacheOnlyGitHubIssueRefreshTrigger(initiallyEmpty.state, {
      startupWorktreeRefreshCompleted: true,
      issueCatalogKey: 'issue-a',
      pairedWebEligible: true,
      spaceActive: true,
      windowVisible: true
    })
    const emptied = advanceCacheOnlyGitHubIssueRefreshTrigger(populated.state, {
      startupWorktreeRefreshCompleted: true,
      issueCatalogKey: '',
      pairedWebEligible: true,
      spaceActive: true,
      windowVisible: true
    })

    expect(initiallyEmpty.shouldRefresh).toBe(false)
    expect(initiallyEmpty.state).toEqual({ pairedWebCatalogKey: '', spaceCatalogKey: '' })
    expect(populated.shouldRefresh).toBe(true)
    expect(emptied.shouldRefresh).toBe(true)
  })
})

describe('cache-only GitHub issue catalog key', () => {
  it('ignores activity-only churn but detects issue ownership changes', () => {
    const first = {
      repo: [
        {
          repoId: 'repo',
          linkedIssue: 12,
          hostId: 'ssh:nested',
          runtimeOwnerEnvironmentId: 'env-a',
          lastActivityAt: 1
        }
      ]
    }
    const activityOnly = {
      repo: [{ ...first.repo[0], lastActivityAt: 2 }]
    }
    const nextIssue = {
      repo: [{ ...first.repo[0], linkedIssue: 13 }]
    }

    expect(getCacheOnlyGitHubIssueCatalogKey(activityOnly)).toBe(
      getCacheOnlyGitHubIssueCatalogKey(first)
    )
    expect(getCacheOnlyGitHubIssueCatalogKey(nextIssue)).not.toBe(
      getCacheOnlyGitHubIssueCatalogKey(first)
    )
  })

  it('deduplicates repeated issue owners and caches each immutable snapshot', () => {
    const linkedIssueRead = vi.fn(() => 12)
    const worktree = { repoId: 'repo', hostId: 'local' }
    Object.defineProperty(worktree, 'linkedIssue', { enumerable: true, get: linkedIssueRead })
    const catalog = { repo: [worktree, { repoId: 'repo', hostId: 'local', linkedIssue: 12 }] }

    const first = getCacheOnlyGitHubIssueCatalogKey(catalog)
    const second = getCacheOnlyGitHubIssueCatalogKey(catalog)

    expect(second).toBe(first)
    expect(first.split('\n')).toHaveLength(1)
    expect(linkedIssueRead).toHaveBeenCalledTimes(1)
  })

  it('reuses unchanged repo-list signatures across root catalog replacements', () => {
    const untouchedLinkedIssueRead = vi.fn(() => 24)
    const untouched = { repoId: 'repo-b', hostId: 'local' }
    Object.defineProperty(untouched, 'linkedIssue', {
      enumerable: true,
      get: untouchedLinkedIssueRead
    })
    const first = {
      'repo-a': [{ repoId: 'repo-a', hostId: 'local', linkedIssue: 12 }],
      'repo-b': [untouched]
    }
    const activityOnly = {
      ...first,
      'repo-a': [{ ...first['repo-a'][0], lastActivityAt: 2 }]
    }

    expect(getCacheOnlyGitHubIssueCatalogKey(activityOnly)).toBe(
      getCacheOnlyGitHubIssueCatalogKey(first)
    )
    expect(untouchedLinkedIssueRead).toHaveBeenCalledTimes(1)
  })
})
