import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cookie } from 'electron'

const { webContentsFromIdMock, rendererSendMock } = vi.hoisted(() => ({
  webContentsFromIdMock: vi.fn(),
  rendererSendMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/downloads') },
  BrowserWindow: { fromWebContents: vi.fn() },
  clipboard: { writeText: vi.fn() },
  shell: { openExternal: vi.fn() },
  Menu: { buildFromTemplate: vi.fn() },
  screen: { getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })) },
  webContents: { fromId: webContentsFromIdMock }
}))

import { browserManager } from './browser-manager'

const MISMATCH_URL =
  'https://accounts.google.com/CookieMismatch?continue=https%3A%2F%2Fmail.google.com%2Fmail%2F'
const RENDERER_WEB_CONTENTS_ID = 6001

function cookie(domain: string, name: string): Cookie {
  return { domain, name, path: '/', secure: true, sameSite: 'unspecified', value: 'secret' }
}

type Guest = {
  webContents: Electron.WebContents
  emit: (event: string, ...args: unknown[]) => void
  cookieRemove: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
}

type Partition = { cookies: { get: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } }

// Why: one session object shared by every tab in the partition — its identity is what the
// prompt throttle keys on.
function createPartition(): Partition {
  return {
    cookies: {
      get: vi
        .fn()
        .mockResolvedValue([
          cookie('.google.com', 'SID'),
          cookie('accounts.google.com', 'LSID'),
          cookie('.github.com', 'user_session')
        ]),
      remove: vi.fn().mockResolvedValue(undefined)
    }
  }
}

function createGuest(id: number, session: Partition = createPartition()): Guest {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>()
  const loadURL = vi.fn().mockResolvedValue(undefined)
  let currentUrl = 'about:blank'
  const webContents = {
    id,
    isDestroyed: vi.fn(() => false),
    getType: vi.fn(() => 'webview'),
    setBackgroundThrottling: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    openDevTools: vi.fn(),
    getURL: vi.fn(() => currentUrl),
    loadURL,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
    }),
    off: vi.fn(),
    session
  } as unknown as Electron.WebContents
  return {
    webContents,
    emit: (event, ...args) => {
      if (event === 'did-navigate' && typeof args[1] === 'string') {
        currentUrl = args[1]
      }
      for (const handler of handlers.get(event) ?? []) {
        handler(...args)
      }
    },
    cookieRemove: session.cookies.remove,
    loadURL
  }
}

function register(guest: Guest, browserPageId: string): void {
  browserManager.attachGuestPolicies(guest.webContents)
  browserManager.registerGuest({
    browserPageId,
    webContentsId: guest.webContents.id,
    rendererWebContentsId: RENDERER_WEB_CONTENTS_ID
  })
}

