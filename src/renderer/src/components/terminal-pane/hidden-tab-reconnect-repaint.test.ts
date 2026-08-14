/**
 * A reconnect repaint must survive until a hidden tab is revealed.
 *
 * Reported after an SSH disconnect/reconnect with splits open across several tabs: the panes on
 * the tab that was NOT active come back blank, and stay blank when the user switches to that tab,
 * until a split resize or a sidebar toggle. The reconnect repaint reaches every live manager, but
 * for a tab-hidden one it lands on display:none panes — `safeFit` refuses them (no measurable box)
 * and the refresh has no presented frame to update. The reveal then takes the light tab path,
 * which deliberately does not fit, so nothing ever reflows the grid the reattach left diverged or
 * releases the reattach grid push parked on a measurable fit.
 *
 * Real registry, real deferral, real resume: only the manager is faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import {
  refitAndRefreshAllTerminalPanes,
  registerLivePaneManager,
  unregisterLivePaneManager
} from '@/lib/pane-manager/pane-manager-registry'
import { resumeTerminalVisibility } from './terminal-visibility-resume'

vi.mock('@/lib/pane-manager/pane-terminal-output-scheduler', () => ({
  flushTerminalOutput: vi.fn(),
  requestTerminalBacklogRecovery: vi.fn()
}))
vi.mock('@/lib/pane-manager/terminal-scroll-intent', () => ({
  enforceTerminalCurrentScrollIntent: vi.fn(),
  syncTerminalScrollIntentFromViewport: vi.fn()
}))
vi.mock('@/lib/pane-manager/terminal-linkifier-hover-reset', () => ({
  resetTerminalLinkifierHoverState: vi.fn(),
  isTerminalLinkifierHoverActive: vi.fn(() => false)
}))
vi.mock('@/lib/pane-manager/terminal-canvas-dpr-repair', () => ({
  repairPaneWebglCanvasDprMismatch: vi.fn(() => false)
}))
// Kept false so the deferred repaint is the only thing that can trigger the reveal fit.
vi.mock('@/lib/pane-manager/pane-fit', () => ({
  flushDeferredPaneMetricOptionsIfMeasurable: vi.fn(() => false)
}))
vi.mock('./pane-helpers', () => ({
  fitAndFocusPanes: vi.fn(),
  fitPanes: vi.fn(),
  focusActivePane: vi.fn()
}))
vi.mock('./terminal-webgl-atlas-recovery', () => ({
  scheduleTabRevealWebglAtlasRecovery: vi.fn()
}))

function createHiddenTabManager(): {
  manager: PaneManager
  visible: { current: boolean }
  fitAllRevealedPanes: ReturnType<typeof vi.fn>
  scheduleRevealRepaint: ReturnType<typeof vi.fn>
} {
  const visible = { current: false }
  const fitAllRevealedPanes = vi.fn()
  const scheduleRevealRepaint = vi.fn()
  const manager = {
    getPanes: vi.fn(() => []),
    resetWebglTextureAtlases: vi.fn(),
    fitAllPanes: vi.fn(),
    fitAllRevealedPanes,
    refreshAllPanes: vi.fn(),
    scheduleRevealRepaint,
    scheduleRevealPresent: vi.fn(),
    resumeRendering: vi.fn(),
    isVisibleForAtlasRecovery: () => visible.current
  }
  return {
    manager: manager as never as PaneManager,
    visible,
    fitAllRevealedPanes,
    scheduleRevealRepaint
  }
}

function revealTab(manager: PaneManager): void {
  resumeTerminalVisibility({
    manager,
    isActive: true,
    wasVisible: false,
    // The intra-worktree tab switch: the tab was hidden, its worktree never was.
    shouldUseLightTabResume: true,
    captureViewportPositions: vi.fn(() => new Map()),
    withSuppressedScrollTracking: (callback: () => void) => callback()
  })
}

describe('revealing a tab that was hidden during an SSH reconnect', () => {
  const registered: object[] = []

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    for (const manager of registered.splice(0)) {
      unregisterLivePaneManager(manager as never)
    }
  })

  it('repaints on reveal, because the reconnect repaint could not land while the tab was hidden', () => {
    const { manager, visible, fitAllRevealedPanes, scheduleRevealRepaint } =
      createHiddenTabManager()
    registerLivePaneManager(manager as never)
    registered.push(manager)

    // Reconnect finalizes while this tab is in the background.
    refitAndRefreshAllTerminalPanes()
    expect(fitAllRevealedPanes, 'a hidden pane has no box to fit').not.toHaveBeenCalled()

    // The user switches to the tab.
    visible.current = true
    revealTab(manager)

    expect(
      fitAllRevealedPanes,
      'the reveal never repaired the grid, so the panes stay blank until a resize'
    ).toHaveBeenCalledTimes(1)
    expect(scheduleRevealRepaint).toHaveBeenCalledTimes(1)
  })

  it('replays the parked repaint once, not on every later tab switch', () => {
    const { manager, visible, fitAllRevealedPanes } = createHiddenTabManager()
    registerLivePaneManager(manager as never)
    registered.push(manager)

    refitAndRefreshAllTerminalPanes()
    visible.current = true
    revealTab(manager)
    revealTab(manager)

    expect(fitAllRevealedPanes).toHaveBeenCalledTimes(1)
  })

  it('leaves an ordinary tab switch fitless, keeping the light path off the overlay geometry race', () => {
    const { manager, visible, fitAllRevealedPanes, scheduleRevealRepaint } =
      createHiddenTabManager()
    registerLivePaneManager(manager as never)
    registered.push(manager)
    // No reconnect repaint arrived while this tab was hidden.

    visible.current = true
    revealTab(manager)

    expect(fitAllRevealedPanes).not.toHaveBeenCalled()
    expect(scheduleRevealRepaint).toHaveBeenCalledTimes(1)
  })
})
