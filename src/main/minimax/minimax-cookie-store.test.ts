import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as MiniMaxCookieStore from './minimax-cookie-store'

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(value)),
  decryptString: vi.fn((value: Buffer) => value.toString('utf8'))
}))

const electronMock = vi.hoisted(() => ({
  safeStorage: safeStorageMock
}))

vi.mock('electron', () => electronMock)

const existsSyncMock = vi.fn()
const readFileSyncMock = vi.fn()
const accessMock = vi.fn()
const readFileMock = vi.fn()
const hardenExistingSecureFileAsyncMock = vi.fn()
const removeSecureFileAsyncMock = vi.fn()
const writeSecureFileAsyncMock = vi.fn()
const homedirMock = vi.fn(() => '/home/test')

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock
}))

vi.mock('node:fs/promises', () => ({
  access: accessMock,
  readFile: readFileMock
}))

vi.mock('node:os', () => ({
  homedir: homedirMock
}))

vi.mock('node:path', () => ({
  join: (...parts: string[]) => parts.join('/')
}))

vi.mock('../../shared/secure-file', () => ({
  hardenExistingSecureFileAsync: hardenExistingSecureFileAsyncMock,
  removeSecureFileAsync: removeSecureFileAsyncMock,
  writeSecureFileAsync: writeSecureFileAsyncMock
}))

const storePath = '/home/test/.orca/minimax-session-cookie.enc'
const envelope = (kind: 'encrypted' | 'plaintext', value: string): string =>
  `orca-minimax-cookie:v1:${kind}:${Buffer.from(value, 'utf8').toString('base64')}`

function missingFileError(): NodeJS.ErrnoException {
  return Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
}

async function loadStore(): Promise<typeof MiniMaxCookieStore> {
  return await import('./minimax-cookie-store')
}

