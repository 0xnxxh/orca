import { BrowserWindow, ipcMain, type IpcMainEvent, type WebContents } from 'electron'
import {
  APP_RELAUNCH_PREPARE_ABORT_CHANNEL,
  APP_RELAUNCH_PREPARE_CHANNEL,
  APP_RELAUNCH_PREPARE_REPLY_CHANNEL,
  type AppRelaunchPrepareReply
} from '../../shared/relaunch-preparation-ipc'

// Why: a hung renderer can never confirm a backup; a bounded wait keeps one
// unresponsive window from pinning every future relaunch open.
export const RELAUNCH_PREPARE_REPLY_TIMEOUT_MS = 5_000

let nextRelaunchPrepareRequestId = 1

type PrepareOutcome = 'prepared' | 'refused' | 'unresponsive'

/**
 * The invoking preload preps only its own document before app:relaunch, and
 * app.exit(0) skips unload — so every other window (e.g. the main window when
 * a dashboard popout initiates the restart) would lose dirty editor buffers.
 * Ask each of them to run the same restart preparation and wait for a verdict.
 *
 * An explicit refusal (checkpoint could not persist) throws so the relaunch is
 * abandoned with the app still open. Silence (no preload handler, hung
 * renderer) degrades after the timeout to the unprepared pre-handshake
 * behavior for that window only, rather than blocking recovery forever.
 */
export async function prepareOtherWindowsForRelaunch(
  sender: WebContents | null | undefined
): Promise<void> {
  const targets = BrowserWindow.getAllWindows().filter(
    (win) =>
      !win.isDestroyed() &&
      !win.webContents.isDestroyed() &&
      (!sender || win.webContents.id !== sender.id)
  )
  if (targets.length === 0) {
    return
  }
  const requestId = nextRelaunchPrepareRequestId++
  const resolvers = new Map<number, (outcome: PrepareOutcome) => void>()
  const onReply = (event: IpcMainEvent, reply: AppRelaunchPrepareReply): void => {
    if (reply?.requestId !== requestId) {
      return
    }
    resolvers.get(event.sender.id)?.(reply.ok === true ? 'prepared' : 'refused')
  }
  ipcMain.on(APP_RELAUNCH_PREPARE_REPLY_CHANNEL, onReply)
  try {
    const outcomes = await Promise.all(
      targets.map(
        (win) =>
          new Promise<PrepareOutcome>((resolve) => {
            const timer = setTimeout(
              () => resolve('unresponsive'),
              RELAUNCH_PREPARE_REPLY_TIMEOUT_MS
            )
            resolvers.set(win.webContents.id, (outcome) => {
              clearTimeout(timer)
              resolve(outcome)
            })
            win.webContents.send(APP_RELAUNCH_PREPARE_CHANNEL, { requestId })
          })
      )
    )
    if (outcomes.includes('refused')) {
      // Why: windows that already prepared armed their restart latch; release it.
      for (const win of targets) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(APP_RELAUNCH_PREPARE_ABORT_CHANNEL)
        }
      }
      throw new Error('A window refused its pre-relaunch checkpoint; keeping the app open.')
    }
  } finally {
    ipcMain.removeListener(APP_RELAUNCH_PREPARE_REPLY_CHANNEL, onReply)
  }
}
