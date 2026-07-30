import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRemoteHostPlatform } from './ssh-remote-platform'

afterEach(() => {
  vi.doUnmock('./sftp-upload')
  vi.doUnmock('./sftp-namespace-resolution')
  vi.resetModules()
})

function createSftp() {
  const sftp = new EventEmitter() as EventEmitter & { end: ReturnType<typeof vi.fn> }
  sftp.end = vi.fn(() => sftp.emit('close'))
  return sftp
}

describe('relay install SFTP transfers', () => {
  it('keeps system SSH transfers outside the SFTP upload capability', async () => {
    let capabilityLoaded = false
    vi.doMock('./sftp-upload', () => {
      capabilityLoaded = true
      return {
        uploadDirectory: vi.fn(),
        writeStringViaSftp: vi.fn()
      }
    })
    const { uploadRelayDirectory, writeRelayFile } = await import('./ssh-relay-install-transfers')
    const uploadDirectory = vi.fn().mockResolvedValue(undefined)
    const writeFile = vi.fn().mockResolvedValue(undefined)
    const conn = { uploadDirectory, writeFile }
    const hostPlatform = getRemoteHostPlatform('linux-x64')
    const signal = new AbortController().signal

    await uploadRelayDirectory(conn as never, '/local/relay', '/shell/relay', hostPlatform, {
      signal
    })
    await writeRelayFile(conn as never, hostPlatform, '/shell/relay/.version', '1.2.3', { signal })

    expect(capabilityLoaded).toBe(false)
    expect(uploadDirectory).toHaveBeenCalledWith('/local/relay', '/shell/relay', {
      hostPlatform,
      signal,
      sftpNamespace: undefined
    })
    expect(writeFile).toHaveBeenCalledWith('/shell/relay/.version', '1.2.3', {
      hostPlatform,
      signal,
      sftpNamespace: undefined
    })
  })

  it('loads fallback transfers on demand after resolving the SFTP namespace', async () => {
    const uploadDirectory = vi.fn().mockResolvedValue(undefined)
    const writeStringViaSftp = vi.fn().mockResolvedValue(undefined)
    let capabilityLoads = 0
    vi.doMock('./sftp-upload', () => {
      capabilityLoads += 1
      return { uploadDirectory, writeStringViaSftp }
    })
    const resolveSftpTransferPathIfMapped = vi
      .fn()
      .mockResolvedValueOnce('/mapped/relay')
      .mockResolvedValueOnce('/mapped/relay/.version')
    vi.doMock('./sftp-namespace-resolution', () => ({
      resolveSftpTransferPathIfMapped
    }))
    const { uploadRelayDirectory, writeRelayFile } = await import('./ssh-relay-install-transfers')
    const firstSftp = createSftp()
    const secondSftp = createSftp()
    const conn = {
      sftp: vi.fn().mockResolvedValueOnce(firstSftp).mockResolvedValueOnce(secondSftp)
    }
    const hostPlatform = getRemoteHostPlatform('linux-x64')

    expect(capabilityLoads).toBe(0)
    await uploadRelayDirectory(conn as never, '/local/relay', '/shell/relay', hostPlatform)
    await writeRelayFile(conn as never, hostPlatform, '/shell/relay/.version', '1.2.3')

    expect(capabilityLoads).toBe(1)
    expect(uploadDirectory).toHaveBeenCalledWith(firstSftp, '/local/relay', '/mapped/relay')
    expect(writeStringViaSftp).toHaveBeenCalledWith(secondSftp, '/mapped/relay/.version', '1.2.3')
    expect(firstSftp.end).toHaveBeenCalledOnce()
    expect(secondSftp.end).toHaveBeenCalledOnce()
  })

  it('closes the fallback SFTP session when an upload is aborted', async () => {
    let startUpload: (() => void) | undefined
    const uploadStarted = new Promise<void>((resolve) => {
      startUpload = resolve
    })
    vi.doMock('./sftp-upload', () => ({
      uploadDirectory: vi.fn(() => {
        startUpload?.()
        return new Promise<void>(() => {})
      }),
      writeStringViaSftp: vi.fn()
    }))
    vi.doMock('./sftp-namespace-resolution', () => ({
      resolveSftpTransferPathIfMapped: vi.fn().mockResolvedValue('/mapped/relay')
    }))
    const { uploadRelayDirectory } = await import('./ssh-relay-install-transfers')
    const sftp = createSftp()
    const conn = { sftp: vi.fn().mockResolvedValue(sftp) }
    const controller = new AbortController()
    const transfer = uploadRelayDirectory(
      conn as never,
      '/local/relay',
      '/shell/relay',
      getRemoteHostPlatform('linux-x64'),
      { signal: controller.signal }
    )

    await uploadStarted
    controller.abort()

    await expect(transfer).rejects.toMatchObject({
      name: 'AbortError',
      sshChannelCloseConfirmed: true
    })
    expect(sftp.end).toHaveBeenCalledOnce()
  })
})
