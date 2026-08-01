import { prepareRendererForAppRestart } from '../../../shared/renderer-restart-preparation'
import { ORCA_RENDERER_UNLOAD_PREVENTED_EVENT } from '../../../shared/renderer-shutdown-events'
import {
  ORCA_APP_RESTART_ABORTED_EVENT,
  ORCA_APP_RESTART_STARTED_EVENT
} from '../../../shared/updater-renderer-events'

/**
 * Why: `window.location.reload()` alone cannot recover a corrupt lazy chunk in an
 * editor app. Terminal's beforeunload handler preventDefault()s whenever any open
 * file is dirty, and Electron's will-prevent-unload cancels the navigation with no
 * dialog — so the recovery reload for crash b860def2 was requested and silently
 * dropped, leaving the pane dead for 44 minutes. The updater already solved this:
 * back up hot-exit buffers, take the one synchronous session checkpoint, and latch
 * `isIntentionalAppRestartInProgress()` so the dirty-tab guard stands down. This
 * runs that same sequence for chunk recovery.
 */

export type LazyChunkRecoveryReloadOutcome =
  /** Hot-exit backup or the session checkpoint refused; unsaved work stays put. */
  | 'checkpoint-refused'
  /** Something still vetoed beforeunload after the restart latch was armed. */
  | 'unload-vetoed'
  /** No veto signal, but the document outlived the grace window. */
  | 'never-landed'

// Backstop only. The veto event is authoritative, but a headless/paired-web host may
// cancel navigation without one, so never suspend the boundary indefinitely.
const RELOAD_SETTLE_GRACE_MS = 10_000

function waitForRefusedNavigation(
  win: Window
): Promise<Exclude<LazyChunkRecoveryReloadOutcome, 'checkpoint-refused'>> {
  return new Promise((resolve) => {
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    const settle = (
      outcome: Exclude<LazyChunkRecoveryReloadOutcome, 'checkpoint-refused'>
    ): void => {
      if (graceTimer !== undefined) {
        clearTimeout(graceTimer)
      }
      win.removeEventListener(ORCA_RENDERER_UNLOAD_PREVENTED_EVENT, onUnloadPrevented)
      resolve(outcome)
    }
    const onUnloadPrevented = (): void => settle('unload-vetoed')

    win.addEventListener(ORCA_RENDERER_UNLOAD_PREVENTED_EVENT, onUnloadPrevented)
    graceTimer = setTimeout(() => settle('never-landed'), RELOAD_SETTLE_GRACE_MS)
  })
}

/**
 * Requests the one recovery reload. Resolves ONLY when the navigation was refused —
 * a landed reload tears the document down instead, so the caller stays suspended.
 */
export async function requestLazyChunkRecoveryReload(
  win: Window
): Promise<LazyChunkRecoveryReloadOutcome> {
  try {
    await prepareRendererForAppRestart(win, {
      startedEventName: ORCA_APP_RESTART_STARTED_EVENT,
      abortedEventName: ORCA_APP_RESTART_ABORTED_EVENT
    })
  } catch {
    // prepareRendererForAppRestart already dispatched the abort; never reload over
    // editor buffers that could not be backed up.
    return 'checkpoint-refused'
  }

  const refused = waitForRefusedNavigation(win)
  win.location.reload()
  const outcome = await refused
  // Why: the latch suppresses the unsaved-changes prompt, so a document that stayed
  // alive must never keep it armed.
  win.dispatchEvent(new Event(ORCA_APP_RESTART_ABORTED_EVENT))
  return outcome
}
