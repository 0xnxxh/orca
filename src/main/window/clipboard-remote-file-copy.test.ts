import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  cleanupLegacyRemoteClipboardStagingMock,
  createRemoteClipboardTransferDirectoryMock,
  downloadFileMock,
  requireSshFilesystemProviderMock,
  spanFailMock,
  startSpanMock
} = vi.hoisted(() => {
  const spanFailMock = vi.fn()
  return {
    cleanupLegacyRemoteClipboardStagingMock: vi.fn(async () => undefined),
    createRemoteClipboardTransferDirectoryMock: vi.fn(),
    downloadFileMock: vi.fn(),
    requireSshFilesystemProviderMock: vi.fn(),
    spanFailMock,
    startSpanMock: vi.fn(() => ({ fail: spanFailMock }))
  }
})

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('../providers/ssh-filesystem-dispatch', () => ({
  requireSshFilesystemProvider: requireSshFilesystemProviderMock
}))
vi.mock('../observability/tracer', () => ({ startSpan: startSpanMock }))
vi.mock('./clipboard-file-copy', () => ({ writeFileToClipboard: vi.fn() }))
vi.mock('./clipboard-remote-file-staging', () => ({
  cleanupExpiredRemoteClipboardStaging: vi.fn(async () => undefined),
  cleanupLegacyRemoteClipboardStaging: cleanupLegacyRemoteClipboardStagingMock,
  createRemoteClipboardTransferDirectory: createRemoteClipboardTransferDirectoryMock,
  removeRemoteClipboardTransferDirectory: vi.fn(),
  scheduleRemoteClipboardTransferCleanup: vi.fn()
}))

import {
  scheduleLegacyRemoteClipboardFileCleanup,
  writeRemoteFileToClipboard
} from './clipboard-remote-file-copy'

beforeEach(() => {
  vi.clearAllMocks()
  requireSshFilesystemProviderMock.mockReturnValue({
    stat: vi.fn(async () => ({ type: 'file' })),
    downloadFile: downloadFileMock
  })
})

describe('remote clipboard staging failures', () => {
  it('returns a toast-safe reason and records path-conflict diagnostics', async () => {
    const error = Object.assign(new Error('mkdir failed'), { code: 'EEXIST' })
    createRemoteClipboardTransferDirectoryMock.mockRejectedValueOnce(error)

    await expect(
      writeRemoteFileToClipboard({
        remotePath: '/repo/readme.md',
        connectionId: 'ssh-1',
        deps: {
          platform: 'win32',
          writeBuffer: vi.fn(),
          runCommand: vi.fn()
        }
      })
    ).resolves.toEqual({ ok: false, reason: 'staging-unavailable' })

    expect(startSpanMock).toHaveBeenCalledWith('clipboard.remote_staging_init', {
      attributes: {
        operation: 'create',
        platform: process.platform,
        failure_category: 'path-conflict'
      }
    })
    expect(spanFailMock).toHaveBeenCalledWith(error)
    expect(downloadFileMock).not.toHaveBeenCalled()
  })
})

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
