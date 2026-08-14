// @vitest-environment happy-dom
/**
 * The reconnect repaint is wired to the real registry, and it really repaints.
 *
 * direct-ssh-reconnect-repaint.test.ts asserts the same behavior against a hand-written copy
 * of the finalize hook and a mocked registry: delete the scheduling from useIpcEvents and it
 * stays green. This test takes the callback useIpcEvents actually hands the reconnect
 * coordinator, runs it against a live PaneManager holding real xterm panes, and asserts the
 * panes come back PAINTED — the reported symptom was blank terminals after a hosts-popup
 * disconnect/reconnect, with the buffers intact the whole time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DirectSshReconnectCoordinatorDeps } from './direct-ssh-reconnect-coordinator-types'
import { createHarnessStoreState, loadIpcEventsHarness } from './ipc-events-test-harness'
// Type-only: the fixture is imported dynamically below, after the module registry reset.
import type * as PaintedPaneFixtureModule from '@/lib/pane-manager/painted-pane-fixture'

type PaintedPaneFixture = typeof PaintedPaneFixtureModule

const capturedDeps: DirectSshReconnectCoordinatorDeps[] = []

vi.mock('./direct-ssh-reconnect-coordinator', () => ({
  createDirectSshReconnectCoordinator: (deps: DirectSshReconnectCoordinatorDeps) => {
    capturedDeps.push(deps)
    // Every coordinator method is a no-op here: this test exercises the callback useIpcEvents
    // supplied, not the reconnect state machine (covered by the coordinator's own tests).
    return new Proxy({} as Record<string, unknown>, { get: () => vi.fn() })
  }
}))

const AUTHORITY = { targetId: 'target-1', host: 'example.test', user: 'orca', port: 22 }

let fixture: PaintedPaneFixture | null = null

afterEach(() => {
  fixture?.destroyPaneTabs()
  fixture = null
  capturedDeps.length = 0
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

/**
 * Runs useIpcEvents against the shared preload stub and returns both the finalize callback it
 * installed and the pane fixture. The fixture is imported AFTER the harness resets the module
 * registry so its PaneManagers register into the same pane-manager-registry instance the hook
 * just imported — two copies of that module-global registry would make this test pass on an
 * empty set of managers.
 */
async function loadReconnectFinalize(): Promise<{
  finalize: DirectSshReconnectCoordinatorDeps['finalizeHydratedTerminalPanes']
  panes: PaintedPaneFixture
}> {
  const harness = await loadIpcEventsHarness(createHarnessStoreState({ tabsByWorktree: {} }))
  // The hook schedules its settled pass through window.setTimeout; the harness's window stub
  // has no timers of its own.
  const stubbedWindow = globalThis.window as unknown as { setTimeout?: typeof setTimeout }
  stubbedWindow.setTimeout = ((handler: () => void, ms?: number) =>
    setTimeout(handler, ms)) as unknown as typeof setTimeout
  harness.useIpcEvents()
  const deps = capturedDeps.at(-1)
  if (!deps) {
    throw new Error('useIpcEvents did not create the direct SSH reconnect coordinator')
  }
  fixture = await import('@/lib/pane-manager/painted-pane-fixture')
  fixture.stubTerminalTextMeasurement()
  return { finalize: deps.finalizeHydratedTerminalPanes, panes: fixture }
}

describe('the reconnect finalize hook useIpcEvents installs', () => {
  // Deleting this test lets the two scheduling lines in useIpcEvents' finalizeHydratedTerminalPanes
  // be removed with every other test still green — which is the state the branch was in when the
  // blank-panes report came back: reattach restores the buffer, nothing repaints the frame.
  it('repaints live panes in every tab, including a split and an alt-screen TUI', async () => {
    const { finalize, panes } = await loadReconnectFinalize()

    const foreground = panes.createPaneTab()
    const background = panes.createPaneTab()
    const shell = foreground.manager.createInitialPane({ focus: false })
    const tui = foreground.manager.splitPane(shell.id, 'vertical')
    const otherTab = background.manager.createInitialPane({ focus: false })
    if (!tui) {
      throw new Error('expected the split to create a second pane')
    }
    await panes.writeToPane(shell, '$ ssh host output\r\n')
    await panes.writeAlternateScreenFrame(tui, ['agent frame'])
    await panes.writeToPane(otherTab, '$ second tab output\r\n')
    await panes.settleFrames(30)
    for (const pane of [shell, tui, otherTab]) {
      panes.blankPaintedLayer(pane)
    }
    expect(panes.paintedText(shell)).toBe('')

    finalize(AUTHORITY as never)
    await panes.settleFrames()

    expect(panes.paintedText(shell)).toContain('ssh host output')
    expect(panes.paintedText(tui)).toContain('agent frame')
    expect(panes.paintedText(otherTab)).toContain('second tab output')
  })
})
