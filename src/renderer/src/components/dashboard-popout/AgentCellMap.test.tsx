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
  it('groups agents into repo sections of glass worktree cells', () => {
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
    expect(screen.getByText('1 worktrees · 2 agents')).toBeInTheDocument()
    // Each agent is an orb carrying its own state class.
    expect(screen.getByRole('button', { name: 'Agent alpha, Working' })).toHaveClass(
      'agent-cell-orb',
      'fleet-status-working'
    )
    expect(screen.getByRole('button', { name: 'Agent beta, Done' })).toHaveClass(
      'fleet-status-done'
    )
  })

  it('blooms a cell with the worst state its agents are in', () => {
    renderCells([
      card(),
      card({ paneKey: 'pane-2', bucket: 'attention', dotState: 'waiting' }),
      card({ paneKey: 'pane-3', bucket: 'attention', dotState: 'blocked' })
    ])

    expect(screen.getByTestId('agent-cell-worktree')).toHaveAttribute('data-worst', 'blocked')
  })

  it('writes words only for an agent that needs the user', () => {
    renderCells([
      card({ task: 'Silent work' }),
      card({
        paneKey: 'pane-ask',
        conversationName: 'Agent ask',
        bucket: 'attention',
        dotState: 'waiting',
        askSummary: 'Should I force-push the rebase?',
        stateChangedAt: NOW - 5 * 60_000
      })
    ])

    expect(screen.getByText('Should I force-push the rebase?')).toBeInTheDocument()
    expect(screen.getByText('5m')).toBeInTheDocument()
    // The working agent contributes an orb, not a line of text.
    expect(screen.queryByText('Silent work')).not.toBeInTheDocument()
  })

  it('falls back to the last agent message when no ask summary was captured', () => {
    renderCells([
      card({
        bucket: 'attention',
        dotState: 'waiting',
        lastAgentMessage: 'Which migration should run first?'
      })
    ])

    expect(screen.getByText('Which migration should run first?')).toBeInTheDocument()
  })

  it('opens the responder from an orb and from the ask line', () => {
    const onOpenTerminal = vi.fn()
    const asking = card({
      bucket: 'attention',
      dotState: 'waiting',
      askSummary: 'Ready to merge?'
    })
    renderCells([asking], onOpenTerminal)

    fireEvent.click(screen.getByRole('button', { name: 'Agent alpha, Waiting for input' }))
    expect(onOpenTerminal).toHaveBeenCalledWith(asking, 'right')

    onOpenTerminal.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Open the question from Agent alpha' }))
    expect(onOpenTerminal).toHaveBeenCalledWith(asking, 'right')
  })

  it('rings the selected agent orb', () => {
    render(
      <TooltipProvider>
        <AgentCellMap
          cards={[card(), card({ paneKey: 'pane-2', conversationName: 'Agent beta' })]}
          now={NOW}
          selectedPaneKey="pane-2"
          onOpenTerminal={vi.fn()}
        />
      </TooltipProvider>
    )

    expect(screen.getByRole('button', { name: 'Agent beta, Working' })).toHaveClass('is-selected')
    expect(screen.getByRole('button', { name: 'Agent alpha, Working' })).not.toHaveClass(
      'is-selected'
    )
  })

  it('keeps its own scroll container on the sleek scrollbar', () => {
    const { container } = renderCells([card()])
    expect(container.querySelector('.agent-cell-map')).toHaveClass('scrollbar-sleek')
  })
})
