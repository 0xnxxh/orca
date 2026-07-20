import { app, BrowserWindow, ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { DashboardRevealAgentArgs, DashboardSnapshot } from '../../shared/dashboard-snapshot'
import {
  createOrFocusDashboardPopout,
  getDashboardPopoutWindow,
  onDashboardPopoutOpenChanged
} from '../window/dashboard-popout-window'
import { safelyRevealWindow } from '../window/focus-existing-window'

// The most recent snapshot the main renderer published, replayed to the popout
// the instant it mounts so the board paints without waiting for the next tick.
// Cleared on close so a reopened popout never flashes a previous session.
let lastSnapshot: DashboardSnapshot | null = null

function sendToNonPopoutWindows(channel: string, ...args: unknown[]): void {
  const popout = getDashboardPopoutWindow()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win === popout) {
      continue
    }
    win.webContents.send(channel, ...args)
  }
}

export function registerDashboardPopoutHandlers(store: Store): void {
  ipcMain.removeHandler('dashboardPopout:open')
  ipcMain.removeHandler('dashboard:publishSnapshot')
  ipcMain.removeHandler('dashboard:requestSnapshot')
  ipcMain.removeHandler('dashboard:getPopoutOpen')
  ipcMain.removeHandler('dashboardPopout:revealAgent')
  ipcMain.removeHandler('dashboardPopout:ackAgent')

  onDashboardPopoutOpenChanged((open) => {
    if (!open) {
      lastSnapshot = null
    }
  })

  // Opening the pop-out is a privilege-free, idempotent action (create or focus
  // the singleton), so no sender trust check is needed here.
  ipcMain.handle('dashboardPopout:open', (): void => {
    createOrFocusDashboardPopout(store)
  })

  // Relay: the main renderer publishes derived snapshots; forward to the popout.
  ipcMain.handle('dashboard:publishSnapshot', (_event, snapshot: DashboardSnapshot): void => {
    lastSnapshot = snapshot
    getDashboardPopoutWindow()?.webContents.send('dashboard:snapshot', snapshot)
  })

  // The popout asks for a snapshot on mount: replay the cache immediately, then
  // nudge the main renderer to publish a fresh one.
  ipcMain.handle('dashboard:requestSnapshot', (event): void => {
    if (lastSnapshot) {
      event.sender.send('dashboard:snapshot', lastSnapshot)
    }
    sendToNonPopoutWindows('dashboard:snapshotRequested')
  })

  ipcMain.handle('dashboard:getPopoutOpen', (): boolean => getDashboardPopoutWindow() !== null)

  // Seen-sync: opening a card's terminal dialog acknowledges the agent in the
  // main renderer's store — the same ack that mutes its sidebar row.
  ipcMain.handle('dashboardPopout:ackAgent', (_event, args: { paneKey: string }): void => {
    if (typeof args?.paneKey !== 'string' || args.paneKey.length === 0) {
      return
    }
    sendToNonPopoutWindows('ui:ackDashboardAgent', args.paneKey)
  })

  // Click-to-focus: raise the main window and route it to the agent's pane.
  ipcMain.handle('dashboardPopout:revealAgent', (_event, args: DashboardRevealAgentArgs): void => {
    const popout = getDashboardPopoutWindow()
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win === popout) {
        continue
      }
      safelyRevealWindow(win)
      win.webContents.send('ui:revealDashboardAgent', args)
    }
    try {
      app.focus({ steal: true })
    } catch {
      // Best-effort; the per-window focus above may still bring it forward.
    }
  })
}
