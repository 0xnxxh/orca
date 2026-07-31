// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { AgentFleetRings } from './AgentFleetRings'

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

function renderRings(
  cards: DashboardCard[],
  {
    reviewedPaneKeys = new Set<string>(),
    pinnedPaneKeys = new Set<string>(),
    onMarkReviewed = vi.fn(),
    onOpenTerminal = vi.fn(),
    selectedPaneKey = null,
    compact = false
  }: {
    reviewedPaneKeys?: ReadonlySet<string>
    pinnedPaneKeys?: ReadonlySet<string>
    onMarkReviewed?: (cards: DashboardCard[]) => void
    onOpenTerminal?: (card: DashboardCard, side: 'left' | 'right') => void
    selectedPaneKey?: string | null
    compact?: boolean
  } = {}
): ReturnType<typeof render> {
  return render(
    <AgentFleetRings
      cards={cards}
      now={NOW}
      reviewedPaneKeys={reviewedPaneKeys}
      pinnedPaneKeys={pinnedPaneKeys}
      onMarkReviewed={onMarkReviewed}
      onOpenTerminal={onOpenTerminal}
      selectedPaneKey={selectedPaneKey}
      compact={compact}
    />
  )
}

describe('AgentFleetRings', () => {
  const originalUserAgent = navigator.userAgent
  let boundsSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Linux' })
    boundsSpy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function getBounds(this: Element) {
        if (this.classList.contains('fleet-rings-canvas') || this instanceof SVGSVGElement) {
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

  it('renders separate provider and app-state icons inside status-glow nodes', () => {
    const finished = card({
      paneKey: 'done',
      conversationName: 'Finished agent',
      bucket: 'done',
      dotState: 'done',
      finishedAt: NOW - 60_000,
      unseen: true
    })
    renderRings([card(), finished])

    const workingNode = screen.getByRole('button', { name: /Agent alpha/ })
    const doneNode = screen.getByRole('button', { name: /Finished agent/ })
    expect(workingNode).toHaveClass('fleet-status-working')
    expect(doneNode).toHaveClass('fleet-status-done')
    expect(workingNode.querySelector('.fleet-agent-icon svg')).toBeInTheDocument()
    expect(workingNode.querySelector('[data-agent-spinner]')).toBeInTheDocument()
    expect(doneNode.querySelector('.fleet-agent-icon svg')).toBeInTheDocument()
    expect(doneNode.querySelector('.fleet-agent-state svg')).toBeInTheDocument()
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
    const { container } = renderRings([parent, child, orphan])
    const links = container.querySelectorAll('[data-fleet-agent-lineage-link]')

    expect(screen.getByRole('button', { name: /Coordinator/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Worker/ })).toBeInTheDocument()
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('data-parent-pane-key', 'parent')
    expect(links[0]).toHaveAttribute('data-child-pane-key', 'child')
  })

  it('opens the shared dashboard terminal dialog when an agent is clicked', () => {
    const onOpenTerminal = vi.fn()
    const agent = card()
    renderRings([agent], { onOpenTerminal })

    fireEvent.click(screen.getByRole('button', { name: /Agent alpha/ }))
    expect(onOpenTerminal).toHaveBeenCalledWith(agent, 'right')
  })

  it('keeps a selected node visible while compacting around an adjacent terminal', () => {
    renderRings([card()], { selectedPaneKey: 'pane-1', compact: true })

    expect(screen.getByRole('button', { name: /Agent alpha/ })).toHaveClass('is-selected')
    expect(screen.queryByText('Focus view')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Host filter' })).not.toBeInTheDocument()
  })

  it('increases map label scale when users zoom out', () => {
    const { container } = renderRings([card()])
    const labelGroup = container.querySelector('.fleet-worktree-label')?.parentElement
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
    const { container } = renderRings([card()])
    const svg = container.querySelector<SVGSVGElement>('.fleet-rings-canvas > svg')!
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
      unseen: true
    })
    const { container } = renderRings([card(), quiet])
    const labels = [...container.querySelectorAll('.fleet-worktree-label')]
    const activeGroup = labels.find((label) => label.textContent === 'Fleet rings')?.parentElement
    const quietGroup = labels.find((label) => label.textContent === 'Quiet result')?.parentElement

    expect(activeGroup).toHaveClass('is-visible')
    expect(quietGroup).not.toHaveClass('is-visible')
  })

  it('defaults to active agents and finished results that still need review', () => {
    const recentReviewed = card({
      paneKey: 'reviewed',
      conversationName: 'Reviewed result',
      bucket: 'done',
      dotState: 'done',
      finishedAt: NOW - 60_000
    })
    const newResult = card({
      paneKey: 'new',
      conversationName: 'New result',
      bucket: 'done',
      dotState: 'done',
      finishedAt: NOW - 2 * 60_000,
      unseen: true
    })
    renderRings([card(), recentReviewed, newResult], {
      reviewedPaneKeys: new Set(['reviewed'])
    })

    expect(screen.getByRole('button', { name: /Agent alpha/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New result/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reviewed result/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Last 24 hours/ }))
    expect(screen.getByRole('button', { name: /Reviewed result/ })).toBeInTheDocument()
  })

  it('lets users hide states and projects independently', () => {
    renderRings([
      card(),
      card({
        paneKey: 'other',
        conversationName: 'Other project',
        repoId: 'repo-2',
        repoName: 'Mobile'
      })
    ])

    fireEvent.click(screen.getByRole('button', { name: /^Working/ }))
    expect(screen.queryByRole('button', { name: /Agent alpha/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Working/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Mobile/ }))
    expect(screen.getByRole('button', { name: /Agent alpha/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Other project/ })).not.toBeInTheDocument()
  })

  it('bulk-reviews only visible unreviewed results', () => {
    const onMarkReviewed = vi.fn()
    const result = card({
      paneKey: 'done',
      conversationName: 'Finished agent',
      bucket: 'done',
      dotState: 'done',
      finishedAt: NOW - 60_000,
      unseen: true
    })
    renderRings([card(), result], { onMarkReviewed })

    fireEvent.click(screen.getByRole('button', { name: 'Mark visible results reviewed' }))
    expect(onMarkReviewed).toHaveBeenCalledWith([result])
  })

  it('keeps exact review nodes visible and aggregates quiet history only in broad scopes', () => {
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
    const { container } = renderRings(results)

    expect(container.querySelectorAll('[data-fleet-agent]')).toHaveLength(5)
    expect(container.querySelectorAll('.fleet-aggregate-node')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /^All finished/ }))
    expect(container.querySelectorAll('[data-fleet-agent]')).toHaveLength(0)
    expect(container.querySelectorAll('.fleet-aggregate-node')).toHaveLength(1)
  })
})
