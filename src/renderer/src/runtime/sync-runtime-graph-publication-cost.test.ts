import { describe, expect, it } from 'vitest'
import { buildMobileSessionTabSnapshots } from './sync-runtime-graph'
import type { AppState } from '../store/types'

// Why: getBrowserTabsByWorktree reads this slice once per worktree inside the build loop,
// so a counting accessor measures per-worktree work deterministically (no timing flake).
function makeCountingState(worktreeCount: number): {
  state: AppState
  reads: () => number
  resetReads: () => void
} {
  let reads = 0
  const tabsByWorktree: Record<string, unknown[]> = {}
  for (let i = 0; i < worktreeCount; i++) {
    tabsByWorktree[`repo::/wt-${i}`] = [
      { id: `term-${i}`, title: `Agent ${i}`, customTitle: null, type: 'terminal' }
    ]
  }

  const state = {
    tabsByWorktree,
    terminalLayoutsByTabId: {},
    runtimePaneTitlesByTabId: {},
    groupsByWorktree: {},
    activeGroupIdByWorktree: {},
    unifiedTabsByWorktree: {},
    tabBarOrderByWorktree: {},
    activeFileId: null,
    activeFileIdByWorktree: {},
    openFiles: [],
    editorDrafts: {},
    activeTabId: null,
    agentStatusByPaneKey: {},
    get browserTabsByWorktree() {
      reads++
      return {}
    }
  } as unknown as AppState

  return {
    state,
    reads: () => reads,
    resetReads: () => {
      reads = 0
    }
  }
}

// Both cases currently fail: the per-worktree cache is consulted *after* the content
// is built, so it saves the fanout and one allocation but none of the work. Drop the
// `.fails` when the build loop skips worktrees whose inputs are unchanged.
describe('mobile session publication cost', () => {
  it.fails('does not redo per-worktree work when nothing changed', () => {
    const WORKTREES = 300
    const { state, reads, resetReads } = makeCountingState(WORKTREES)

    buildMobileSessionTabSnapshots(state)
    resetReads()

    // Same state object, no mutation: a republish should do no per-worktree work.
    buildMobileSessionTabSnapshots(state)

    expect(reads()).toBeLessThan(WORKTREES / 10)
  })

  it.fails('rebuilds only the worktrees whose inputs changed', () => {
    const WORKTREES = 300
    const { state, reads, resetReads } = makeCountingState(WORKTREES)

    buildMobileSessionTabSnapshots(state)
    resetReads()

    // One worktree's tabs change — the other 299 are untouched.
    const next = {
      ...state,
      tabsByWorktree: {
        ...state.tabsByWorktree,
        'repo::/wt-7': [
          { id: 'term-7', title: 'Agent 7 (done)', customTitle: null, type: 'terminal' }
        ]
      },
      get browserTabsByWorktree() {
        return (state as unknown as { browserTabsByWorktree: unknown }).browserTabsByWorktree
      }
    } as unknown as AppState

    buildMobileSessionTabSnapshots(next)

    expect(reads()).toBeLessThan(WORKTREES / 10)
  })
})