describe('minimax-cookie-store', () => {
  beforeEach(() => {
    existsSyncMock.mockReset()
    readFileSyncMock.mockReset()
    accessMock.mockReset()
    readFileMock.mockReset()
    hardenExistingSecureFileAsyncMock.mockReset()
    hardenExistingSecureFileAsyncMock.mockResolvedValue(undefined)
    removeSecureFileAsyncMock.mockReset()
    removeSecureFileAsyncMock.mockResolvedValue(undefined)
    writeSecureFileAsyncMock.mockReset()
    writeSecureFileAsyncMock.mockResolvedValue(undefined)
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value))
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf8'))
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('returns false when no file exists yet', async () => {
    existsSyncMock.mockReturnValue(false)
    const store = await loadStore()
    expect(store.hasMiniMaxSessionCookie()).toBe(false)
    expect(hardenExistingSecureFileAsyncMock).not.toHaveBeenCalled()
  })

  it('reports an existing cookie without hardening it', async () => {
    existsSyncMock.mockReturnValue(true)
    const store = await loadStore()
    expect(store.hasMiniMaxSessionCookie()).toBe(true)
    // Hardening is a write-time invariant; the status probe must stay a single syscall.
    expect(hardenExistingSecureFileAsyncMock).not.toHaveBeenCalled()
  })

  it('reports status asynchronously without touching sync fs', async () => {
    accessMock.mockResolvedValue(undefined)
    const store = await loadStore()
    await expect(store.hasMiniMaxSessionCookieAsync()).resolves.toBe(true)
    expect(accessMock).toHaveBeenCalledWith(storePath)
    expect(existsSyncMock).not.toHaveBeenCalled()

    accessMock.mockRejectedValue(missingFileError())
    await expect(store.hasMiniMaxSessionCookieAsync()).resolves.toBe(false)
  })

  it('writes the cookie using safeStorage when encryption is available', async () => {
    const store = await loadStore()
    await store.saveMiniMaxSessionCookieAsync('_token=abc; minimax_group_id_v2=42')
    expect(safeStorageMock.encryptString).toHaveBeenCalledWith('_token=abc; minimax_group_id_v2=42')
    expect(writeSecureFileAsyncMock).toHaveBeenCalledWith(
      storePath,
      envelope('encrypted', '_token=abc; minimax_group_id_v2=42')
    )
  })

  it('clears through the same per-path serializer the save uses', async () => {
    const store = await loadStore()
    await store.saveMiniMaxSessionCookieAsync('_token=async')

    await store.clearMiniMaxSessionCookieAsync()
    // A bare rm() would bypass secure-file's per-path chain and unlink before an
    // in-flight save's rename republished the cookie.
    expect(removeSecureFileAsyncMock).toHaveBeenCalledWith(storePath)

    readFileMock.mockRejectedValue(missingFileError())
    await expect(store.readMiniMaxSessionCookieAsync()).resolves.toBeNull()
  })

  it('does not resurrect a cleared cookie when a queued save lands after the clear', async () => {
    let releaseSave = (): void => undefined
    writeSecureFileAsyncMock.mockReturnValue(
      new Promise<void>((resolve) => {
        releaseSave = () => resolve()
      })
    )
    const store = await loadStore()

    const save = store.saveMiniMaxSessionCookieAsync('_token=queued')
    const clear = store.clearMiniMaxSessionCookieAsync()
    releaseSave()
    await Promise.all([save, clear])

    // The cache is the layer that leaks: readMiniMaxSessionCookie returns it without
    // ever reaching the (already removed) file.
    readFileSyncMock.mockImplementation(() => {
      throw missingFileError()
    })
    expect(store.readMiniMaxSessionCookie()).toBeNull()
  })

  it('warns and writes plaintext when safeStorage is unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = await loadStore()
    await store.saveMiniMaxSessionCookieAsync('_token=abc')
    expect(writeSecureFileAsyncMock).toHaveBeenCalledWith(
      storePath,
      envelope('plaintext', '_token=abc')
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('safeStorage encryption unavailable'))
    warn.mockRestore()
  })

  it('refuses empty cookies', async () => {
    const store = await loadStore()
    await expect(store.saveMiniMaxSessionCookieAsync('   ')).rejects.toThrow(/required/)
  })

  it('reads decrypted cookie from disk and caches it', async () => {
    readFileSyncMock.mockReturnValue(Buffer.from(envelope('encrypted', 'encrypted-payload')))
    safeStorageMock.decryptString.mockReturnValue('_token=cached; minimax_group_id_v2=9')
    const store = await loadStore()
    const first = store.readMiniMaxSessionCookie()
    const second = store.readMiniMaxSessionCookie()
    expect(first).toBe('_token=cached; minimax_group_id_v2=9')
    expect(second).toBe(first)
    expect(hardenExistingSecureFileAsyncMock).toHaveBeenCalledTimes(1)
    expect(hardenExistingSecureFileAsyncMock).toHaveBeenCalledWith(storePath)
    expect(safeStorageMock.decryptString).toHaveBeenCalledTimes(1)
    expect(safeStorageMock.decryptString).toHaveBeenCalledWith(Buffer.from('encrypted-payload'))
  })

  it('still returns the cookie when read-path hardening fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    hardenExistingSecureFileAsyncMock.mockRejectedValue(new Error('permission denied'))
    readFileMock.mockResolvedValue(Buffer.from(envelope('plaintext', '_token=hardening-failed')))
    const store = await loadStore()
    await expect(store.readMiniMaxSessionCookieAsync()).resolves.toBe('_token=hardening-failed')
    await Promise.resolve()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to harden MiniMax cookie file'),
      expect.any(Error)
    )
    warn.mockRestore()
  })

  it('returns null when no file exists', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw missingFileError()
    })
    const store = await loadStore()
    expect(store.readMiniMaxSessionCookie()).toBeNull()
    expect(existsSyncMock).not.toHaveBeenCalled()
  })

  it('returns enveloped plaintext when safeStorage is unavailable and reads succeed', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    readFileSyncMock.mockReturnValue(Buffer.from(envelope('plaintext', '_token=plaintext')))
    const store = await loadStore()
    expect(store.readMiniMaxSessionCookie()).toBe('_token=plaintext')
  })

  it('reads legacy plaintext cookies when decrypting is unavailable', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    readFileSyncMock.mockReturnValue(Buffer.from('_token=legacy'))
    const store = await loadStore()
    expect(store.readMiniMaxSessionCookie()).toBe('_token=legacy')
  })

  it('reads legacy plaintext cookies when decrypting fails', async () => {
    readFileSyncMock.mockReturnValue(Buffer.from('_token=legacy'))
    safeStorageMock.decryptString.mockImplementation(() => {
      throw new Error('boom')
    })
    const store = await loadStore()
    expect(store.readMiniMaxSessionCookie()).toBe('_token=legacy')
  })

  it('does not treat encrypted legacy bytes as plaintext when safeStorage is unavailable', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    readFileSyncMock.mockReturnValue(Buffer.from('encrypted-payload'))
    const store = await loadStore()
    expect(() => store.readMiniMaxSessionCookie()).toThrow(/could not be decrypted/)
  })

  it('throws for encrypted envelopes when safeStorage is unavailable', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    readFileSyncMock.mockReturnValue(Buffer.from(envelope('encrypted', 'encrypted-payload')))
    const store = await loadStore()
    expect(() => store.readMiniMaxSessionCookie()).toThrow(/could not be decrypted/)
  })

  it('throws when decryption fails', async () => {
    readFileSyncMock.mockReturnValue(Buffer.from(envelope('encrypted', 'encrypted-payload')))
    safeStorageMock.decryptString.mockImplementation(() => {
      throw new Error('boom')
    })
    const store = await loadStore()
    expect(() => store.readMiniMaxSessionCookie()).toThrow(/could not be decrypted/)
  })

  it('surfaces a non-ENOENT read failure as a decrypt failure', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
    })
    const store = await loadStore()
    expect(() => store.readMiniMaxSessionCookie()).toThrow(/could not be decrypted/)
  })

  it('clears the cached cookie and removes the file', async () => {
    readFileSyncMock.mockReturnValueOnce(Buffer.from(envelope('encrypted', 'encrypted-payload')))
    readFileSyncMock.mockImplementation(() => {
      throw missingFileError()
    })
    safeStorageMock.decryptString.mockReturnValueOnce('_token=preclear')
    const store = await loadStore()
    expect(store.readMiniMaxSessionCookie()).toBe('_token=preclear')
    await store.clearMiniMaxSessionCookieAsync()
    expect(removeSecureFileAsyncMock).toHaveBeenCalledWith(storePath)
    expect(store.readMiniMaxSessionCookie()).toBeNull()
  })
})
