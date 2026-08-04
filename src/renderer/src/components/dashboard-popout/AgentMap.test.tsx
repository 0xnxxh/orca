// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DashboardCard,
  DashboardSleepWorkspaceArgs,
  DashboardSpawnAgentArgs
} from '../../../../shared/dashboard-snapshot'
import type { TuiAgent } from '../../../../shared/types'
import { AgentMap } from './AgentMap'
import type { AgentMapState } from './agent-map-filter'
import { AGENT_MAP_AGENT_RADIUS } from './agent-map-layout'

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
    startedAt: NOW - 10 * 60_000,
    finishedAt: null,
    stateChangedAt: NOW - 1_000,
    unseen: false,
    hostKind: 'local',
    workspaceKind: 'worktree',
    ...overrides
  }
}

function renderMap(
  cards: DashboardCard[],
  {
    onOpenTerminal = vi.fn(),
    selectedPaneKey = null,
    compact = false,
    workspaceContextMenusEnabled = false,
    enabledStates,
    launchableAgentsByWorktreeId,
    onSpawnAgent,
    onSleepWorkspace
  }: {
    onOpenTerminal?: (card: DashboardCard, side: 'left' | 'right') => void
    selectedPaneKey?: string | null
    compact?: boolean
    workspaceContextMenusEnabled?: boolean
    enabledStates?: ReadonlySet<AgentMapState>
    launchableAgentsByWorktreeId?: Record<string, TuiAgent[]>
    onSpawnAgent?: (args: DashboardSpawnAgentArgs) => void
    onSleepWorkspace?: (args: DashboardSleepWorkspaceArgs) => void
  } = {}
): ReturnType<typeof render> {
  return render(
    <AgentMap
      cards={cards}
      now={NOW}
      onOpenTerminal={onOpenTerminal}
      selectedPaneKey={selectedPaneKey}
      compact={compact}
      workspaceContextMenusEnabled={workspaceContextMenusEnabled}
      enabledStates={enabledStates}
      launchableAgentsByWorktreeId={launchableAgentsByWorktreeId}
      onSpawnAgent={onSpawnAgent}
      onSleepWorkspace={onSleepWorkspace}
    />
  )
}

