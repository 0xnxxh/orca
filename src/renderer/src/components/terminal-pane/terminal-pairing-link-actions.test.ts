import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePairingOffer } from '../../../../shared/pairing'
import { copyTerminalPairingLink } from './terminal-pairing-link-actions'

const mocks = vi.hoisted(() => ({
  writeClipboardText: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError
  }
}))

describe('copyTerminalPairingLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.writeClipboardText.mockResolvedValue(undefined)
    vi.stubGlobal('window', { api: { ui: { writeClipboardText: mocks.writeClipboardText } } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('copies the access link and confirms success', async () => {
    const accessLink = encodePairingOffer({
      v: 2,
      endpoint: 'ws://192.168.1.10:6768',
      deviceToken: 'device-token',
      publicKeyB64: 'public-key'
    })

    expect(copyTerminalPairingLink(accessLink)).toBe(true)
    expect(mocks.writeClipboardText).toHaveBeenCalledExactlyOnceWith(accessLink)
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('Access link copied'))
  })

  it('reports clipboard failures', async () => {
    const accessLink = encodePairingOffer({
      v: 2,
      endpoint: 'ws://192.168.1.10:6768',
      deviceToken: 'device-token',
      publicKeyB64: 'public-key'
    })
    mocks.writeClipboardText.mockRejectedValueOnce(new Error('clipboard unavailable'))

    expect(copyTerminalPairingLink(accessLink)).toBe(true)
    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('Failed to copy access link')
    )
  })

  it('does not route malformed or mobile-only pairing links', () => {
    const mobileLink = encodePairingOffer({
      v: 2,
      endpoint: 'ws://192.168.1.10:6768',
      deviceToken: 'device-token',
      publicKeyB64: 'public-key',
      scope: 'mobile'
    })

    expect(copyTerminalPairingLink('orca://unknown?code=secret')).toBe(false)
    expect(copyTerminalPairingLink(mobileLink)).toBe(false)
    expect(mocks.writeClipboardText).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})
