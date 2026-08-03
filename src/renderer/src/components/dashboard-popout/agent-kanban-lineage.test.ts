import { describe, expect, it } from 'vitest'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { buildAgentKanbanLineage } from './agent-kanban-lineage'

function card(paneKey: string, parentPaneKey?: string): DashboardCard {
  return {
    paneKey,
    parentPaneKey,
    ptyId: null,
    agentType: 'codex',
    bucket: 'working',
    dotState: 'working',
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

describe('buildAgentKanbanLineage', () => {
  it('nests descendants under their visible parent in card order', () => {
    const roots = buildAgentKanbanLineage([
      card('parent'),
      card('child-b', 'parent'),
      card('child-a', 'parent'),
      card('grandchild', 'child-a'),
      card('peer')
    ])

    expect(roots.map((node) => node.card.paneKey)).toEqual(['parent', 'peer'])
    expect(roots[0]?.children.map((node) => node.card.paneKey)).toEqual(['child-b', 'child-a'])
    expect(roots[0]?.children[1]?.children[0]?.card.paneKey).toBe('grandchild')
  })

  it('keeps children with absent parents as roots', () => {
    expect(buildAgentKanbanLineage([card('child', 'hidden-parent')])[0]?.card.paneKey).toBe('child')
  })

  it('keeps cyclic lineage visible', () => {
    const roots = buildAgentKanbanLineage([card('a', 'b'), card('b', 'a')])
    expect(roots.map((node) => node.card.paneKey)).toEqual(['a', 'b'])
  })
})