describe('AgentMap', () => {
  const originalUserAgent = navigator.userAgent
  let boundsSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Linux' })
    boundsSpy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function getBounds(this: Element) {
        if (this.classList.contains('agent-map-canvas') || this instanceof SVGSVGElement) {
          return {
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            right: 400,
            bottom: 300,
            width: 400,
            height: 300,
            toJSON: () => ({})
          }
        }
        return {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
          toJSON: () => ({})
        }
      })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    boundsSpy.mockRestore()
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: originalUserAgent
    })
  })

  it('renders the fixed amber marker only for unread agents', () => {
    const finished = card({
      paneKey: 'done',
      conversationName: 'Finished agent',
      bucket: 'done',
      dotState: 'done',
      finishedAt: NOW - 60_000,
      unseen: true
    })
    renderMap([card(), finished])

    const workingNode = screen.getByRole('button', { name: /Agent alpha/ })
    const doneNode = screen.getByRole('button', { name: /Finished agent/ })
    expect(workingNode).toHaveClass('fleet-status-working')
    expect(doneNode).toHaveClass('fleet-status-done')
    expect(workingNode.querySelector('.agent-map-agent-icon svg')).toBeInTheDocument()
    expect(workingNode.querySelector('[data-agent-unread-marker]')).not.toBeInTheDocument()
    expect(doneNode.querySelector('.agent-map-agent-icon svg')).toBeInTheDocument()
    const unreadMarker = doneNode.querySelector('[data-agent-unread-marker]')
    expect(unreadMarker).toHaveClass('agent-map-agent-unread-mark')
    // On the ring circumference at the top-left diagonal, where the halo breaks the ring.
    const onRing = String(-AGENT_MAP_AGENT_RADIUS * Math.SQRT1_2)
    expect(unreadMarker).toHaveAttribute('cx', onRing)
    expect(unreadMarker).toHaveAttribute('cy', onRing)
    expect(unreadMarker).toHaveAttribute('r', '4.5')
    expect(doneNode).toHaveAccessibleName(/unread/)
  })

  it('shows worktree details and opens a running agent', () => {
    const onOpenTerminal = vi.fn()
    const running = card()
    renderMap([running], { onOpenTerminal })
    const ring = screen.getByRole('button', { name: 'Open Agent map worktree details' })
    fireEvent.click(ring)

    expect(ring).toHaveClass('is-open')
    expect(screen.queryByRole('button', { name: 'Focus ring' })).not.toBeInTheDocument()
    // The popover names the project; the map itself draws it uppercased.
    expect(screen.getByText('Orca')).toBeInTheDocument()
    expect(screen.getByText('1 agent · 1 active · 0 done')).toBeInTheDocument()
    expect(screen.getByText('Agent alpha')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /Agent alpha/ })[1])
    expect(onOpenTerminal).toHaveBeenCalledWith(running, 'right')
    expect(ring).not.toHaveClass('is-open')
  })

  it('starts a new agent from the worktree details picker', () => {
    const onSpawnAgent = vi.fn()
    renderMap([card()], {
      onSpawnAgent,
      launchableAgentsByWorktreeId: { 'worktree-1': ['claude', 'codex'] }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open Agent map worktree details' }))

    expect(screen.getByText('Start a new agent')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Codex/ }))

    // The raw worktree id, not the host-qualified map identity.
    expect(onSpawnAgent).toHaveBeenCalledWith({ worktreeId: 'worktree-1', agent: 'codex' })
  })

  it('explains an empty picker rather than offering nothing', () => {
    renderMap([card()], { onSpawnAgent: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: 'Open Agent map worktree details' }))

    expect(screen.getByText('No enabled agents detected.')).toBeInTheDocument()
  })

  it('offers sleep and launch on right-click where the store menu is unavailable', async () => {
    const onSleepWorkspace = vi.fn()
    renderMap([card()], {
      onSleepWorkspace,
      onSpawnAgent: vi.fn(),
      launchableAgentsByWorktreeId: { 'worktree-1': ['claude'] }
    })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open Agent map worktree details' }), {
      clientX: 10,
      clientY: 10
    })

    expect(await screen.findByText('Start a new agent')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Sleep'))
    expect(onSleepWorkspace).toHaveBeenCalledWith({ worktreeId: 'worktree-1' })
  })

  it('toggles worktree details from the keyboard', () => {
    renderMap([card()])
    const ring = screen.getByRole('button', { name: 'Open Agent map worktree details' })

    fireEvent.keyDown(ring, { key: 'Enter' })
    expect(ring).toHaveClass('is-open')
    fireEvent.keyDown(ring, { key: 'Enter' })
    expect(ring).not.toHaveClass('is-open')
  })

  it('labels folder workspaces without presenting them as worktrees', () => {
    renderMap([card({ workspaceKind: 'folder', worktreeName: 'Documentation' })])

    expect(
      screen.getByRole('button', { name: 'Open Documentation folder workspace details' })
    ).toBeInTheDocument()
  })

  it('connects orchestrated workers beneath their visible parent', () => {
    const parent = card({ paneKey: 'parent', conversationName: 'Coordinator' })
    const child = card({
      paneKey: 'child',
      parentPaneKey: 'parent',
      conversationName: 'Worker'
    })
    const orphan = card({
      paneKey: 'orphan',
      parentPaneKey: 'filtered-parent',
      conversationName: 'Orphaned worker'
    })
    const { container } = renderMap([parent, child, orphan])
    const links = container.querySelectorAll('[data-agent-map-lineage-link]')

    expect(screen.getByRole('button', { name: /Coordinator/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Worker/ })).toBeInTheDocument()
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('data-parent-pane-key', 'parent')
    expect(links[0]).toHaveAttribute('data-child-pane-key', 'child')
  })

  it('connects visible child worktrees beneath their parent ring', () => {
    const { container } = renderMap([
      card({ paneKey: 'parent', worktreeId: 'parent-worktree', worktreeName: 'Parent' }),
      card({
        paneKey: 'child',
        worktreeId: 'child-worktree',
        worktreeName: 'Child',
        parentWorktreeId: 'parent-worktree'
      }),
      card({
        paneKey: 'orphan',
        worktreeId: 'orphan-worktree',
        worktreeName: 'Orphan',
        parentWorktreeId: 'filtered-parent'
      })
    ])
    const links = container.querySelectorAll('[data-agent-map-worktree-lineage-link]')

    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('data-parent-worktree-id', 'parent-worktree')
    expect(links[0]).toHaveAttribute('data-child-worktree-id', 'child-worktree')
  })

  it('opens the shared dashboard terminal dialog when an agent is clicked', () => {
    const onOpenTerminal = vi.fn()
    const agent = card()
    renderMap([agent], { onOpenTerminal })

    fireEvent.click(screen.getByRole('button', { name: /Agent alpha/ }))
    expect(onOpenTerminal).toHaveBeenCalledWith(agent, 'right')
  })

  it('keeps a selected node visible while compacting around an adjacent terminal', () => {
    renderMap([card()], { selectedPaneKey: 'pane-1', compact: true })

    expect(screen.getByRole('button', { name: /Agent alpha/ })).toHaveClass('is-selected')
    expect(screen.queryByText('Map filters')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Host filter' })).not.toBeInTheDocument()
  })

  it('keeps the selected node centered when topology changes around it', () => {
    const selected = card()
    const view = renderMap([selected], { selectedPaneKey: selected.paneKey })
    const svg = view.container.querySelector<SVGSVGElement>('.agent-map-canvas > svg')!
    const selectedNode = (): SVGGElement =>
      view.container.querySelector<SVGGElement>('.agent-map-agent-node.is-selected')!
    const nodeCenter = (): [number, number] => {
      const match = selectedNode()
        .getAttribute('transform')
        ?.match(/translate\(([^ ]+) ([^)]+)\)/)
      return [Number(match?.[1]), Number(match?.[2])]
    }
    const viewportCenter = (): [number, number] => {
      const [x, y, width, height] = svg.getAttribute('viewBox')!.split(' ').map(Number)
      return [x + width / 2, y + height / 2]
    }

    const originalNodeCenter = nodeCenter()
    view.rerender(
      <AgentMap
        cards={[
          card({
            paneKey: 'earlier-project',
            repoId: 'repo-0',
            repoName: 'Earlier',
            worktreeId: 'worktree-0'
          }),
          selected
        ]}
        now={NOW}
        onOpenTerminal={vi.fn()}
        selectedPaneKey={selected.paneKey}
      />
    )

    expect(nodeCenter()).not.toEqual(originalNodeCenter)
    expect(viewportCenter()[0]).toBeCloseTo(nodeCenter()[0])
    expect(viewportCenter()[1]).toBeCloseTo(nodeCenter()[1])
  })

  it('increases map label scale when users zoom out', () => {
    const { container } = renderMap([card()])
    const labelGroup = container.querySelector('.agent-map-worktree-label')?.parentElement
    const initialScale = Number(
      labelGroup?.getAttribute('transform')?.match(/scale\(([^)]+)\)/)?.[1]
    )

    const readsBeforeZoom = boundsSpy.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))

    const zoomedScale = Number(
      labelGroup?.getAttribute('transform')?.match(/scale\(([^)]+)\)/)?.[1]
    )
    expect(boundsSpy).toHaveBeenCalledTimes(readsBeforeZoom)
    expect(zoomedScale).toBeGreaterThan(initialScale)
  })

  it('avoids idle pointer layout reads and batches active viewport updates by frame', () => {
    const frames: FrameRequestCallback[] = []
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const { container } = renderMap([card()])
    const svg = container.querySelector<SVGSVGElement>('.agent-map-canvas > svg')!
    Object.assign(svg, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn()
    })

    const readsBeforeHover = boundsSpy.mock.calls.length
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 20, clientY: 20 })
    expect(boundsSpy).toHaveBeenCalledTimes(readsBeforeHover)

    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 20, clientY: 20 })
    expect(svg.setPointerCapture).toHaveBeenCalledWith(1)
    const readsAfterPointerDown = boundsSpy.mock.calls.length
    const initialViewBox = svg.getAttribute('viewBox')
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 30, clientY: 20 })
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 40, clientY: 20 })

    expect(boundsSpy).toHaveBeenCalledTimes(readsAfterPointerDown)
    expect(requestFrame).toHaveBeenCalledOnce()
    expect(svg).toHaveAttribute('viewBox', initialViewBox)

    act(() => frames.shift()?.(0))
    expect(svg.getAttribute('viewBox')).not.toBe(initialViewBox)

    requestFrame.mockClear()
    const readsBeforeWheel = boundsSpy.mock.calls.length
    const wheel = (): void => {
      const event = new Event('wheel', { bubbles: true, cancelable: true })
      Object.defineProperties(event, {
        deltaY: { value: -10 },
        clientX: { value: 100 },
        clientY: { value: 100 }
      })
      fireEvent(svg, event)
      expect(event.defaultPrevented).toBe(true)
    }
    wheel()
    wheel()
    expect(boundsSpy).toHaveBeenCalledTimes(readsBeforeWheel + 1)
    expect(requestFrame).toHaveBeenCalledOnce()
  })

  it('keeps active labels visible and progressively discloses quiet labels', () => {
    const quiet = card({
      paneKey: 'done',
      worktreeId: 'quiet-worktree',
      worktreeName: 'Quiet result',
      conversationName: 'Finished agent',
      bucket: 'done',
      dotState: 'done',
      finishedAt: NOW - 60_000,
      unseen: false
    })
    const { container } = renderMap([card(), quiet])
    const labels = [...container.querySelectorAll('.agent-map-worktree-label')]
    const activeGroup = labels.find((label) => label.textContent === 'Agent map')?.parentElement
    const quietGroup = labels.find((label) => label.textContent === 'Quiet result')?.parentElement

    expect(activeGroup).toHaveClass('is-visible')
    expect(quietGroup).not.toHaveClass('is-visible')
  })

  it('shows unseen completions as Done and acknowledged completions as Idle by default', () => {
    const seenResult = card({
      paneKey: 'seen',
      conversationName: 'Seen result',
      bucket: 'done',
      dotState: 'done',
      finishedAt: NOW - 60_000,
      unseen: false
    })
    const newResult = card({
      paneKey: 'new',
      conversationName: 'New result',
      bucket: 'done',
      dotState: 'done',
      finishedAt: NOW - 2 * 60_000,
      unseen: true
    })
    renderMap([card(), seenResult, newResult])

    expect(screen.getByRole('button', { name: /Agent alpha/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New result/ })).toHaveClass('fleet-status-done')
    expect(screen.getByRole('button', { name: /Seen result/ })).toHaveClass('fleet-status-idle')
  })

  it('hides the states the toolbar filter has muted', () => {
    const done = card({
      paneKey: 'done',
      conversationName: 'Done agent',
      unseen: true,
      bucket: 'done',
      dotState: 'done',
      finishedAt: NOW - 60_000
    })
    renderMap([card(), done], { enabledStates: new Set<AgentMapState>(['done']) })

    expect(screen.queryByRole('button', { name: /Agent alpha/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Done agent/ })).toBeInTheDocument()
  })

  it('preserves the viewport when filters temporarily empty the map', () => {
    const agent = card()
    const all = new Set<AgentMapState>(['attention', 'working', 'done', 'idle'])
    const view = renderMap([agent], { enabledStates: all })
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    const viewBox = view.container
      .querySelector<SVGSVGElement>('.agent-map-canvas > svg')!
      .getAttribute('viewBox')

    const onOpenTerminal = vi.fn()
    view.rerender(
      <AgentMap
        cards={[agent]}
        now={NOW}
        onOpenTerminal={onOpenTerminal}
        enabledStates={new Set<AgentMapState>(['done'])}
      />
    )
    expect(view.container.querySelector('.agent-map-canvas > svg')).not.toBeInTheDocument()
    view.rerender(
      <AgentMap cards={[agent]} now={NOW} onOpenTerminal={onOpenTerminal} enabledStates={all} />
    )

    expect(view.container.querySelector('.agent-map-canvas > svg')).toHaveAttribute(
      'viewBox',
      viewBox
    )
  })

  it('preserves the viewport through an empty source snapshot', () => {
    const agent = card()
    const view = renderMap([agent])
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    const viewBox = view.container
      .querySelector<SVGSVGElement>('.agent-map-canvas > svg')!
      .getAttribute('viewBox')

    view.rerender(<AgentMap cards={[]} now={NOW} onOpenTerminal={vi.fn()} />)
    expect(view.container.querySelector('.agent-map-canvas > svg')).not.toBeInTheDocument()
    view.rerender(<AgentMap cards={[agent]} now={NOW} onOpenTerminal={vi.fn()} />)

    expect(view.container.querySelector('.agent-map-canvas > svg')).toHaveAttribute(
      'viewBox',
      viewBox
    )
  })

  it('aggregates only acknowledged idle results without repacking topology', () => {
    const results = Array.from({ length: 5 }, (_, index) =>
      card({
        paneKey: `done-${index}`,
        conversationName: `Result ${index}`,
        bucket: 'done',
        dotState: 'done',
        finishedAt: NOW - 60_000,
        unseen: true
      })
    )
    const view = renderMap(results)
    const { container } = view

    expect(container.querySelectorAll('[data-agent-map-agent]')).toHaveLength(5)
    expect(container.querySelectorAll('.agent-map-aggregate-node')).toHaveLength(0)
    view.rerender(
      <AgentMap
        cards={results.map((result) => ({ ...result, unseen: false }))}
        now={NOW}
        onOpenTerminal={vi.fn()}
      />
    )
    expect(container.querySelectorAll('[data-agent-map-agent]')).toHaveLength(0)
    expect(container.querySelectorAll('.agent-map-aggregate-node')).toHaveLength(1)

    view.rerender(
      <AgentMap
        cards={results.map((result) => ({ ...result, unseen: false }))}
        now={NOW}
        selectedPaneKey="done-0"
        onOpenTerminal={vi.fn()}
      />
    )
    expect(container.querySelectorAll('[data-agent-map-agent]')).toHaveLength(5)
    expect(container.querySelectorAll('.agent-map-aggregate-node')).toHaveLength(0)
  })
})
