import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyDocumentUpload: vi.fn(),
  verifyClipboardPaste: vi.fn(),
  verifyPhotoDenial: vi.fn()
}))

vi.mock('../../scripts/hosted-ios-document-upload.mjs', () => ({
  verifyHostedIosDocumentUpload: mocks.verifyDocumentUpload
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

  it('carries the exact session and terminal through Photos denial and document upload', async () => {
    const args = {
      deviceUdid: 'simulator',
      emulator: {},
      worktree: '/repo/mobile-rearch',
      workspaceDocument: { href: 'workspace' }
    }
    const documentFixture = {
      destinationPath: '/simulator/fixture.png',
      fixtureName: 'fixture.png'
    }
    const seedFixture = vi.fn().mockResolvedValue(documentFixture)
    const removeFixture = vi.fn().mockResolvedValue(undefined)
    const terminalClipboardPaste = {
      evidence: { terminalHandle: 'terminal-handle' },
      sessionDocument: { href: 'session' }
    }
    const photoPermissionDenial = {
      evidence: { toast: 'Photo permission denied' },
      sessionDocument: terminalClipboardPaste.sessionDocument
    }
    const documentUpload = {
      evidence: { terminalPathInjected: true },
      sessionDocument: terminalClipboardPaste.sessionDocument
    }
    mocks.verifyClipboardPaste.mockResolvedValue(terminalClipboardPaste)
    mocks.verifyPhotoDenial.mockResolvedValue(photoPermissionDenial)
    mocks.verifyDocumentUpload.mockResolvedValue(documentUpload)

    await expect(
      verifyHostedIosTerminalDeviceInputJourney(args, {
        removeFixture,
        seedFixture
      })
    ).resolves.toEqual({
      documentUpload,
      photoPermissionDenial,
      terminalClipboardPaste
    })
    expect(seedFixture).toHaveBeenCalledWith({
      deviceUdid: 'simulator',
      fixturePath: '/repo/mobile-rearch/mobile/assets/favicon.png'
    })
    expect(mocks.verifyPhotoDenial).toHaveBeenCalledWith({
      ...args,
      sessionDocument: documentUpload.sessionDocument,
      terminalHandle: 'terminal-handle'
    })
    expect(mocks.verifyDocumentUpload).toHaveBeenCalledWith({
      ...args,
      documentFixture,
      sessionDocument: terminalClipboardPaste.sessionDocument,
      terminalHandle: 'terminal-handle'
    })
    expect(removeFixture).toHaveBeenCalledWith(documentFixture.destinationPath)
  })
})
