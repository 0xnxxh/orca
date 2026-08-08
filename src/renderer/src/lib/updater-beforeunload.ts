import {
  ORCA_APP_RESTART_ABORTED_EVENT,
  ORCA_APP_RESTART_STARTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT
} from '../../../shared/updater-renderer-events'

let intentionalAppRestartInProgress = false
// Tracked separately from the restart flag above: an ordinary lazy-chunk recovery
// reload also announces itself as an app restart, but only an updater install
// replaces app.asar underneath the running renderer.
let updaterInstallCommitted = false

export function isUpdaterQuitAndInstallInProgress(): boolean {
  return isIntentionalAppRestartInProgress()
}

/** True only while the updater is installing, so chunk reads may hit a swapped archive. */
export function isUpdaterInstallCommitted(): boolean {
  return updaterInstallCommitted
}

export function isIntentionalAppRestartInProgress(): boolean {
  return intentionalAppRestartInProgress
}

export function registerUpdaterBeforeUnloadBypass(): () => void {
  const markInProgress = (): void => {
    intentionalAppRestartInProgress = true
  }
  const clearInProgress = (): void => {
    intentionalAppRestartInProgress = false
  }

  const markInstallCommitted = (): void => {
    updaterInstallCommitted = true
    markInProgress()
  }
  const clearInstallCommitted = (): void => {
    updaterInstallCommitted = false
    clearInProgress()
  }

  window.addEventListener(ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, markInstallCommitted)
  window.addEventListener(ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, clearInstallCommitted)
  window.addEventListener(ORCA_APP_RESTART_STARTED_EVENT, markInProgress)
  window.addEventListener(ORCA_APP_RESTART_ABORTED_EVENT, clearInProgress)

  return () => {
    window.removeEventListener(ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, markInstallCommitted)
    window.removeEventListener(ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, clearInstallCommitted)
    window.removeEventListener(ORCA_APP_RESTART_STARTED_EVENT, markInProgress)
    window.removeEventListener(ORCA_APP_RESTART_ABORTED_EVENT, clearInProgress)
    // Why: hot reloads can re-register this listener inside the same renderer.
    // Reset the module flag on cleanup so a failed earlier restart attempt
    // cannot silently suppress future unsaved-change prompts.
    intentionalAppRestartInProgress = false
    updaterInstallCommitted = false
  }
}