describe('browserManager Google CookieMismatch prompt', () => {
  beforeEach(() => {
    webContentsFromIdMock.mockReset()
    rendererSendMock.mockReset()
    browserManager.unregisterAll()
    browserManager.setSettingsResolver(() => ({}))
  })

  function mount(guests: Guest[]): void {
    webContentsFromIdMock.mockImplementation((id: number) => {
      if (id === RENDERER_WEB_CONTENTS_ID) {
        return { isDestroyed: vi.fn(() => false), send: rendererSendMock }
      }
      return guests.find((guest) => guest.webContents.id === id)?.webContents ?? null
    })
  }

  it('prompts the renderer on a committed mismatch navigation without clearing anything', () => {
    const guest = createGuest(701)
    mount([guest])
    register(guest, 'browser-1')

    guest.emit('did-navigate', {}, MISMATCH_URL)

    expect(rendererSendMock).toHaveBeenCalledWith('browser:google-cookie-mismatch-detected', {
      browserPageId: 'browser-1',
      active: true
    })
    // The destructive half waits for the user's click.
    expect(guest.cookieRemove).not.toHaveBeenCalled()
    expect(guest.loadURL).not.toHaveBeenCalled()
  })

  it('ignores navigations that are not the CookieMismatch page', () => {
    const guest = createGuest(702)
    mount([guest])
    register(guest, 'browser-1')

    guest.emit('did-navigate', {}, 'https://accounts.google.com/signin')

    expect(rendererSendMock).not.toHaveBeenCalled()
  })

  it('prompts once per partition even when the mismatch recurs across tabs', () => {
    const partition = createPartition()
    const first = createGuest(703, partition)
    const second = createGuest(704, partition)
    mount([first, second])
    register(first, 'browser-1')
    register(second, 'browser-2')

    first.emit('did-navigate', {}, MISMATCH_URL)
    first.emit('did-navigate', {}, MISMATCH_URL)
    second.emit('did-navigate', {}, MISMATCH_URL)

    expect(
      rendererSendMock.mock.calls.filter(
        ([channel]) => channel === 'browser:google-cookie-mismatch-detected'
      )
    ).toHaveLength(1)
  })

  it('prompts separately for a different partition', () => {
    const first = createGuest(705)
    const second = createGuest(706)
    mount([first, second])
    register(first, 'browser-1')
    register(second, 'browser-2')

    first.emit('did-navigate', {}, MISMATCH_URL)
    second.emit('did-navigate', {}, MISMATCH_URL)

    expect(
      rendererSendMock.mock.calls.filter(
        ([channel]) => channel === 'browser:google-cookie-mismatch-detected'
      )
    ).toHaveLength(2)
  })

  it('does not consume the partition prompt throttle before a renderer is eligible', () => {
    const partition = createPartition()
    const unregistered = createGuest(710, partition)
    const registered = createGuest(711, partition)
    mount([unregistered, registered])
    browserManager.attachGuestPolicies(unregistered.webContents)
    register(registered, 'browser-2')

    unregistered.emit('did-navigate', {}, MISMATCH_URL)
    registered.emit('did-navigate', {}, MISMATCH_URL)

    expect(rendererSendMock).toHaveBeenCalledWith('browser:google-cookie-mismatch-detected', {
      browserPageId: 'browser-2',
      active: true
    })
  })

  it('prompts when a guest registers after committing the mismatch page', () => {
    const guest = createGuest(712)
    mount([guest])
    browserManager.attachGuestPolicies(guest.webContents)
    guest.emit('did-navigate', {}, MISMATCH_URL)

    browserManager.registerGuest({
      browserPageId: 'browser-1',
      webContentsId: guest.webContents.id,
      rendererWebContentsId: RENDERER_WEB_CONTENTS_ID
    })

    expect(rendererSendMock).toHaveBeenCalledWith('browser:google-cookie-mismatch-detected', {
      browserPageId: 'browser-1',
      active: true
    })
  })

  it('invalidates the reset and dismisses its prompt after navigating away', async () => {
    const guest = createGuest(713)
    mount([guest])
    register(guest, 'browser-1')
    guest.emit('did-navigate', {}, MISMATCH_URL)
    rendererSendMock.mockClear()

    guest.emit('did-navigate', {}, 'https://example.com/')

    expect(rendererSendMock).toHaveBeenCalledWith('browser:google-cookie-mismatch-detected', {
      browserPageId: 'browser-1',
      active: false
    })
    await expect(browserManager.recoverFromGoogleCookieMismatch('browser-1')).resolves.toBe(false)
    expect(guest.cookieRemove).not.toHaveBeenCalled()
    expect(guest.loadURL).not.toHaveBeenCalled()
  })

  it('moves the partition prompt to another mismatched tab when its owner leaves', () => {
    const partition = createPartition()
    const first = createGuest(715, partition)
    const second = createGuest(716, partition)
    mount([first, second])
    register(first, 'browser-1')
    register(second, 'browser-2')
    first.emit('did-navigate', {}, MISMATCH_URL)
    second.emit('did-navigate', {}, MISMATCH_URL)
    rendererSendMock.mockClear()

    first.emit('did-navigate', {}, 'https://example.com/')

    expect(rendererSendMock.mock.calls).toEqual([
      ['browser:google-cookie-mismatch-detected', { browserPageId: 'browser-1', active: false }],
      ['browser:google-cookie-mismatch-detected', { browserPageId: 'browser-2', active: true }]
    ])
  })

  it('moves the partition prompt when its owning guest is torn down', () => {
    const partition = createPartition()
    const first = createGuest(717, partition)
    const second = createGuest(718, partition)
    mount([first, second])
    register(first, 'browser-1')
    register(second, 'browser-2')
    first.emit('did-navigate', {}, MISMATCH_URL)
    second.emit('did-navigate', {}, MISMATCH_URL)
    rendererSendMock.mockClear()

    browserManager.unregisterGuest('browser-1')

    expect(rendererSendMock.mock.calls).toEqual([
      ['browser:google-cookie-mismatch-detected', { browserPageId: 'browser-1', active: false }],
      ['browser:google-cookie-mismatch-detected', { browserPageId: 'browser-2', active: true }]
    ])
  })

  it('clears only Google cookies and reloads the flow when the user accepts', async () => {
    const guest = createGuest(707)
    mount([guest])
    register(guest, 'browser-1')
    guest.emit('did-navigate', {}, MISMATCH_URL)

    await expect(browserManager.recoverFromGoogleCookieMismatch('browser-1')).resolves.toBe(true)

    expect(guest.cookieRemove.mock.calls).toEqual([
      ['https://google.com/', 'SID'],
      ['https://accounts.google.com/', 'LSID']
    ])
    expect(guest.loadURL).toHaveBeenCalledWith('https://mail.google.com/mail/')
  })

  it('refuses to clear when no mismatch was detected for the tab', async () => {
    const guest = createGuest(708)
    mount([guest])
    register(guest, 'browser-1')

    await expect(browserManager.recoverFromGoogleCookieMismatch('browser-1')).resolves.toBe(false)
    await expect(browserManager.recoverFromGoogleCookieMismatch('browser-unknown')).resolves.toBe(
      false
    )

    expect(guest.cookieRemove).not.toHaveBeenCalled()
    expect(guest.loadURL).not.toHaveBeenCalled()
  })

  it('does not re-clear on a repeated accept for the same detection', async () => {
    const guest = createGuest(709)
    mount([guest])
    register(guest, 'browser-1')
    guest.emit('did-navigate', {}, MISMATCH_URL)

    await browserManager.recoverFromGoogleCookieMismatch('browser-1')
    guest.cookieRemove.mockClear()

    await expect(browserManager.recoverFromGoogleCookieMismatch('browser-1')).resolves.toBe(false)
    expect(guest.cookieRemove).not.toHaveBeenCalled()
  })

  it('does not navigate a retired guest after an in-flight cookie clear', async () => {
    let resolveCookies: ((cookies: Cookie[]) => void) | undefined
    const partition = createPartition()
    partition.cookies.get.mockImplementation(
      () => new Promise<Cookie[]>((resolve) => (resolveCookies = resolve))
    )
    const guest = createGuest(714, partition)
    mount([guest])
    register(guest, 'browser-1')
    guest.emit('did-navigate', {}, MISMATCH_URL)

    const recovery = browserManager.recoverFromGoogleCookieMismatch('browser-1')
    browserManager.unregisterGuest('browser-1')
    resolveCookies?.([])

    await expect(recovery).resolves.toBe(false)
    expect(guest.loadURL).not.toHaveBeenCalled()
  })

  it('does not overwrite a newer navigation after an in-flight cookie clear', async () => {
    let resolveCookies: ((cookies: Cookie[]) => void) | undefined
    const partition = createPartition()
    partition.cookies.get.mockImplementation(
      () => new Promise<Cookie[]>((resolve) => (resolveCookies = resolve))
    )
    const guest = createGuest(719, partition)
    mount([guest])
    register(guest, 'browser-1')
    guest.emit('did-navigate', {}, MISMATCH_URL)

    const recovery = browserManager.recoverFromGoogleCookieMismatch('browser-1')
    guest.emit('did-navigate', {}, 'https://example.com/')
    resolveCookies?.([])

    await expect(recovery).resolves.toBe(false)
    expect(guest.loadURL).not.toHaveBeenCalled()
  })
})
