// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import type { Repo, Worktree } from '../../../../shared/types'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { AgentMap } from './AgentMap'
import * as StoreSelectors from '@/store/selectors'

const NOW = 2_000_000_000
const EXECUTION_HOST_ID = 'runtime:env-1' as const
const initialState = useAppStore.getState()

const repo = {
  id: 'repo-1',
  path: '/repo',
  displayName: 'Orca',
  badgeColor: '#000000',
  addedAt: NOW,
  kind: 'git',
  executionHostId: EXECUTION_HOST_ID
} satisfies Repo

const worktree = {
  id: 'worktree-1',
  repoId: repo.id,
  path: '/repo/worktrees/map',
  displayName: 'Agent map',
  comment: '',
  linkedIssue: null,
  linkedPR: null,
  linkedLinearIssue: null,
  branch: 'refs/heads/agent-map',
  head: 'abc123',
  isBare: false,
  isMainWorktree: false,
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: NOW,
  hostId: EXECUTION_HOST_ID
} satisfies Worktree

const collidingLocalWorktree = {
  ...worktree,
  path: '/local/repo/worktrees/map',
  displayName: 'Local agent map',
  hostId: 'local'
} satisfies Worktree

const card: DashboardCard = {
  paneKey: 'pane-1',
  ptyId: 'pty-1',
  agentType: 'codex',
  bucket: 'working',
  dotState: 'working',
  task: 'Build map',
  repoId: repo.id,
  worktreeId: worktree.id,
  tabId: 'tab-1',
  leafId: 'leaf-1',
  repoName: repo.displayName,
  worktreeName: worktree.displayName,
  startedAt: NOW - 60_000,
  finishedAt: null,
  stateChangedAt: NOW - 1_000,
  unseen: false,
  workspaceKind: 'worktree'
}

describe('Agent Map workspace context menu', () => {
  beforeEach(() => {
    useAppStore.setState({
      repos: [repo],
      worktreesByRepo: { [repo.id]: [collidingLocalWorktree, worktree] },
      projectGroups: [],
      workspaceStatuses: [{ id: 'todo', label: 'Todo' }]
    })
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialState, true)
    vi.restoreAllMocks()
  })

  it('opens the shared sidebar workspace actions from a worktree ring', async () => {
    const useWorktreeById = vi.spyOn(StoreSelectors, 'useWorktreeById')
    render(
      <TooltipProvider>
        <AgentMap
          cards={[{ ...card, executionHostId: EXECUTION_HOST_ID }]}
          now={NOW}
          workspaceContextMenusEnabled
          onOpenTerminal={() => {}}
        />
      </TooltipProvider>
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open Agent map worktree details' }), {
      clientX: 120,
      clientY: 140
    })

    expect(await screen.findByText('Workspace', {}, { timeout: 5_000 })).toBeInTheDocument()
    expect(screen.getByText('Update')).toBeInTheDocument()
    expect(screen.getByText('Move to Status')).toBeInTheDocument()
    expect(screen.getByText('Open in')).toBeInTheDocument()
    expect(screen.getByText('Copy Path')).toBeInTheDocument()
    expect(screen.getByText('Pin')).toBeInTheDocument()
    expect(screen.getByText('Mark Unread')).toBeInTheDocument()
    expect(screen.getByText('Sleep')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
    expect(useWorktreeById).toHaveBeenCalledWith(worktree.id, EXECUTION_HOST_ID)
  })

  it('opens the existing worktree composer from a project ring', async () => {
    const { container } = render(
      <TooltipProvider>
        <AgentMap cards={[card]} now={NOW} workspaceContextMenusEnabled onOpenTerminal={() => {}} />
      </TooltipProvider>
    )

    fireEvent.contextMenu(container.querySelector('[data-agent-map-project]')!, {
      clientX: 100,
      clientY: 110
    })
    fireEvent.click(await screen.findByText('Create new worktree for Orca', {}, { timeout: 5_000 }))

    expect(useAppStore.getState().activeModal).toBe('new-workspace-composer')
    expect(useAppStore.getState().modalData).toEqual({
      initialRepoId: repo.id,
      telemetrySource: 'sidebar'
    })
  })
})
