import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  browserWindowMock,
  openExternalMock,
  buildFromTemplateMock,
  notificationMock,
  powerMonitorOnMock,
  powerMonitorRemoveListenerMock,
  isMock
} = vi.hoisted(() => ({
  browserWindowMock: vi.fn(),
  openExternalMock: vi.fn(),
  buildFromTemplateMock: vi.fn(() => ({ popup: vi.fn() })),
  notificationMock: vi.fn(function () {
    return { show: vi.fn() }
  }),
  powerMonitorOnMock: vi.fn(),
  powerMonitorRemoveListenerMock: vi.fn(),
  isMock: { dev: false }
}))

vi.mock('electron', () => ({
  app: { on: vi.fn(), removeListener: vi.fn() },
  BrowserWindow: browserWindowMock,
  ipcMain: { on: vi.fn(), removeListener: vi.fn(), handle: vi.fn(), removeHandler: vi.fn() },
  Menu: { buildFromTemplate: buildFromTemplateMock },
  Notification: notificationMock,
  nativeTheme: { shouldUseDarkColors: false },
  powerMonitor: { on: powerMonitorOnMock, removeListener: powerMonitorRemoveListenerMock },
  screen: {
    getPrimaryDisplay: () => ({ workAreaSize: { width: 1440, height: 900 } }),
    getDisplayMatching: () => ({ scaleFactor: 2 })
  },
  shell: { openExternal: openExternalMock }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: isMock
}))

vi.mock('./macos-tahoe-release', () => ({
  isMacosTahoeOrNewer: vi.fn(() => false)
}))

vi.mock('../app-icon', () => ({
  getAppIconPath: vi.fn(() => 'icon')
}))

vi.mock('../browser/browser-manager', () => ({
  browserManager: {
    attachGuestPolicies: vi.fn(),
    setDictationShortcutForwardingPredicate: vi.fn()
  }
}))

import { createMainWindow } from './createMainWindow'
import { shouldRecoverRendererAfterProcessGone } from '../crash-reporting/process-gone-classification'

function createWindowHarness(): {
  browserWindowInstance: { loadFile: ReturnType<typeof vi.fn> }
  windowHandlers: Record<string, (...args: any[]) => void>
} {
  const windowHandlers: Record<string, (...args: any[]) => void> = {}
  const webContents = {
    id: 143,
    on: vi.fn((event, handler) => {
      windowHandlers[event] = handler
    }),
    setZoomLevel: vi.fn(),
    setBackgroundThrottling: vi.fn(),
    invalidate: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    send: vi.fn()
  }
  const browserWindowInstance = {
    webContents,
    on: vi.fn((event, handler) => {
      windowHandlers[event] = handler
    }),
    isDestroyed: vi.fn(() => false),
    isMaximized: vi.fn(() => true),
    isFullScreen: vi.fn(() => false),
    getSize: vi.fn(() => [1200, 800]),
    setSize: vi.fn(),
    maximize: vi.fn(),
    show: vi.fn(),
    loadFile: vi.fn(),
    loadURL: vi.fn()
  }
  browserWindowMock.mockImplementation(function () {
    return browserWindowInstance
  })

  return { browserWindowInstance, windowHandlers }
}

describe('external SIGTERM teardown of the renderer', () => {
  beforeEach(() => {
    browserWindowMock.mockReset()
    isMock.dev = false
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Regression: report 95917814 — an OS/session-manager stop SIGTERMs the whole
  // Chromium process tree, Orca reloaded the shell, and the resurrected renderer
  // then died with SIGKILL and filed a bogus crash report.
  it('does not reload the app shell when Chromium children are SIGTERMed', () => {
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { browserWindowInstance, windowHandlers } = createWindowHarness()

    createMainWindow(null, {
      shouldRecoverRenderer: (details) =>
        shouldRecoverRendererAfterProcessGone({
          reason: details.reason,
          exitCode: details.exitCode ?? null,
          expectedTeardown: 'none'
        })
    })

    windowHandlers['render-process-gone']?.(
      {} as never,
      { reason: 'killed', exitCode: 15 } as Electron.RenderProcessGoneDetails
    )
    vi.advanceTimersByTime(250)

    // Only the initial load. A recovery reload here fights the terminator shutting Orca
    // down; the resurrected renderer is what dies with SIGKILL and files the bogus report.
    expect(browserWindowInstance.loadFile).toHaveBeenCalledTimes(1)

    consoleError.mockRestore()
  })

  it('still recovers real renderer crashes and OOM kills', () => {
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { browserWindowInstance, windowHandlers } = createWindowHarness()

    createMainWindow(null, {
      shouldRecoverRenderer: (details) =>
        shouldRecoverRendererAfterProcessGone({
          reason: details.reason,
          exitCode: details.exitCode ?? null,
          expectedTeardown: 'none'
        })
    })

    windowHandlers['render-process-gone']?.(
      {} as never,
      { reason: 'oom', exitCode: 15 } as Electron.RenderProcessGoneDetails
    )
    vi.advanceTimersByTime(250)

    expect(browserWindowInstance.loadFile).toHaveBeenCalledTimes(2)

    consoleError.mockRestore()
  })
})
