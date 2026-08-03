import { describe, expect, it, vi } from 'vitest'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import {
  deriveAgentMapLayout,
  AGENT_MAP_AGENT_RADIUS,
  AGENT_MAP_WORKTREE_GAP,
  agentMapDurationMinutes,
  agentMapNodeStatus,
  updateAgentMapLayout
} from './agent-map-layout'
import type * as WorktreePackingModule from './agent-map-worktree-packing'

const packWorktrees = vi.hoisted(() => vi.fn())
vi.mock('./agent-map-worktree-packing', async (importOriginal) => {
  const actual = await importOriginal<typeof WorktreePackingModule>()
  return {
    ...actual,
    packAgentMapWorktrees: (...args: Parameters<typeof actual.packAgentMapWorktrees>) => {
      packWorktrees()
      return actual.packAgentMapWorktrees(...args)
    }
  }
})

const NOW = 2_000_000_000

function card(overrides: Partial<DashboardCard> = {}): DashboardCard {
  return {
    paneKey: 'pane-1',
    ptyId: 'pty-1',
    agentType: 'codex',
    bucket: 'working',
    dotState: 'working',
    task: 'Build map',
    repoId: 'repo-1',
    worktreeId: 'worktree-1',
    tabId: 'tab-1',
    leafId: 'leaf-1',
    repoName: 'Orca',
    worktreeName: 'Agent map',
    startedAt: NOW - 10 * 60_000,
    finishedAt: null,
    stateChangedAt: NOW - 1_000,
    unseen: false,
    ...overrides
  }
}

