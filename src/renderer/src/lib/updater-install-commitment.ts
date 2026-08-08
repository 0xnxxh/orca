import { ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT } from '../../../shared/updater-renderer-events'

// Why: the installer replaces app.asar underneath every live renderer, so this has
// to be true in the dashboard popout too — it has its own JS context and its own
// lazy chunks read from the same archive. Main broadcasts the authoritative value;
// the local event only arms the initiating window a few milliseconds earlier.
let broadcastCommitted = false
let locallyStarted = false

export function isUpdaterInstallCommitted(): boolean {
  return broadcastCommitted || locallyStarted
}

/**
 * Registered by every renderer entry point, not just the main app root.
 *
 * The local start event is deliberately one-way: only main clears the committed
 * state, so an unrelated updater check failing mid-install cannot make a renderer
 * believe the archive underneath it is stable again.
 */
export function registerUpdaterInstallCommitment(): () => void {
  const markLocal = (): void => {
    locallyStarted = true
  }
  window.addEventListener(ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, markLocal)

  const applyBroadcast = (committed: boolean): void => {
    broadcastCommitted = committed
    if (!committed) {
      locallyStarted = false
    }
  }
  const unsubscribe = window.api?.updater?.onInstallCommitted?.(applyBroadcast)

  // A window opened mid-install never saw the broadcast, so seed it.
  void window.api?.updater
    ?.isInstallCommitted?.()
    .then((committed) => {
      if (committed) {
        broadcastCommitted = true
      }
    })
    .catch(() => {
      // Best effort: the broadcast still arrives if an install starts later.
    })

  return () => {
    window.removeEventListener(ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, markLocal)
    unsubscribe?.()
    broadcastCommitted = false
    locallyStarted = false
  }
}

export function resetUpdaterInstallCommitmentForTest(): void {
  broadcastCommitted = false
  locallyStarted = false
}
