import { describe, expect, it } from 'vitest'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import {
  deriveFleetRingsLayout,
  FLEET_AGENT_RADIUS,
  FLEET_WORKTREE_GAP,
  fleetAgentDurationMinutes,
  fleetNodeStatus,
  updateFleetRingsLayout
} from './fleet-rings-layout'

const NOW = 2_000_000_000

function card(overrides: Partial<DashboardCard> = {}): DashboardCard {
  return {
    paneKey: 'pane-1',
    ptyId: 'pty-1',
    agentType: 'codex',
    bucket: 'working',
    dotState: 'working',
    task: 'Build rings',
    repoId: 'repo-1',
    worktreeId: 'worktree-1',
    tabId: 'tab-1',
    leafId: 'leaf-1',
    repoName: 'Orca',
    worktreeName: 'Fleet rings',
    startedAt: NOW - 10 * 60_000,
    finishedAt: null,
    stateChangedAt: NOW - 1_000,
    unseen: false,
    ...overrides
  }
}

describe('fleet rings layout', () => {
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
    const layout = deriveFleetRingsLayout(cards, NOW)

    expect(layout.projects.map((project) => project.id)).toEqual(['repo-a', 'repo-b'])
    expect(layout.projects[0].worktrees.map((worktree) => worktree.id)).toEqual(['wt-a', 'wt-b'])
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

  it('places orchestrated descendants beneath their direct parent inside the workspace', () => {
    const layout = deriveFleetRingsLayout(
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

  it('repacks cached geometry when an orchestration parent changes', () => {
    const cards = [
      card({ paneKey: 'parent-a' }),
      card({ paneKey: 'parent-b' }),
      card({ paneKey: 'child', parentPaneKey: 'parent-a' })
    ]
    const initial = updateFleetRingsLayout(null, cards, NOW)
    const updated = updateFleetRingsLayout(
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
    const initial = deriveFleetRingsLayout(initialCards, NOW)
    const updated = deriveFleetRingsLayout(
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
    const initial = updateFleetRingsLayout(null, initialCards, NOW)
    const updatedCards = [
      { ...initialCards[0], dotState: 'waiting' as const, worktreeName: 'Renamed' },
      { ...initialCards[1], startedAt: NOW - 60 * 60_000 }
    ]
    const updated = updateFleetRingsLayout(initial.cache, updatedCards, NOW + 60_000)

    expect(updated.cache).toBe(initial.cache)
    expect(updated.cache.packingGeneration).toBe(1)
    expect(updated.layout.projects[0].worktrees[0].name).toBe('Renamed')
    expect(updated.layout.projects[0].worktrees[0].statusCounts.waiting).toBe(1)
    expect(updated.layout.projects[0].worktrees[1].agents[0].durationMinutes).toBe(61)

    const topologyChanged = updateFleetRingsLayout(
      updated.cache,
      [...updatedCards, card({ paneKey: 'c', worktreeId: 'wt-c' })],
      NOW
    )
    expect(topologyChanged.cache).not.toBe(updated.cache)
    expect(topologyChanged.cache.packingGeneration).toBe(2)
  })

  it('packs worktree rings tightly without a square grid', () => {
    const layout = deriveFleetRingsLayout(
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
          worktree.radius + other.radius + FLEET_WORKTREE_GAP - 0.001
        )
      }
    }
  })

  it('uses one agent size while retaining elapsed duration', () => {
    const finished = card({
      startedAt: NOW - 30 * 60_000,
      finishedAt: NOW - 20 * 60_000
    })
    const layout = deriveFleetRingsLayout(
      [
        card({ paneKey: 'just-started', startedAt: NOW }),
        card({ paneKey: 'long-running', startedAt: NOW - 24 * 60 * 60_000 })
      ],
      NOW
    )

    expect(layout.projects[0].worktrees[0].agents.map((agent) => agent.radius)).toEqual([
      FLEET_AGENT_RADIUS,
      FLEET_AGENT_RADIUS
    ])
    expect(fleetAgentDurationMinutes(finished, NOW)).toBe(10)
  })

  it('maps the precise Orca status independently from elapsed time', () => {
    for (const dotState of ['working', 'blocked', 'waiting', 'done', 'idle'] as const) {
      expect(fleetNodeStatus(card({ dotState }))).toBe(dotState)
    }
    const shortBlocked = card({ dotState: 'blocked', startedAt: NOW - 60_000 })
    const longBlocked = card({ dotState: 'blocked', startedAt: NOW - 45 * 60_000 })
    expect(fleetNodeStatus(shortBlocked)).toBe(fleetNodeStatus(longBlocked))
  })

  it('marks only operationally quiet workspaces for semantic aggregation', () => {
    const quiet = deriveFleetRingsLayout(
      Array.from({ length: 5 }, (_, index) =>
        card({ paneKey: `quiet-${index}`, dotState: index === 0 ? 'done' : 'idle' })
      ),
      NOW
    )
    const active = deriveFleetRingsLayout([card({ paneKey: 'active', dotState: 'working' })], NOW)

    expect(quiet.projects[0].worktrees[0].quiet).toBe(true)
    expect(active.projects[0].worktrees[0].quiet).toBe(false)
  })

  it('places hundreds of agents in one workspace without overlap', () => {
    const layout = deriveFleetRingsLayout(
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
    expect(minimumDistance).toBeGreaterThanOrEqual(FLEET_AGENT_RADIUS * 2)
  })
})
