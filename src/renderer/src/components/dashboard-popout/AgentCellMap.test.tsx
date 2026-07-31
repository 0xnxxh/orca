// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { AgentCellMap } from './AgentCellMap'

const NOW = 1_000_000

function card(overrides: Partial<DashboardCard> = {}): DashboardCard {
  return {
    paneKey: 'pane-1',
    ptyId: 'pty-1',
    agentType: 'codex',
    bucket: 'working',
    dotState: 'working',
    task: 'Build cells',
    repoId: 'repo-1',
    worktreeId: 'worktree-1',
    tabId: 'tab-1',
    leafId: 'leaf-1',
    repoName: 'Orca',
    worktreeName: 'Cell map',
    conversationName: 'Agent alpha',
    startedAt: 1,
    finishedAt: null,
    stateChangedAt: 1,
    unseen: false,
    ...overrides
  }
}

function renderCells(cards: DashboardCard[], onOpenTerminal = vi.fn()): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <AgentCellMap cards={cards} now={NOW} onOpenTerminal={onOpenTerminal} />
    </TooltipProvider>
  )
}

afterEach(cleanup)

describe('AgentCellMap', () => {
  it('groups fixed-size agents into project and worktree cells', () => {
    renderCells([
      card(),
      card({
        paneKey: 'pane-2',
        conversationName: 'Agent beta',
        dotState: 'done',
        bucket: 'done'
      }),
      card({
        paneKey: 'pane-3',
        repoId: 'repo-2',
        repoName: 'Mobile',
        worktreeId: 'worktree-2',
        worktreeName: 'Mobile cells',
        conversationName: 'Mobile agent'
      })
    ])

    expect(screen.getAllByTestId('agent-cell-project')).toHaveLength(2)
    expect(screen.getAllByTestId('agent-cell-worktree')).toHaveLength(2)
    expect(screen.getByText('Cell map')).toBeInTheDocument()
    expect(screen.getByText('Mobile cells')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agent alpha, Working' })).toHaveClass(
      'fleet-status-working'
    )
    expect(screen.getByRole('button', { name: 'Agent beta, Done' })).toHaveClass(
      'fleet-status-done'
    )
  })

  it('opens the shared terminal flow from an agent node', () => {
    const onOpenTerminal = vi.fn()
    const agent = card()
    renderCells([agent], onOpenTerminal)

    fireEvent.click(screen.getByRole('button', { name: 'Agent alpha, Working' }))
    expect(onOpenTerminal).toHaveBeenCalledWith(agent, 'right')
  })

  it('shows the most recent response age instead of an agent count', () => {
    renderCells([
      card({
        paneKey: 'pane-1',
        bucket: 'done',
        dotState: 'done',
        finishedAt: NOW - 10 * 60_000,
        stateChangedAt: NOW - 10 * 60_000
      }),
      card({
        paneKey: 'pane-2',
        conversationName: 'Agent beta',
        startedAt: NOW - 30 * 60_000,
        stateChangedAt: NOW - 2 * 60_000
      })
    ])

    expect(screen.getByText('2m')).toBeInTheDocument()
  })
})
