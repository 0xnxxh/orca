import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appOnce,
  appRemoveListener,
  getAllWindows,
  subscribeNotification,
  unsubscribeNotification,
  waitForSnapshotIdle
} = vi.hoisted(() => ({
  appOnce: vi.fn(),
  appRemoveListener: vi.fn(),
  getAllWindows: vi.fn(),
  subscribeNotification: vi.fn(),
  unsubscribeNotification: vi.fn(),
  waitForSnapshotIdle: vi.fn()
}))

vi.mock('electron', () => ({
  app: { once: appOnce, removeListener: appRemoveListener },
  BrowserWindow: { getAllWindows },
  systemPreferences: { subscribeNotification, unsubscribeNotification }
}))

vi.mock('./macos-keyboard-layout-snapshot', () => ({
  waitForMacKeyboardLayoutSnapshotIdle: waitForSnapshotIdle
}))

import { KEYBOARD_LAYOUT_CHANGED_CHANNEL } from '../../shared/keyboard-layout-events'
import {
  MAC_KEYBOARD_INPUT_SOURCE_CHANGED_NOTIFICATION,
  registerMacKeyboardLayoutChangeNotifications
} from './macos-keyboard-layout-change-notifications'

describe('macOS keyboard layout change notifications', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('waits for the old native read, broadcasts to live windows, and unsubscribes on quit', async () => {
    let notificationCallback: (() => void) | undefined
    let finishRead!: () => void
    waitForSnapshotIdle.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRead = resolve
      })
    )
    subscribeNotification.mockImplementation((_name: string, callback: () => void) => {
      notificationCallback = callback
      return 41
    })
    const send = vi.fn()
    getAllWindows.mockReturnValue([
      {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: vi.fn(() => {
            throw new Error('window closed')
          })
        }
      },
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } },
      {
        isDestroyed: () => true,
        webContents: { isDestroyed: () => false, send: vi.fn() }
      }
    ])

    registerMacKeyboardLayoutChangeNotifications()
    expect(subscribeNotification).toHaveBeenCalledWith(
      MAC_KEYBOARD_INPUT_SOURCE_CHANGED_NOTIFICATION,
      expect.any(Function)
    )

    notificationCallback?.()
    expect(send).not.toHaveBeenCalled()
    finishRead()
    await Promise.resolve()
    await Promise.resolve()
    expect(send).toHaveBeenCalledExactlyOnceWith(KEYBOARD_LAYOUT_CHANGED_CHANNEL)

    const quitListener = appOnce.mock.calls.find(([event]) => event === 'will-quit')?.[1] as
      | (() => void)
      | undefined
    unsubscribeNotification.mockImplementationOnce(() => {
      throw new Error('native teardown unavailable')
    })
    expect(() => quitListener?.()).not.toThrow()
    expect(unsubscribeNotification).toHaveBeenCalledExactlyOnceWith(41)
    expect(appRemoveListener).toHaveBeenCalledWith('will-quit', quitListener)
  })

  it('does not install a native subscription off macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

    registerMacKeyboardLayoutChangeNotifications()

    expect(subscribeNotification).not.toHaveBeenCalled()
    expect(appOnce).not.toHaveBeenCalled()
  })
})
