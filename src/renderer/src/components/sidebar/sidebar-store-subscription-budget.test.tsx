// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { readStoreListenerCount } from '@/store/store-listener-census'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { Repo, Worktree } from '../../../../shared/types'
import {
  useWorktreeCardCacheSelection,
  useWorktreeCardStoreSelection
} from './use-worktree-card-store-selection'
import { useWorktreeActivityStatus } from './use-worktree-activity-status'
import { useWorktreeContextMenuStoreSelection } from './use-worktree-context-menu-store-selection'
import { useWorktreeAgentRows } from './useWorktreeAgentRows'

const TARGET_WORKTREE_ID = 'wt-target'
const OTHER_WORKTREE_ID = 'wt-other'
const OTHER_WORKSPACE_KEY = `worktree:${OTHER_WORKTREE_ID}` as const
const TARGET_PANE_KEY = makePaneKey('tab-target', '11111111-1111-4111-8111-111111111111')
const OTHER_PANE_KEY = makePaneKey('tab-other', '22222222-2222-4222-8222-222222222222')
const originalState = useAppStore.getState()

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(node: ReactNode): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(node))
}

function unmount(): void {
  if (root) {
    act(() => root?.unmount())
  }
  root = null
  container?.remove()
  container = null
}

function listenerCount(): number {
  const count = readStoreListenerCount()
  if (count === null) {
    throw new Error('store listener census unavailable')
  }
  return count
}

function makeWorktree(): Worktree {
  return {
    id: TARGET_WORKTREE_ID,
    repoId: 'repo-target',
    path: '/repo/target',
    displayName: 'Target',
    branch: 'target',
    head: 'abc123',
    isBare: false,
    isMainWorktree: false,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1
  }
}

function makeRepo(): Repo {
  return {
    id: 'repo-target',
    path: '/repo',
    displayName: 'Target repo',
    badgeColor: '#999999',
    addedAt: 1
  }
}

function makeDeleteState() {
  return {
    isDeleting: true,
    phase: 'deleting' as const,
    error: null,
    canForceDelete: false,
    forceDeleteReason: null
  }
}

function makeAgentEntry(
  paneKey: string,
  worktreeId: string,
  tabId: string,
  prompt: string
): AgentStatusEntry {
  const now = Date.now()
  return {
    paneKey,
    worktreeId,
    tabId,
    state: 'working',
    prompt,
    updatedAt: now,
    stateStartedAt: now,
    stateHistory: [],
    agentType: 'codex'
  }
}

function publishAgentEntries(entries: Record<string, AgentStatusEntry>): void {
  const state = useAppStore.getState()
  useAppStore.setState({
    agentStatusByPaneKey: entries,
    agentStatusEpoch: state.agentStatusEpoch + 1
  })
}

afterEach(() => {
  unmount()
  useAppStore.setState(originalState, true)
})

