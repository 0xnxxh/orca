// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { ActivityLanes } from './ActivityLanes'

const NOW = 12 * 60 * 60 * 1_000

function card(overrides: Partial<DashboardCard> = {}): DashboardCard {
  return {
    paneKey: 'parent',
    ptyId: 'pty-parent',
    agentType: 'codex',
    bucket: 'working',
    dotState: 'working',
    task: 'Implement activity lanes',
    repoId: 'repo-1',
    worktreeId: 'worktree-1',
    tabId: 'tab-1',
    leafId: 'leaf-1',
    repoName: 'Orca',
    worktreeName: 'dashboard',
    conversationName: 'Lane parent',
    startedAt: NOW - 60 * 60 * 1_000,
    finishedAt: null,
    stateChangedAt: NOW - 30 * 60 * 1_000,
    lastResponseAt: NOW - 5 * 60 * 1_000,
    unseen: false,
    ...overrides
  }
}

afterEach(cleanup)

describe('ActivityLanes', () => {
  it('renders lineage across worktrees with fixed icons and the canonical working spinner', () => {
    const onOpenTerminal = vi.fn()
    const parent = card()
    const child = card({
      paneKey: 'child',
      parentPaneKey: parent.paneKey,
      worktreeId: 'worktree-2',
      worktreeName: 'child-worktree',
      conversationName: 'Lane child',
      startedAt: NOW - 30 * 60 * 1_000
    })

    const { container } = render(
      <ActivityLanes cards={[child, parent]} now={NOW} onOpenTerminal={onOpenTerminal} />
    )

    expect(screen.getByText('dashboard')).toBeInTheDocument()
    expect(screen.getByText(/child-worktree/)).toBeInTheDocument()
    expect(screen.getAllByText(/5m since response/)).toHaveLength(2)
    expect(container.querySelectorAll('.activity-lane-agent-icon')).toHaveLength(2)
    expect(container.querySelector('[data-agent-spinner]')).toBeInTheDocument()
    expect(container.querySelector('.activity-lane-lineage path')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Lane child,/ }))
    expect(onOpenTerminal).toHaveBeenCalledWith(child, 'right')
  })

  it('reveals stale completed sessions with Show older', () => {
    const recent = card({
      paneKey: 'recent',
      bucket: 'done',
      dotState: 'done',
      conversationName: 'Recent result',
      finishedAt: NOW - 30 * 60 * 1_000,
      lastResponseAt: NOW - 30 * 60 * 1_000
    })
    const old = card({
      paneKey: 'old',
      bucket: 'done',
      dotState: 'done',
      conversationName: 'Older result',
      finishedAt: NOW - 3 * 60 * 60 * 1_000,
      lastResponseAt: NOW - 3 * 60 * 60 * 1_000
    })
    render(<ActivityLanes cards={[recent, old]} now={NOW} onOpenTerminal={vi.fn()} />)

    expect(screen.getByRole('button', { name: /Recent result,/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Older result,/ })).not.toBeInTheDocument()
    expect(screen.getByText(/1 shown · 1 older hidden/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show older' }))
    expect(screen.getByRole('button', { name: /Older result,/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide older' })).toBeInTheDocument()
  })
})
