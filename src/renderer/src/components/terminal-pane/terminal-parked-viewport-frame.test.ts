import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagedPane, PaneManager } from '@/lib/pane-manager/pane-manager'
import type { PtyTransport } from './pty-transport'
import {
  captureParkedTerminalPanes,
  captureParkedTerminalViewportFrame,
  consumeParkedTerminalViewportFrameMarker,
  replayParkedTerminalViewportFrames
} from './terminal-parked-viewport-frame'

const mocks = vi.hoisted(() => ({ replayIntoTerminalAsync: vi.fn(() => Promise.resolve()) }))

vi.mock('./replay-guard', () => ({ replayIntoTerminalAsync: mocks.replayIntoTerminalAsync }))

function makePane(
  id = 1,
  leafId = 'leaf-1'
): {
  pane: ManagedPane
  serialize: ReturnType<typeof vi.fn>
} {
  const serialize = vi.fn(() => 'cached viewport')
  return {
    pane: {
      id,
      leafId,
      terminal: {
        cols: 120,
        rows: 40,
        buffer: { active: { cursorX: 4, cursorY: 7 } }
      },
      container: { dataset: {} },
      serializeAddon: { serialize }
    } as unknown as ManagedPane,
    serialize
  }
}

beforeEach(() => {
  mocks.replayIntoTerminalAsync.mockClear()
})

describe('parked terminal viewport frames', () => {
  it('captures only the active viewport with an absolute cursor restore', () => {
    const { pane, serialize } = makePane()

    const frame = captureParkedTerminalViewportFrame(pane)

    expect(serialize).toHaveBeenCalledWith({ scrollback: 0 })
    expect(frame).toEqual({ data: 'cached viewport\x1b[8;5H', cols: 120, rows: 40 })
  })

  it('captures viewport frames only for paired runtime panes', () => {
    const remote = makePane(1, 'remote-leaf')
    const local = makePane(2, 'local-leaf')
    const manager = {
      getActivePane: () => remote.pane,
      getPanes: () => [remote.pane, local.pane]
    } as unknown as PaneManager
    const transports = new Map<number, PtyTransport>([
      [1, { getPtyId: () => 'remote:windows-low-spec@@terminal-1' } as PtyTransport],
      [2, { getPtyId: () => 'local-pty' } as PtyTransport]
    ])

    const captures = captureParkedTerminalPanes(manager, transports)

    expect(captures[0].viewportFrame?.data).toContain('cached viewport')
    expect(captures[1]).not.toHaveProperty('viewportFrame')
    expect(local.serialize).not.toHaveBeenCalled()
  })

  it('replays a matching-grid frame and rebuilds WebGL after parsing', async () => {
    const matching = makePane(1, 'matching')
    const stale = makePane(2, 'stale')
    const rebuildPaneWebgl = vi.fn()
    const manager = {
      getPanes: () => [matching.pane, stale.pane],
      hasWebglRenderer: () => true,
      rebuildPaneWebgl
    } as unknown as PaneManager
    const replayingPanesRef = { current: new Map<number, number>() }

    const replayed = replayParkedTerminalViewportFrames({
      manager,
      frames: [
        { leafId: 'matching', frame: { data: 'matching frame', cols: 120, rows: 40 } },
        { leafId: 'stale', frame: { data: 'stale frame', cols: 80, rows: 24 } }
      ],
      isVisible: () => true,
      paneByLeafId: new Map([
        ['matching', 1],
        ['stale', 2]
      ]),
      replayingPanesRef
    })

    expect(replayed).toBe(1)
    expect(mocks.replayIntoTerminalAsync).toHaveBeenCalledOnce()
    expect(mocks.replayIntoTerminalAsync).toHaveBeenCalledWith(
      matching.pane,
      replayingPanesRef,
      'matching frame',
      expect.objectContaining({ shouldReleaseRenderPause: expect.any(Function) })
    )
    expect(mocks.replayIntoTerminalAsync.mock.calls[0][3].shouldReleaseRenderPause()).toBe(true)
    await Promise.resolve()
    expect(rebuildPaneWebgl).toHaveBeenCalledWith(1)
    expect(consumeParkedTerminalViewportFrameMarker(matching.pane)).toBe(true)
    expect(consumeParkedTerminalViewportFrameMarker(matching.pane)).toBe(false)
  })
})
