import { ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT } from '../../../shared/updater-renderer-events'

// Why: the installer replaces app.asar underneath every live renderer, so this has
// to be true in the dashboard popout too — it has its own JS context and its own
// lazy chunks read from the same archive. Main broadcasts the authoritative value;
// the local event only arms the initiating window a few milliseconds earlier.
// null until main has said something authoritative for this document.
let broadcastCommitted: boolean | null = null
let locallyStarted = false
let loadTimeCommitted: boolean | null = null

// Why: a document created or reloaded mid-install — View → Reload, crash recovery,
// dock activation, a popout — misses the broadcast, and its async seed can lose the
// race outright because the Linux package install blocks main inside spawnSync.
// Preload captures this synchronously before any document script, so the very first
// lazy import already knows. Read lazily so it is available before React mounts.
function committedAtDocumentLoad(): boolean {
  if (loadTimeCommitted === null) {
    loadTimeCommitted = window.api?.updater?.installCommittedAtLoad === true
  }
  return loadTimeCommitted
}

export function isUpdaterInstallCommitted(): boolean {
  // This window just asked to install, which is fresher than any earlier verdict —
  // a stale `false` from a previous aborted install must not mask it.
  if (locallyStarted) {
    return true
  }
  // Otherwise main is authoritative: only it can stand the archive back up.
  if (broadcastCommitted !== null) {
    return broadcastCommitted
  }
  return committedAtDocumentLoad()
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
      loadTimeCommitted = false
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
    broadcastCommitted = null
    locallyStarted = false
    loadTimeCommitted = null
  }
}

export function resetUpdaterInstallCommitmentForTest(): void {
  broadcastCommitted = null
  locallyStarted = false
  loadTimeCommitted = null
}
