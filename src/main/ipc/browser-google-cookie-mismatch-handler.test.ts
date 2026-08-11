import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthorizedGuestMock, handleMock, recoverFromGoogleCookieMismatchMock } = vi.hoisted(
  () => ({
    getAuthorizedGuestMock: vi.fn(),
    handleMock: vi.fn(),
    recoverFromGoogleCookieMismatchMock: vi.fn()
  })
)

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  ipcMain: { removeHandler: vi.fn(), handle: handleMock },
  webContents: { fromId: vi.fn(() => ({ isDestroyed: () => false })) }
}))

vi.mock('../browser/browser-manager', () => ({
  browserCertificateTrustController: { proceed: vi.fn() },
  browserManager: {
    registerGuest: vi.fn(() => true),
    attachGuestPolicies: vi.fn(),
    unregisterGuest: vi.fn(),
    getGuestWebContentsId: vi.fn(),
    getWebContentsIdByTabId: vi.fn(() => new Map()),
    getWorktreeIdForTab: vi.fn(),
    getAuthorizedGuest: getAuthorizedGuestMock,
    setGrabMode: vi.fn(),
    openDevTools: vi.fn(),
    setAnnotationViewportBridge: vi.fn(),
    cancelDownload: vi.fn(),
    recoverFromGoogleCookieMismatch: recoverFromGoogleCookieMismatchMock
  }
}))

import { registerBrowserHandlers } from './browser'

type RecoverHandler = (
  event: { sender: Electron.WebContents },
  args: unknown
) => Promise<boolean> | boolean

const trustedSender = {
  id: 91,
  isDestroyed: () => false,
  getType: () => 'window',
  getURL: () => 'file:///renderer/index.html'
} as Electron.WebContents

describe('browser:recoverGoogleCookieMismatch', () => {
  let recover: RecoverHandler

  beforeEach(() => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    handleMock.mockReset()
    getAuthorizedGuestMock.mockReset()
    getAuthorizedGuestMock.mockReturnValue({})
    recoverFromGoogleCookieMismatchMock.mockReset()
    recoverFromGoogleCookieMismatchMock.mockResolvedValue(true)
    registerBrowserHandlers()
    recover = handleMock.mock.calls.find(
      ([channel]) => channel === 'browser:recoverGoogleCookieMismatch'
    )?.[1] as RecoverHandler
  })

  it('runs the reset for the trusted renderer', async () => {
    await expect(recover({ sender: trustedSender }, { browserPageId: 'page-1' })).resolves.toBe(
      true
    )
    expect(recoverFromGoogleCookieMismatchMock).toHaveBeenCalledWith('page-1')
    expect(getAuthorizedGuestMock).toHaveBeenCalledWith('page-1', trustedSender.id)
  })

  it('rejects a trusted renderer that does not own the requested page', async () => {
    getAuthorizedGuestMock.mockReturnValue(null)

    await expect(recover({ sender: trustedSender }, { browserPageId: 'page-1' })).resolves.toBe(
      false
    )

    expect(recoverFromGoogleCookieMismatchMock).not.toHaveBeenCalled()
  })

  it('rejects untrusted senders and malformed arguments', async () => {
    const guestSender = {
      id: 92,
      isDestroyed: () => false,
      getType: () => 'webview',
      getURL: () => 'https://accounts.google.com/CookieMismatch'
    } as Electron.WebContents

    await expect(recover({ sender: guestSender }, { browserPageId: 'page-1' })).resolves.toBe(false)
    for (const args of [null, {}, { browserPageId: 7 }]) {
      await expect(recover({ sender: trustedSender }, args)).resolves.toBe(false)
    }
    expect(recoverFromGoogleCookieMismatchMock).not.toHaveBeenCalled()
  })
})
