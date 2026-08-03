import { describe, expect, it } from 'vitest'
import {
  computeVisibleWorktreeIds,
  isDefaultBranchWorkspace,
  type SidebarFilterState
} from './visible-worktrees'
import type { Repo, Worktree } from '../../../../shared/types'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'

/**
 * Repro for #8873 — "[Feature]: Display default branch".
 *
 * Reporter: turning "Hide default branch" OFF does not keep the repo's
 * default-branch workspace in the sidebar; once it has no live PTY/browser/agent
 * it counts as sleeping and "Hide sleeping" sweeps it away. There is no
 * "Always display default branch" escape hatch.
 */

function makeRepo(id: string): Repo {
  return { id, path: `/${id}`, displayName: id, badgeColor: '#000', addedAt: 0 }
}

function makeDefaultBranchWorktree(): Worktree {
  return {
    id: 'wt-main',
    repoId: 'repo1',
    path: '/tmp/repo1',
    head: 'abc123',
    branch: 'refs/heads/main',
    isBare: false,
    isMainWorktree: true,
    displayName: 'main',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0
  }
}

const repoMap = new Map<string, Repo>([['repo1', makeRepo('repo1')]])

type VisibleOptions = Parameters<typeof computeVisibleWorktreeIds>[2]

function visibleOptions(overrides: Partial<VisibleOptions> = {}): VisibleOptions {
  return {
    filterRepoIds: [],
    showSleepingWorkspaces: true,
    tabsByWorktree: {},
    ptyIdsByTabId: {},
    browserTabsByWorktree: {},
    worktreeIdsWithLiveAgent: new Set(),
    hideDefaultBranchWorkspace: false,
    hideAutomationGeneratedWorkspaces: false,
    hideCliCreatedWorkspaces: false,
    hideDetachedHeadWorkspaces: false,
    repoMap,
    workspaceHostScope: 'all',
    defaultHostId: LOCAL_EXECUTION_HOST_ID,
    worktreeLineageById: {},
    ...overrides
  }
}

describe('#8873 default-branch workspace under "Hide sleeping"', () => {
  it('is genuinely the default-branch row the "Hide default branch" toggle targets', () => {
    expect(isDefaultBranchWorkspace(makeDefaultBranchWorktree())).toBe(true)
  })

  it('stays in the sidebar when it is sleeping and "Hide sleeping" is on', () => {
    const worktree = makeDefaultBranchWorktree()

    const visible = computeVisibleWorktreeIds({ repo1: [worktree] }, [worktree.id], {
      ...visibleOptions({
        // "Hide sleeping" ON, "Hide default branch" OFF — exactly the reporter's setup.
        showSleepingWorkspaces: false,
        hideDefaultBranchWorkspace: false
      })
    })

    expect(visible).toEqual([worktree.id])
  })

  it('exposes an opt-in that keeps the default branch visible under "Hide sleeping"', () => {
    // The issue asks for an "Always display default branch" flag. Prove the
    // sidebar filter contract has no such knob today.
    const filterKeys: readonly (keyof SidebarFilterState)[] = [
      'showSleepingWorkspaces',
      'filterRepoIds',
      'hideDefaultBranchWorkspace',
      'hideAutomationGeneratedWorkspaces',
      'hideCliCreatedWorkspaces',
      'hideDetachedHeadWorkspaces',
      'visibleWorkspaceHostIds',
      'workspaceHostScope'
    ]
    const optionKeys = Object.keys(visibleOptions())

    const alwaysShowKnob = [...filterKeys, ...optionKeys].find((key) =>
      /always.*default|default.*always|pinDefaultBranch/i.test(key)
    )

    expect(alwaysShowKnob).toBeDefined()
  })
})
