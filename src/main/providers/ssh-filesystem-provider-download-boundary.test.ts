import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRemoteHostPlatform } from '../ssh/ssh-remote-platform'

function createMockMux() {
  return {
    request: vi.fn(),
    onNotification: vi.fn(() => () => {})
  }
}

afterEach(() => {
  vi.doUnmock('./ssh-filesystem-download')
  vi.resetModules()
})

describe('SshFilesystemProvider download boundary', () => {
  it('does not load the SFTP download capability for raw transfers', async () => {
    let capabilityLoaded = false
    vi.doMock('./ssh-filesystem-download', () => {
      capabilityLoaded = true
      return {
        downloadFileViaSftp: vi.fn(),
        downloadFolderViaSftp: vi.fn()
      }
    })
    const { SshFilesystemProvider } = await import('./ssh-filesystem-provider')
    const downloadFile = vi.fn().mockResolvedValue(undefined)
    const provider = new SshFilesystemProvider('conn-1', createMockMux() as never, undefined, {
      downloadFile
    })

    expect(capabilityLoaded).toBe(false)
    await provider.downloadFile('/remote/archive.zip', '/local/archive.zip')

    expect(capabilityLoaded).toBe(false)
    expect(downloadFile).toHaveBeenCalledWith('/remote/archive.zip', '/local/archive.zip')
  })

  it('loads folder downloads on demand and preserves Windows path mapping', async () => {
    const downloadFolderViaSftp = vi.fn().mockResolvedValue(undefined)
    let capabilityLoads = 0
    vi.doMock('./ssh-filesystem-download', () => {
      capabilityLoads += 1
      return {
        downloadFileViaSftp: vi.fn(),
        downloadFolderViaSftp
      }
    })
    const { SshFilesystemProvider } = await import('./ssh-filesystem-provider')
    const createSftp = vi.fn()
    const provider = new SshFilesystemProvider(
      'conn-1',
      createMockMux() as never,
      createSftp,
      undefined,
      getRemoteHostPlatform('win32-x64')
    )
    const controller = new AbortController()

    expect(capabilityLoads).toBe(0)
    await provider.downloadFolder!('C:\\remote\\src', 'C:\\local\\src', {
      signal: controller.signal
    })

    expect(capabilityLoads).toBe(1)
    expect(downloadFolderViaSftp).toHaveBeenCalledWith(
      createSftp,
      'C:\\remote\\src',
      'C:\\local\\src',
      { signal: controller.signal, windowsRemotePaths: true }
    )
  })
})