describe('agent map layout', () => {
  it('derives project containment, workspace containment, and every agent node', () => {
    const cards = [
      card({ paneKey: 'a', repoId: 'repo-a', worktreeId: 'wt-a' }),
      card({ paneKey: 'b', repoId: 'repo-a', worktreeId: 'wt-a' }),
      card({ paneKey: 'c', repoId: 'repo-a', worktreeId: 'wt-b' }),
      card({
        paneKey: 'd',
        repoId: 'repo-b',
        repoName: 'Mobile',
        worktreeId: 'wt-c'
      })
    ]
    const layout = deriveAgentMapLayout(cards, NOW)

    expect(layout.projects.map((project) => project.id)).toEqual(['repo-a', 'repo-b'])
    expect(layout.projects[0].worktrees.map((worktree) => worktree.worktreeId)).toEqual([
      'wt-a',
      'wt-b'
    ])
    expect(
      layout.projects.flatMap((project) =>
        project.worktrees.flatMap((worktree) => worktree.agents.map((agent) => agent.card.paneKey))
      )
    ).toEqual(['a', 'b', 'c', 'd'])

    for (const project of layout.projects) {
      for (const worktree of project.worktrees) {
        expect(
          Math.hypot(worktree.x - project.x, worktree.y - project.y) + worktree.radius
        ).toBeLessThan(project.radius)
        for (const agent of worktree.agents) {
          expect(
            Math.hypot(agent.x - worktree.x, agent.y - worktree.y) + agent.radius
          ).toBeLessThan(worktree.radius)
        }
      }
    }
  })

  it('keeps exact worktree IDs on different hosts in separate rings', () => {
    const layout = deriveAgentMapLayout(
      [
        card({ paneKey: 'local', executionHostId: 'local' }),
        card({ paneKey: 'remote', executionHostId: 'runtime:env-1' })
      ],
      NOW
    )

    expect(layout.projects[0].worktrees).toHaveLength(2)
    expect(
      layout.projects[0].worktrees.map(({ worktreeId, executionHostId }) => ({
        worktreeId,
        executionHostId
      }))
    ).toEqual(
      expect.arrayContaining([
        { worktreeId: 'worktree-1', executionHostId: 'local' },
        { worktreeId: 'worktree-1', executionHostId: 'runtime:env-1' }
      ])
    )
  })

  it.each([
    ['single', [card()]],
    [
      'sparse',
      [
        card({ paneKey: 'a', repoId: 'repo-a' }),
        card({ paneKey: 'b', repoId: 'repo-b', worktreeId: 'worktree-2' })
      ]
    ]
  ])('centers %s project content within the minimum world', (_, cards) => {
    const layout = deriveAgentMapLayout(cards, NOW)
    const left = Math.min(...layout.projects.map((project) => project.x - project.radius))
    const right = Math.max(...layout.projects.map((project) => project.x + project.radius))
    const top = Math.min(...layout.projects.map((project) => project.y - project.radius))
    const bottom = Math.max(...layout.projects.map((project) => project.y + project.radius))

    expect(layout.width).toBe(900)
    expect(layout.height).toBe(560)
    expect((left + right) / 2).toBeCloseTo(layout.width / 2)
    expect((top + bottom) / 2).toBeCloseTo(layout.height / 2)
  })

  it('places orchestrated descendants beneath their direct parent inside the workspace', () => {
    const layout = deriveAgentMapLayout(
      [
        card({ paneKey: 'parent' }),
        card({ paneKey: 'child-a', parentPaneKey: 'parent' }),
        card({ paneKey: 'child-b', parentPaneKey: 'parent' }),
        card({ paneKey: 'grandchild', parentPaneKey: 'child-a' })
      ],
      NOW
    )
    const worktree = layout.projects[0].worktrees[0]
    const agents = new Map(worktree.agents.map((agent) => [agent.card.paneKey, agent]))
    const parent = agents.get('parent')!
    const childA = agents.get('child-a')!
    const childB = agents.get('child-b')!
    const grandchild = agents.get('grandchild')!

    expect(childA.y).toBeGreaterThan(parent.y)
    expect(childB.y).toBeGreaterThan(parent.y)
    expect(grandchild.y).toBeGreaterThan(childA.y)
    for (const agent of worktree.agents) {
      expect(Math.hypot(agent.x - worktree.x, agent.y - worktree.y) + agent.radius).toBeLessThan(
        worktree.radius
      )
    }
  })

  it('places visible child worktrees beneath their direct parent', () => {
    const layout = deriveAgentMapLayout(
      [
        card({ paneKey: 'parent', worktreeId: 'parent-worktree' }),
        card({
          paneKey: 'child-a',
          worktreeId: 'child-a-worktree',
          parentWorktreeId: 'parent-worktree'
        }),
        card({
          paneKey: 'child-b',
          worktreeId: 'child-b-worktree',
          parentWorktreeId: 'parent-worktree'
        }),
        card({
          paneKey: 'grandchild',
          worktreeId: 'grandchild-worktree',
          parentWorktreeId: 'child-a-worktree'
        })
      ],
      NOW
    )
    const worktrees = new Map(
      layout.projects[0].worktrees.map((worktree) => [worktree.worktreeId, worktree])
    )
    const parent = worktrees.get('parent-worktree')!
    const childA = worktrees.get('child-a-worktree')!
    const childB = worktrees.get('child-b-worktree')!
    const grandchild = worktrees.get('grandchild-worktree')!

    expect(childA.y).toBeGreaterThan(parent.y)
    expect(childB.y).toBeGreaterThan(parent.y)
    expect(grandchild.y).toBeGreaterThan(childA.y)
    for (const [index, worktree] of layout.projects[0].worktrees.entries()) {
      for (const other of layout.projects[0].worktrees.slice(index + 1)) {
        expect(Math.hypot(worktree.x - other.x, worktree.y - other.y)).toBeGreaterThanOrEqual(
          worktree.radius + other.radius + AGENT_MAP_WORKTREE_GAP - 0.001
        )
      }
    }
  })

  it('repacks cached geometry when a worktree parent changes', () => {
    const cards = [
      card({ paneKey: 'parent-a', worktreeId: 'parent-a' }),
      card({ paneKey: 'parent-b', worktreeId: 'parent-b' }),
      card({ paneKey: 'child', worktreeId: 'child', parentWorktreeId: 'parent-a' })
    ]
    const initial = updateAgentMapLayout(null, cards, NOW)
    const updated = updateAgentMapLayout(
      initial.cache,
      cards.map((candidate) =>
        candidate.worktreeId === 'child'
          ? { ...candidate, parentWorktreeId: 'parent-b' }
          : candidate
      ),
      NOW
    )

    expect(updated.cache).not.toBe(initial.cache)
    expect(updated.cache.packingGeneration).toBe(2)
  })

  it('repacks cached geometry when an orchestration parent changes', () => {
    const cards = [
      card({ paneKey: 'parent-a' }),
      card({ paneKey: 'parent-b' }),
      card({ paneKey: 'child', parentPaneKey: 'parent-a' })
    ]
    const initial = updateAgentMapLayout(null, cards, NOW)
    const updated = updateAgentMapLayout(
      initial.cache,
      cards.map((candidate) =>
        candidate.paneKey === 'child' ? { ...candidate, parentPaneKey: 'parent-b' } : candidate
      ),
      NOW
    )

    expect(updated.cache).not.toBe(initial.cache)
    expect(updated.cache.packingGeneration).toBe(2)
    expect(updated.layout.topologyKey).not.toBe(initial.layout.topologyKey)
  })

  it('keeps positions stable across routine status and duration updates', () => {
    const initialCards = [
      card({ paneKey: 'a', worktreeId: 'wt-a' }),
      card({ paneKey: 'b', worktreeId: 'wt-a', startedAt: NOW - 2 * 60_000 }),
      card({ paneKey: 'c', worktreeId: 'wt-b' })
    ]
    const initial = deriveAgentMapLayout(initialCards, NOW)
    const updated = deriveAgentMapLayout(
      [
        { ...initialCards[0], bucket: 'attention', dotState: 'waiting' },
        { ...initialCards[1], startedAt: NOW - 45 * 60_000 },
        initialCards[2]
      ],
      NOW
    )
    const initialAgents = initial.projects[0].worktrees[0].agents
    const updatedAgents = updated.projects[0].worktrees[0].agents
    const initialWorktrees = initial.projects[0].worktrees
    const updatedWorktrees = updated.projects[0].worktrees

    expect(updated.topologyKey).toBe(initial.topologyKey)
    expect(updatedWorktrees.map(({ x, y }) => ({ x, y }))).toEqual(
      initialWorktrees.map(({ x, y }) => ({ x, y }))
    )
    expect(updatedAgents.map(({ x, y }) => ({ x, y }))).toEqual(
      initialAgents.map(({ x, y }) => ({ x, y }))
    )
    expect(updatedAgents[1].radius).toBe(initialAgents[1].radius)
  })

  it('reuses packed geometry while refreshing live card metadata', () => {
    const initialCards = [
      card({ paneKey: 'a', worktreeId: 'wt-a' }),
      card({ paneKey: 'b', worktreeId: 'wt-b' })
    ]
    const initial = updateAgentMapLayout(null, initialCards, NOW)
    packWorktrees.mockClear()
    const updatedCards = [
      { ...initialCards[0], dotState: 'waiting' as const, worktreeName: 'Renamed' },
      { ...initialCards[1], startedAt: NOW - 60 * 60_000 }
    ]
    const updated = updateAgentMapLayout(initial.cache, updatedCards, NOW + 60_000)

    expect(updated.cache).toBe(initial.cache)
    expect(packWorktrees).not.toHaveBeenCalled()
    expect(initial.cache.geometry).toBe(initial.layout)
    expect(updated.cache.packingGeneration).toBe(1)
    expect(updated.layout.projects[0].worktrees[0].name).toBe('Renamed')
    expect(updated.layout.projects[0].worktrees[0].statusCounts.waiting).toBe(1)
    expect(updated.layout.projects[0].worktrees[1].agents[0].durationMinutes).toBe(61)

    const topologyChanged = updateAgentMapLayout(
      updated.cache,
      [...updatedCards, card({ paneKey: 'c', worktreeId: 'wt-c' })],
      NOW
    )
    expect(topologyChanged.cache).not.toBe(updated.cache)
    expect(packWorktrees).toHaveBeenCalled()
    expect(topologyChanged.cache.packingGeneration).toBe(2)
  })

  it('packs worktree rings tightly without a square grid', () => {
    const layout = deriveAgentMapLayout(
      Array.from({ length: 36 }, (_, index) =>
        card({
          paneKey: `agent-${index}`,
          worktreeId: `worktree-${index.toString().padStart(2, '0')}`
        })
      ),
      NOW
    )
    const project = layout.projects[0]

    expect(project.radius).toBeLessThan(700)
    expect(
      new Set(project.worktrees.map((worktree) => worktree.x.toFixed(3))).size
    ).toBeGreaterThan(12)
    expect(
      new Set(project.worktrees.map((worktree) => worktree.y.toFixed(3))).size
    ).toBeGreaterThan(12)
    for (const [index, worktree] of project.worktrees.entries()) {
      for (const other of project.worktrees.slice(index + 1)) {
        expect(Math.hypot(worktree.x - other.x, worktree.y - other.y)).toBeGreaterThanOrEqual(
          worktree.radius + other.radius + AGENT_MAP_WORKTREE_GAP - 0.001
        )
      }
    }
  })

  it('uses one agent size while retaining elapsed duration', () => {
    const finished = card({
      startedAt: NOW - 30 * 60_000,
      finishedAt: NOW - 20 * 60_000
    })
    const layout = deriveAgentMapLayout(
      [
        card({ paneKey: 'just-started', startedAt: NOW }),
        card({ paneKey: 'long-running', startedAt: NOW - 24 * 60 * 60_000 })
      ],
      NOW
    )

    expect(layout.projects[0].worktrees[0].agents.map((agent) => agent.radius)).toEqual([
      AGENT_MAP_AGENT_RADIUS,
      AGENT_MAP_AGENT_RADIUS
    ])
    expect(agentMapDurationMinutes(finished, NOW)).toBe(10)
  })

  it('maps acknowledged completions to idle independently from elapsed time', () => {
    for (const dotState of ['working', 'blocked', 'waiting', 'idle'] as const) {
      expect(agentMapNodeStatus(card({ dotState }))).toBe(dotState)
    }
    expect(agentMapNodeStatus(card({ dotState: 'done', unseen: true }))).toBe('done')
    expect(agentMapNodeStatus(card({ dotState: 'done', unseen: false }))).toBe('idle')
    const shortBlocked = card({ dotState: 'blocked', startedAt: NOW - 60_000 })
    const longBlocked = card({ dotState: 'blocked', startedAt: NOW - 45 * 60_000 })
    expect(agentMapNodeStatus(shortBlocked)).toBe(agentMapNodeStatus(longBlocked))
  })

  it('marks only operationally quiet workspaces for semantic aggregation', () => {
    const quiet = deriveAgentMapLayout(
      Array.from({ length: 5 }, (_, index) =>
        card({ paneKey: `quiet-${index}`, dotState: index === 0 ? 'done' : 'idle' })
      ),
      NOW
    )
    const active = deriveAgentMapLayout([card({ paneKey: 'active', dotState: 'working' })], NOW)
    const unseenDone = deriveAgentMapLayout(
      Array.from({ length: 5 }, (_, index) =>
        card({ paneKey: `done-${index}`, dotState: 'done', unseen: true })
      ),
      NOW
    )

    expect(quiet.projects[0].worktrees[0].quiet).toBe(true)
    expect(active.projects[0].worktrees[0].quiet).toBe(false)
    expect(unseenDone.projects[0].worktrees[0].quiet).toBe(false)
  })

  it('places hundreds of agents in one workspace without overlap', () => {
    const layout = deriveAgentMapLayout(
      Array.from({ length: 400 }, (_, index) => card({ paneKey: `agent-${index}` })),
      NOW
    )
    const worktree = layout.projects[0].worktrees[0]

    expect(worktree.agents).toHaveLength(400)
    let minimumDistance = Number.POSITIVE_INFINITY
    for (const [index, agent] of worktree.agents.entries()) {
      expect(Math.hypot(agent.x - worktree.x, agent.y - worktree.y) + agent.radius).toBeLessThan(
        worktree.radius
      )
      for (const other of worktree.agents.slice(index + 1)) {
        minimumDistance = Math.min(
          minimumDistance,
          Math.hypot(agent.x - other.x, agent.y - other.y)
        )
      }
    }
    expect(minimumDistance).toBeGreaterThanOrEqual(AGENT_MAP_AGENT_RADIUS * 2)
  })
})
