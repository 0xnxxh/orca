import { app, ipcMain } from 'electron'
import { relaunchApp } from '../app-relaunch'
import { destroySystemTray } from '../tray/system-tray'
import { prepareOtherWindowsForRelaunch } from './relaunch-window-preparation'

export type AppRelaunchHandlerOptions = {
  onBeforeRelaunch?: () => void | Promise<void>
}

export function registerAppRelaunchHandlers(options: AppRelaunchHandlerOptions): void {
  // Renderer-side click guards cannot see each other across surfaces. Share the
  // whole cleanup + exit sequence so concurrent invokes cannot race checkpoints
  // or register multiple replacement instances.
  let relaunchExitPromise: Promise<void> | null = null
  ipcMain.handle('app:relaunch', (event) => {
    relaunchExitPromise ??= (async () => {
      try {
        // Why: app.exit(0) below skips unload, so windows other than the
        // invoker need an explicit hot-exit backup + checkpoint pass first.
        await prepareOtherWindowsForRelaunch(event?.sender)
      } catch (error) {
        // Why: a refused checkpoint keeps the app open; re-arm so a retry can
        // run a fresh preparation instead of joining this rejected promise.
        relaunchExitPromise = null
        throw error
      }
      // Why: brief delay lets the renderer paint "Restarting…" before the window tears down.
      await runBeforeRelaunchCleanup(options.onBeforeRelaunch)
      setTimeout(() => {
        try {
          // Why: app.exit(0) skips before-quit, so destroy the Windows tray manually to avoid a stale icon.
          destroySystemTray()
          relaunchApp('renderer-request')
          app.exit(0)
        } catch (error) {
          // Why: the process is still alive; re-arm the singleflight so a retry
          // schedules a fresh exit pair instead of joining a settled no-op.
          relaunchExitPromise = null
          console.warn(
            '[app] Relaunch exit failed; retry re-armed:',
            error instanceof Error ? error.name : typeof error
          )
        }
      }, 150)
    })()
    return relaunchExitPromise
  })

  ipcMain.handle('app:restart', async () => {
    // Why: use the normal quit pipeline so daemon checkpoints and telemetry flush before exit.
    await runBeforeRelaunchCleanup(options.onBeforeRelaunch)
    setTimeout(() => {
      relaunchApp('admin-restart')
      app.quit()
    }, 150)
  })
}

async function runBeforeRelaunchCleanup(
  onBeforeRelaunch?: () => void | Promise<void>
): Promise<void> {
  try {
    await onBeforeRelaunch?.()
  } catch (error) {
    // Why: best-effort cleanup must never block relaunch; log only error.name to avoid leaking secrets.
    console.warn(
      '[app] Pre-relaunch cleanup failed; continuing relaunch:',
      error instanceof Error ? error.name : typeof error
    )
  }
}
