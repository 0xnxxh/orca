// Why: background pollers that only exist to keep visible UI fresh (worktree
// base/git-common scans) waste CPU while the main window is hidden or
// minimized. This gate stops the timer entirely while hidden and re-arms with
// one immediate catch-up tick on reveal, so no external change is missed.
// Occlusion is undetectable (BrowserWindow.isVisible() stays true when merely
// covered), so this only helps the hidden/minimized case — that's expected.
export type WindowVisibilityGate = {
  /** Omitted means always-visible: the interval never pauses (test doubles, headless). */
  isWindowVisible?: () => boolean
  /** Process-global became-visible signal (survives window recreation); returns an unsubscribe. */
  onWindowBecameVisible?: (listener: () => void) => () => void
}

export function startVisibilityGatedInterval(
  tick: () => void,
  intervalMs: number,
  gate: WindowVisibilityGate = {}
): { dispose: () => void } {
  const { isWindowVisible, onWindowBecameVisible } = gate
  let disposed = false
  let timer: ReturnType<typeof setInterval> | null = null

  const startTimer = (): void => {
    const interval = setInterval(() => {
      if (isWindowVisible && !isWindowVisible()) {
        // Hidden: stop entirely (zero further wakeups, no scan on this tick);
        // the became-visible listener re-arms.
        clearInterval(interval)
        timer = null
        return
      }
      tick()
    }, intervalMs)
    interval.unref?.()
    timer = interval
  }
  startTimer()

  const stopBecameVisible = onWindowBecameVisible?.(() => {
    if (disposed || timer !== null) {
      return
    }
    // Catch up once on changes made while hidden, then resume the cadence.
    tick()
    startTimer()
  })

  return {
    dispose: () => {
      disposed = true
      stopBecameVisible?.()
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }
  }
}
