import { app, BrowserWindow, systemPreferences } from 'electron'
import { KEYBOARD_LAYOUT_CHANGED_CHANNEL } from '../../shared/keyboard-layout-events'
import { waitForMacKeyboardLayoutSnapshotIdle } from './macos-keyboard-layout-snapshot'

const INPUT_SOURCE_CHANGED_NOTIFICATION =
  'com.apple.Carbon.TISNotifySelectedKeyboardInputSourceChanged'

export function registerMacKeyboardLayoutChangeNotifications(): () => void {
  if (process.platform !== 'darwin') {
    return () => undefined
  }

  let disposed = false
  let subscriptionId: number
  const broadcastAfterCurrentRead = async (): Promise<void> => {
    await waitForMacKeyboardLayoutSnapshotIdle()
    if (disposed) {
      return
    }
    for (const window of BrowserWindow.getAllWindows()) {
      try {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send(KEYBOARD_LAYOUT_CHANGED_CHANNEL)
        }
      } catch {
        // The window can close between the liveness check and send.
      }
    }
  }

  try {
    subscriptionId = systemPreferences.subscribeNotification(
      INPUT_SOURCE_CHANGED_NOTIFICATION,
      () => void broadcastAfterCurrentRead()
    )
  } catch {
    return () => undefined
  }

  const dispose = (): void => {
    if (disposed) {
      return
    }
    disposed = true
    app.removeListener('will-quit', dispose)
    try {
      systemPreferences.unsubscribeNotification(subscriptionId)
    } catch {
      // Native notification teardown is best-effort during process exit.
    }
  }
  app.once('will-quit', dispose)
  return dispose
}

export const MAC_KEYBOARD_INPUT_SOURCE_CHANGED_NOTIFICATION = INPUT_SOURCE_CHANGED_NOTIFICATION