describe('sidebar store subscription budget', () => {
  it('keeps WorktreeCard state and cache selection to two real-store listeners', () => {
    const worktree = makeWorktree()
    const repo = makeRepo()
    const targetIssueEntry = { data: null, fetchedAt: 2 }
    let renders = 0
    let selectedDeleting = false
    let selectedIssueEntry: unknown

    function Probe(): null {
      renders += 1
      const selection = useWorktreeCardStoreSelection(worktree, repo)
      const cacheSelection = useWorktreeCardCacheSelection({
        hostedReviewCacheKey: '',
        issueCacheKey: 'issue-target',
        linearIssueCacheKey: '',
        linkedLinearIssue: null,
        prCacheKey: ''
      })
      selectedDeleting = selection.deleteState?.isDeleting ?? false
      selectedIssueEntry = cacheSelection.issueEntry
      return null
    }

    const baseline = listenerCount()
    mount(<Probe />)

    expect(listenerCount() - baseline).toBe(2)
    expect(renders).toBe(1)

    act(() => {
      useAppStore.setState({
        deleteStateByWorktreeId: { [OTHER_WORKTREE_ID]: makeDeleteState() },
        issueCache: { 'issue-other': { data: null, fetchedAt: 1 } as never }
      })
    })

    expect(renders).toBe(1)

    act(() => {
      useAppStore.setState({
        deleteStateByWorktreeId: { [TARGET_WORKTREE_ID]: makeDeleteState() },
        issueCache: { 'issue-target': targetIssueEntry as never }
      })
    })

    expect(renders).toBe(2)
    expect(selectedDeleting).toBe(true)
    expect(selectedIssueEntry).toBe(targetIssueEntry)

    unmount()
    expect(listenerCount()).toBe(baseline)
  })

  it('uses one listener and skips rerenders for another worktree agent ping', () => {
    const targetEntry = makeAgentEntry(
      TARGET_PANE_KEY,
      TARGET_WORKTREE_ID,
      'tab-target',
      'target prompt'
    )
    const otherEntry = makeAgentEntry(
      OTHER_PANE_KEY,
      OTHER_WORKTREE_ID,
      'tab-other',
      'other prompt'
    )
    publishAgentEntries({ [TARGET_PANE_KEY]: targetEntry, [OTHER_PANE_KEY]: otherEntry })

    let renders = 0
    let selectedPrompt = ''

    function Probe(): null {
      renders += 1
      selectedPrompt = useWorktreeAgentRows(TARGET_WORKTREE_ID)[0]?.entry.prompt ?? ''
      return null
    }

    const baseline = listenerCount()
    mount(<Probe />)

    expect(listenerCount() - baseline).toBe(1)
    expect(renders).toBe(1)
    expect(selectedPrompt).toBe('target prompt')

    act(() => {
      publishAgentEntries({
        [TARGET_PANE_KEY]: targetEntry,
        [OTHER_PANE_KEY]: { ...otherEntry, prompt: 'other prompt updated' }
      })
    })

    expect(renders).toBe(1)

    act(() => {
      publishAgentEntries({
        [TARGET_PANE_KEY]: { ...targetEntry, prompt: 'target prompt updated' },
        [OTHER_PANE_KEY]: otherEntry
      })
    })

    expect(renders).toBe(2)
    expect(selectedPrompt).toBe('target prompt updated')

    unmount()
    expect(listenerCount()).toBe(baseline)
  })

  it('keeps worktree activity status to one listener across unrelated browser churn', () => {
    let renders = 0
    let selectedStatus = ''

    function Probe(): null {
      renders += 1
      selectedStatus = useWorktreeActivityStatus(TARGET_WORKTREE_ID)
      return null
    }

    const baseline = listenerCount()
    mount(<Probe />)

    expect(listenerCount() - baseline).toBe(1)
    expect(renders).toBe(1)
    expect(selectedStatus).toBe('inactive')

    act(() => {
      useAppStore.setState({
        browserTabsByWorktree: {
          [OTHER_WORKTREE_ID]: [{ id: 'browser-other' }] as never
        }
      })
    })

    expect(renders).toBe(1)

    act(() => {
      useAppStore.setState({
        browserTabsByWorktree: {
          [TARGET_WORKTREE_ID]: [{ id: 'browser-target' }] as never
        }
      })
    })

    expect(renders).toBe(2)
    expect(selectedStatus).toBe('active')

    unmount()
    expect(listenerCount()).toBe(baseline)
  })

  it('keeps a closed worktree context menu to one listener across scoped map churn', () => {
    const worktree = makeWorktree()
    let renders = 0
    let selectedDeleting = false
    let selectedTabCount = -1

    function Probe(): null {
      renders += 1
      const selection = useWorktreeContextMenuStoreSelection(worktree, false)
      selectedDeleting = selection.deleteState?.isDeleting ?? false
      selectedTabCount = Object.keys(selection.tabsByWorktree).length
      return null
    }

    const baseline = listenerCount()
    mount(<Probe />)

    expect(listenerCount() - baseline).toBe(1)
    expect(renders).toBe(1)

    act(() => {
      useAppStore.setState({
        tabsByWorktree: { [OTHER_WORKTREE_ID]: [] },
        ptyIdsByTabId: { 'tab-other': ['pty-other'] },
        browserTabsByWorktree: {
          [OTHER_WORKTREE_ID]: [{ id: 'browser-other' }] as never
        },
        deleteStateByWorktreeId: { [OTHER_WORKTREE_ID]: makeDeleteState() },
        worktreeLineageById: { [OTHER_WORKTREE_ID]: {} as never },
        workspaceLineageByChildKey: { [OTHER_WORKSPACE_KEY]: {} as never }
      })
    })

    expect(renders).toBe(1)
    expect(selectedTabCount).toBe(0)

    act(() => {
      useAppStore.setState({
        deleteStateByWorktreeId: { [TARGET_WORKTREE_ID]: makeDeleteState() }
      })
    })

    expect(renders).toBe(2)
    expect(selectedDeleting).toBe(true)
    expect(selectedTabCount).toBe(0)

    unmount()
    expect(listenerCount()).toBe(baseline)
  })
})
