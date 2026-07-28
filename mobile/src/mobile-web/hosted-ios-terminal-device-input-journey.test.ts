import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyClipboardPaste: vi.fn(),
  verifyPhotoDenial: vi.fn()
}))

vi.mock('../../scripts/hosted-ios-terminal-clipboard-paste.mjs', () => ({
  verifyHostedIosTerminalClipboardPaste: mocks.verifyClipboardPaste
}))
vi.mock('../../scripts/hosted-ios-photo-permission-denial.mjs', () => ({
  verifyHostedIosPhotoPermissionDenial: mocks.verifyPhotoDenial
}))

import { verifyHostedIosTerminalDeviceInputJourney } from '../../scripts/hosted-ios-terminal-device-input-journey.mjs'

describe('hosted iOS terminal device-input journey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('carries the exact clipboard session and terminal into Photos denial', async () => {
    const args = { emulator: {}, workspaceDocument: { href: 'workspace' } }
    const terminalClipboardPaste = {
      evidence: { terminalHandle: 'terminal-handle' },
      sessionDocument: { href: 'session' }
    }
    const photoPermissionDenial = {
      evidence: { toast: 'Photo permission denied' },
      sessionDocument: terminalClipboardPaste.sessionDocument
    }
    mocks.verifyClipboardPaste.mockResolvedValue(terminalClipboardPaste)
    mocks.verifyPhotoDenial.mockResolvedValue(photoPermissionDenial)

    await expect(verifyHostedIosTerminalDeviceInputJourney(args)).resolves.toEqual({
      photoPermissionDenial,
      terminalClipboardPaste
    })
    expect(mocks.verifyPhotoDenial).toHaveBeenCalledWith({
      ...args,
      sessionDocument: terminalClipboardPaste.sessionDocument,
      terminalHandle: 'terminal-handle'
    })
  })
})
