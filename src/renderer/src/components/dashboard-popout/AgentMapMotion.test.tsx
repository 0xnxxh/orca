// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, render } from '@testing-library/react'
import { Profiler } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { AgentMap } from './AgentMap'
import { AGENT_MAP_EXIT_DURATION_MS } from './useAgentMapMotionLayout'

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
    conversationName: 'Agent alpha',
    startedAt: NOW - 60_000,
    finishedAt: null,
    stateChangedAt: NOW - 1_000,
    unseen: false,
    hostKind: 'local',
    workspaceKind: 'worktree',
    ...overrides
  }
}

describe('Agent Map motion lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    )
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      toJSON: () => ({})
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not restart an exit deadline for metadata-only layout updates', async () => {
    const first = card()
    const removed = card({ paneKey: 'pane-2', conversationName: 'Agent beta' })
    const view = render(<AgentMap cards={[first, removed]} now={NOW} onOpenTerminal={vi.fn()} />)

    vi.useFakeTimers()
    view.rerender(<AgentMap cards={[first]} now={NOW} onOpenTerminal={vi.fn()} />)
    await act(async () => {
      vi.advanceTimersByTime(AGENT_MAP_EXIT_DURATION_MS - 10)
    })
    view.rerender(<AgentMap cards={[first]} now={NOW + 30_000} onOpenTerminal={vi.fn()} />)
    await act(async () => {
      vi.advanceTimersByTime(10)
    })

    expect(view.container.querySelector('[aria-label^="Agent beta,"]')).not.toBeInTheDocument()
  })

  it('commits a metadata-only layout update once', () => {
    let commitCount = 0
    const view = render(
      <Profiler id="agent-map" onRender={() => (commitCount += 1)}>
        <AgentMap cards={[card()]} now={NOW} onOpenTerminal={vi.fn()} />
      </Profiler>
    )
    commitCount = 0

    view.rerender(
      <Profiler id="agent-map" onRender={() => (commitCount += 1)}>
        <AgentMap cards={[card()]} now={NOW + 30_000} onOpenTerminal={vi.fn()} />
      </Profiler>
    )

    expect(commitCount).toBe(1)
  })

  it('makes descendants non-interactive while their project exits', () => {
    const first = card()
    const removed = card({
      paneKey: 'pane-2',
      repoId: 'repo-2',
      repoName: 'Removed project',
      worktreeId: 'worktree-2',
      worktreeName: 'Removed branch',
      conversationName: 'Agent beta'
    })
    const view = render(<AgentMap cards={[first, removed]} now={NOW} onOpenTerminal={vi.fn()} />)

    vi.useFakeTimers()
    view.rerender(<AgentMap cards={[first]} now={NOW} onOpenTerminal={vi.fn()} />)
    const exitingProject = view.container.querySelector('.agent-map-project-node.is-exiting')
    const exitingAgent = exitingProject?.querySelector('[data-agent-map-agent]')

    expect(exitingProject).toHaveAttribute('aria-hidden', 'true')
    expect(exitingAgent).toHaveAttribute('tabindex', '-1')
    expect(exitingAgent).toHaveAttribute('aria-hidden', 'true')
  })
})
