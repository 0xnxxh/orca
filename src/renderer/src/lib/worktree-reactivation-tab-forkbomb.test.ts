import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from './worktree-activation'
import { makeCreatedAgentWorktree as makeWorktree } from '@/lib/worktree-activation-created-agent-test-state'

// STA-1111: reopening a workspace repeatedly must never accumulate tabs.
// Two independent reopen paths can each seed a "last codex session" tab:
//   1. buildCreatedAgentReopenStartup — resumes worktree.createdWithAgent for an
//      empty worktree (ensureWorktreeHasInitialTerminal).
//   2. resumeSleepingAgentSessionsForWorktree — resumes a captured provider
//      session, re-captured on every sleep.
// Both must be idempotent across reopens; otherwise every return to the
// workspace mints another codex tab (the reported "fork bomb").

const initialAppStoreState = useAppStore.getState()

function baseState(
  worktree: ReturnType<typeof makeWorktree>
): Parameters<typeof useAppStore.setState>[0] {
  return {
    repos: [
      {
        id: 'repo-1',
        path: '/workspace/repo',
        displayName: 'repo',
        badgeColor: '#000000',
        addedAt: 0
      }
    ],
    worktreesByRepo: { 'repo-1': [worktree] },
    activeRepoId: 'repo-1',
    activeView: 'terminal',
    tabsByWorktree: {},
    unifiedTabsByWorktree: {},
    groupsByWorktree: {},
    layoutByWorktree: {},
    activeGroupIdByWorktree: {},
    openFiles: [],
    browserTabsByWorktree: {},
    activeFileIdByWorktree: {},
    activeBrowserTabIdByWorktree: {},
    activeTabTypeByWorktree: {},
    activeTabIdByWorktree: {},
    tabBarOrderByWorktree: {},
    pendingStartupByTabId: {},
    sleepingAgentSessionsByPaneKey: {},
    settings: {
      agentCmdOverrides: {},
      setupScriptLaunchMode: 'new-tab'
    } as unknown as ReturnType<typeof useAppStore.getState>['settings'],
    markWorktreeVisited: vi.fn(),
    recordWorktreeVisit: vi.fn(),
    refreshGitHubForWorktreeIfStale: vi.fn(),
    revealWorktreeInSidebar: vi.fn()
  }
}

function worktreeTabCount(worktreeId: string): number {
  return useAppStore.getState().tabsByWorktree[worktreeId]?.length ?? 0
}

afterEach(() => {
  useAppStore.setState(initialAppStoreState, true)
})

describe('STA-1111 worktree reopen does not fork-bomb tabs', () => {
  it('created-agent reopen seeds at most one codex tab across repeated activations', () => {
    const worktree = makeWorktree()
    useAppStore.setState(baseState(worktree))

    for (let reopen = 0; reopen < 3; reopen++) {
      activateAndRevealWorktree(worktree.id)
      // Simulate the resumed codex pty never staying live between visits.
      useAppStore.setState((s) => ({
        ptyIdsByTabId: {},
        tabsByWorktree: {
          ...s.tabsByWorktree,
          [worktree.id]: (s.tabsByWorktree[worktree.id] ?? []).map((tab) => ({
            ...tab,
            ptyId: null
          }))
        }
      }))
      expect(worktreeTabCount(worktree.id)).toBe(1)
    }
  })

  it('re-captured sleeping codex session resumes once, not once per reopen', () => {
    const worktree = makeWorktree()
    useAppStore.setState(baseState(worktree))

    for (let reopen = 0; reopen < 4; reopen++) {
      // Capture-on-sleep re-adds a fresh working record for the SAME provider
      // session every time the workspace is left; each reopen sees a new record.
      useAppStore.setState((s) => ({
        sleepingAgentSessionsByPaneKey: {
          ...s.sleepingAgentSessionsByPaneKey,
          [`slept-pane-${reopen}:0`]: {
            paneKey: `slept-pane-${reopen}:0`,
            tabId: `slept-pane-${reopen}`,
            worktreeId: worktree.id,
            agent: 'codex' as const,
            providerSession: { key: 'session_id', id: 'codex-session-1' },
            prompt: 'resume prior task',
            state: 'working' as const,
            origin: 'live' as const,
            capturedAt: 1000 + reopen,
            updatedAt: 1000 + reopen,
            terminalTitle: 'Codex'
          }
        }
      }))

      activateAndRevealWorktree(worktree.id)
      // The resumed codex pty dies between visits (session ended / crashed),
      // which is what let earlier builds re-resume into a brand-new tab.
      useAppStore.setState((s) => ({
        ptyIdsByTabId: {},
        tabsByWorktree: {
          ...s.tabsByWorktree,
          [worktree.id]: (s.tabsByWorktree[worktree.id] ?? []).map((tab) => ({
            ...tab,
            ptyId: null
          }))
        }
      }))

      // Revert-sensitive: without the activeOrQueuedResumeClaimsProviderSession
      // guard (PR #6945) this count climbs 1, 2, 3, 4 — the fork bomb.
      expect(worktreeTabCount(worktree.id)).toBe(1)
    }
  })
})
