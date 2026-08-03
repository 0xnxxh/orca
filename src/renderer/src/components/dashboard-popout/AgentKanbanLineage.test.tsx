// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { AgentKanbanLineage } from './AgentKanbanLineage'
import { buildAgentKanbanLineage } from './agent-kanban-lineage'

vi.mock('./AgentKanbanCard', () => ({
  AgentKanbanCard: ({ card }: { card: DashboardCard }) => <div>{card.worktreeName}</div>
}))

function card(
  paneKey: string,
  bucket: DashboardCard['bucket'],
  parentPaneKey?: string
): DashboardCard {
  return {
    paneKey,
    parentPaneKey,
    ptyId: null,
    agentType: 'codex',
    bucket,
    dotState: bucket === 'done' ? 'done' : 'working',
    task: paneKey,
    repoId: 'repo',
    worktreeId: 'worktree',
    tabId: 'tab',
    leafId: null,
    repoName: 'Orca',
    worktreeName: paneKey,
    startedAt: 0,
    finishedAt: null,
    stateChangedAt: 0,
    unseen: false
  }
}

describe('AgentKanbanLineage', () => {
  it('draws same-column children beneath their parent', () => {
    const parent = card('parent', 'working')
    const child = card('child', 'working', 'parent')
    const cards = [parent, child]

    render(
      <AgentKanbanLineage
        nodes={buildAgentKanbanLineage(cards)}
        cardsByPaneKey={new Map(cards.map((candidate) => [candidate.paneKey, candidate]))}
        repoIconsByRepoId={undefined}
        now={0}
        onOpenTerminal={vi.fn()}
      />
    )

    expect(screen.getByText('child').closest('[data-lineage-depth]')).toHaveAttribute(
      'data-lineage-depth',
      '1'
    )
  })

  it('links a child to a parent in another status column', () => {
    const parent = card('parent', 'working')
    const child = card('child', 'done', 'parent')

    render(
      <AgentKanbanLineage
        nodes={buildAgentKanbanLineage([child])}
        cardsByPaneKey={
          new Map([
            [parent.paneKey, parent],
            [child.paneKey, child]
          ])
        }
        repoIconsByRepoId={undefined}
        now={0}
        onOpenTerminal={vi.fn()}
      />
    )

    expect(screen.getByText('Spawned by parent')).toBeInTheDocument()
  })
})
