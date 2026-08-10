import { afterEach, describe, expect, it, vi } from 'vitest'

const { cleanupLegacyRemoteClipboardStagingMock } = vi.hoisted(() => ({
  cleanupLegacyRemoteClipboardStagingMock: vi.fn(async () => undefined)
}))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('../providers/ssh-filesystem-dispatch', () => ({
  requireSshFilesystemProvider: vi.fn()
}))
vi.mock('./clipboard-file-copy', () => ({ writeFileToClipboard: vi.fn() }))
vi.mock('./clipboard-remote-file-staging', () => ({
  cleanupExpiredRemoteClipboardStaging: vi.fn(async () => undefined),
  cleanupLegacyRemoteClipboardStaging: cleanupLegacyRemoteClipboardStagingMock,
  createRemoteClipboardTransferDirectory: vi.fn(),
  removeRemoteClipboardTransferDirectory: vi.fn(),
  scheduleRemoteClipboardTransferCleanup: vi.fn()
}))

import { scheduleLegacyRemoteClipboardFileCleanup } from './clipboard-remote-file-copy'

describe('legacy remote clipboard cleanup scheduling', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('runs the shared-root compatibility scan once after the startup delay', async () => {
    vi.useFakeTimers()
    vi.spyOn(Date, 'now').mockReturnValue(1_760_000_000_000)

    scheduleLegacyRemoteClipboardFileCleanup()
    scheduleLegacyRemoteClipboardFileCleanup()
    await vi.advanceTimersByTimeAsync(29_999)

    expect(cleanupLegacyRemoteClipboardStagingMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(cleanupLegacyRemoteClipboardStagingMock).toHaveBeenCalledOnce()
    expect(cleanupLegacyRemoteClipboardStagingMock).toHaveBeenCalledWith('/tmp', 1_760_000_000_000)
  })
})
