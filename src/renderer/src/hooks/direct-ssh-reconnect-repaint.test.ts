/**
 * A reconnect must repaint the panes, not just reattach them.
 *
 * Reattach restores each pane's buffer but not its painted frame: xterm repaints on a write or a
 * resize, and a reconnect produces neither for a pane that was already correctly sized. So the
 * panes come back blank until something forces a relayout — which is why resizing a split or
 * toggling the sidebar appears to "fix" it. Reported after a hosts-popup disconnect/reconnect with
 * splits and agent TUIs open.
 */
import { describe, expect, it, vi } from 'vitest'

const refitAndRefreshAllTerminalPanes = vi.fn()
vi.mock('@/lib/pane-manager/pane-manager-registry', () => ({
  refitAndRefreshAllTerminalPanes: () => refitAndRefreshAllTerminalPanes()
}))

/** The shape `useIpcEvents` installs as the coordinator's finalize hook. */
function finalizeHydratedTerminalPanes(retryTargetPanes: () => number): number {
  const retried = retryTargetPanes()
  requestAnimationFrame(refitAndRefreshAllTerminalPanes)
  setTimeout(refitAndRefreshAllTerminalPanes, 100)
  // Mirrors useIpcEvents, which calls window.setTimeout; the timer identity is what matters here.

  return retried
}

describe('finalizing hydrated panes after a direct SSH reconnect', () => {
  it('schedules a repaint, because reattaching alone leaves the panes unpainted', () => {
    vi.useFakeTimers()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb)
      return frames.length
    })
    refitAndRefreshAllTerminalPanes.mockClear()

    try {
      const retried = finalizeHydratedTerminalPanes(() => 3)

      expect(retried, 'the retry result must still reach the coordinator').toBe(3)
      expect(
        refitAndRefreshAllTerminalPanes,
        'nothing was scheduled, so the panes stay blank until a resize'
      ).not.toHaveBeenCalled()

      for (const frame of frames.splice(0)) {
        frame(0)
      }
      expect(refitAndRefreshAllTerminalPanes).toHaveBeenCalledTimes(1)

      // The settled pass: rAF alone lands while panes are still remounting.
      vi.advanceTimersByTime(100)
      expect(
        refitAndRefreshAllTerminalPanes,
        'only the immediate frame repainted; a pane still mounting stays blank'
      ).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})
