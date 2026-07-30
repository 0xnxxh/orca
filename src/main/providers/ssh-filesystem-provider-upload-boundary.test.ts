import { afterEach, describe, expect, it, vi } from 'vitest'

function createMockMux() {
  return {
    request: vi.fn(),
    onNotification: vi.fn(() => () => {})
  }
}

afterEach(() => {
  vi.doUnmock('../ssh/sftp-upload')
  vi.resetModules()
})

describe('SshFilesystemProvider upload boundary', () => {
  it('does not load the SFTP upload capability for raw transfers', async () => {
    let capabilityLoaded = false
    vi.doMock('../ssh/sftp-upload', () => {
      capabilityLoaded = true
      return {
        uploadBuffer: vi.fn(),
        uploadFile: vi.fn()
      }
    })
    const { SshFilesystemProvider } = await import('./ssh-filesystem-provider')
    const writeBuffer = vi.fn().mockResolvedValue(undefined)
    const rawSession = { uploadFile: vi.fn(), close: vi.fn() }
    const provider = new SshFilesystemProvider('conn-1', createMockMux() as never, undefined, {
      writeBuffer,
      openFileUploadSession: vi.fn().mockResolvedValue(rawSession)
    })

    await provider.writeFileBase64Chunk('/remote/image.png', 'cG5n', true)
    await expect(provider.openFileUploadSession()).resolves.toBe(rawSession)

    expect(capabilityLoaded).toBe(false)
    expect(writeBuffer).toHaveBeenCalledWith('/remote/image.png', Buffer.from('png'), {
      append: true,
      exclusive: false
    })
  })

  it('loads binary SFTP uploads on demand and preserves write flags', async () => {
    const uploadBuffer = vi.fn().mockResolvedValue(undefined)
    let capabilityLoads = 0
    vi.doMock('../ssh/sftp-upload', () => {
      capabilityLoads += 1
      return {
        uploadBuffer,
        uploadFile: vi.fn()
      }
    })
    const { SshFilesystemProvider } = await import('./ssh-filesystem-provider')
    const sftp = { end: vi.fn() }
    const provider = new SshFilesystemProvider(
      'conn-1',
      createMockMux() as never,
      vi.fn().mockResolvedValue(sftp) as never
    )

    expect(capabilityLoads).toBe(0)
    await provider.writeFileBase64Chunk('/remote/image.png', 'cG5n', true)

    expect(capabilityLoads).toBe(1)
    expect(uploadBuffer).toHaveBeenCalledWith(sftp, Buffer.from('png'), '/remote/image.png', {
      append: true,
      exclusive: false
    })
    expect(sftp.end).toHaveBeenCalledOnce()
  })

  it('loads file SFTP uploads when a session opens and keeps its session semantics', async () => {
    const uploadFile = vi.fn().mockResolvedValue(undefined)
    let capabilityLoads = 0
    vi.doMock('../ssh/sftp-upload', () => {
      capabilityLoads += 1
      return {
        uploadBuffer: vi.fn(),
        uploadFile
      }
    })
    const { SshFilesystemProvider } = await import('./ssh-filesystem-provider')
    const sftp = { end: vi.fn() }
    const provider = new SshFilesystemProvider(
      'conn-1',
      createMockMux() as never,
      vi.fn().mockResolvedValue(sftp) as never
    )

    expect(capabilityLoads).toBe(0)
    const session = await provider.openFileUploadSession()
    await session.uploadFile('/local/image.png', '/remote/image.png', { exclusive: true })
    session.close()

    expect(capabilityLoads).toBe(1)
    expect(uploadFile).toHaveBeenCalledWith(sftp, '/local/image.png', '/remote/image.png', {
      exclusive: true
    })
    expect(sftp.end).toHaveBeenCalledOnce()
  })
})
