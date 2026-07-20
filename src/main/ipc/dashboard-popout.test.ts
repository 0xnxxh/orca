import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, ipcMainMock, appMock, getAllWindowsMock, getPopoutMock, safelyRevealMock } =
  vi.hoisted(() => {
    const map = new Map<string, (...args: unknown[]) => unknown>()
    return {
      handlers: map,
      ipcMainMock: {
        removeHandler: vi.fn(),
        handle: (channel: string, fn: (...args: unknown[]) => unknown) => map.set(channel, fn)
      },
      appMock: { focus: vi.fn() },
      getAllWindowsMock: vi.fn((): unknown[] => []),
      getPopoutMock: vi.fn((): unknown => null),
      safelyRevealMock: vi.fn()
    }
  })

vi.mock('electron', () => ({
  app: appMock,
  BrowserWindow: { getAllWindows: getAllWindowsMock },
  ipcMain: ipcMainMock
}))
vi.mock('../window/dashboard-popout-window', () => ({
  createOrFocusDashboardPopout: vi.fn(),
  getDashboardPopoutWindow: getPopoutMock,
  onDashboardPopoutOpenChanged: vi.fn()
}))
vi.mock('../window/focus-existing-window', () => ({ safelyRevealWindow: safelyRevealMock }))

import { registerDashboardPopoutHandlers } from './dashboard-popout'

function makeWindow() {
  return { isDestroyed: () => false, webContents: { send: vi.fn() } }
}

const SNAPSHOT = { generatedAt: 1, cards: [] }

describe('registerDashboardPopoutHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    registerDashboardPopoutHandlers({} as never)
  })
  afterEach(() => {
    vi.clearAllMocks()
    getPopoutMock.mockReturnValue(null)
    getAllWindowsMock.mockReturnValue([])
  })

  it('caches and forwards a published snapshot to the popout', () => {
    const popout = makeWindow()
    getPopoutMock.mockReturnValue(popout)
    handlers.get('dashboard:publishSnapshot')!({} as never, SNAPSHOT)
    expect(popout.webContents.send).toHaveBeenCalledWith('dashboard:snapshot', SNAPSHOT)
  })

  it('replays the cached snapshot and nudges the main renderer on request', () => {
    const popout = makeWindow()
    const main = makeWindow()
    getPopoutMock.mockReturnValue(popout)
    getAllWindowsMock.mockReturnValue([main, popout])
    handlers.get('dashboard:publishSnapshot')!({} as never, SNAPSHOT)

    const sender = { send: vi.fn() }
    handlers.get('dashboard:requestSnapshot')!({ sender } as never)
    expect(sender.send).toHaveBeenCalledWith('dashboard:snapshot', SNAPSHOT)
    // The main (non-popout) window is asked to publish fresh; the popout is not.
    expect(main.webContents.send).toHaveBeenCalledWith('dashboard:snapshotRequested')
    expect(popout.webContents.send).not.toHaveBeenCalledWith('dashboard:snapshotRequested')
  })

  it('reports popout open state', () => {
    expect(handlers.get('dashboard:getPopoutOpen')!({} as never)).toBe(false)
    getPopoutMock.mockReturnValue(makeWindow())
    expect(handlers.get('dashboard:getPopoutOpen')!({} as never)).toBe(true)
  })

  it('relays seen-acks to the main window, never the popout', () => {
    const popout = makeWindow()
    const main = makeWindow()
    getPopoutMock.mockReturnValue(popout)
    getAllWindowsMock.mockReturnValue([main, popout])

    handlers.get('dashboardPopout:ackAgent')!({} as never, { paneKey: 'tab1:leaf1' })
    expect(main.webContents.send).toHaveBeenCalledWith('ui:ackDashboardAgent', 'tab1:leaf1')
    expect(popout.webContents.send).not.toHaveBeenCalled()

    // Malformed payloads are dropped.
    main.webContents.send.mockClear()
    handlers.get('dashboardPopout:ackAgent')!({} as never, { paneKey: '' })
    handlers.get('dashboardPopout:ackAgent')!({} as never, null)
    expect(main.webContents.send).not.toHaveBeenCalled()
  })

  it('reveals the agent in the main window, never the popout', () => {
    const popout = makeWindow()
    const main = makeWindow()
    getPopoutMock.mockReturnValue(popout)
    getAllWindowsMock.mockReturnValue([main, popout])

    const args = { repoId: 'r1', worktreeId: 'w1', tabId: 't1', leafId: 'l1' }
    handlers.get('dashboardPopout:revealAgent')!({} as never, args)

    expect(safelyRevealMock).toHaveBeenCalledWith(main)
    expect(safelyRevealMock).not.toHaveBeenCalledWith(popout)
    expect(main.webContents.send).toHaveBeenCalledWith('ui:revealDashboardAgent', args)
    expect(popout.webContents.send).not.toHaveBeenCalledWith('ui:revealDashboardAgent', args)
    expect(appMock.focus).toHaveBeenCalled()
  })
})
