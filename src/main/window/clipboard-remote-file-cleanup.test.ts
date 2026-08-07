import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

const { accessMock, lstatMock, mkdirMock, opendirMock, rmMock, statMock, writeFileMock } =
  vi.hoisted(() => ({
    accessMock: vi.fn(),
    lstatMock: vi.fn(),
    mkdirMock: vi.fn(),
    opendirMock: vi.fn(),
    rmMock: vi.fn(),
    statMock: vi.fn(),
    writeFileMock: vi.fn()
  }))

vi.mock('node:fs/promises', () => ({
  access: accessMock,
  lstat: lstatMock,
  mkdir: mkdirMock,
  opendir: opendirMock,
  rm: rmMock,
  stat: statMock,
  writeFile: writeFileMock
}))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('../providers/ssh-filesystem-dispatch', () => ({
  requireSshFilesystemProvider: vi.fn()
}))
vi.mock('./clipboard-file-copy', () => ({ writeFileToClipboard: vi.fn() }))

import {
  cleanupExpiredRemoteClipboardFiles,
  migrateLegacyRemoteClipboardFiles,
  scheduleLegacyRemoteClipboardFileMigration
} from './clipboard-remote-file-copy'

const TTL_MS = 60 * 60 * 1000
const NOW_MS = 1_760_000_000_000
const UID_SUFFIX = typeof process.getuid === 'function' ? `-${process.getuid()}` : ''
const STAGING_ROOT = join('/tmp', `orca-clipboard-files${UID_SUFFIX}`)
const MIGRATION_MARKER = join(STAGING_ROOT, '.legacy-cleanup-complete')

type MockDirent = { name: string; isDirectory: () => boolean }

function directoryEntry(name: string, isDirectory = true): MockDirent {
  return { name, isDirectory: () => isDirectory }
}

function openedDirectory(entries: Iterable<MockDirent>): {
  [Symbol.asyncIterator]: () => AsyncGenerator<MockDirent>
  close: ReturnType<typeof vi.fn>
} {
  return {
    async *[Symbol.asyncIterator]() {
      yield* entries
    },
    close: vi.fn().mockResolvedValue(undefined)
  }
}

function* stagingDirectories(count: number): Generator<MockDirent> {
  for (let index = 0; index < count; index += 1) {
    yield directoryEntry(`expired-${index}`)
  }
}

function* foreignTempEntries(count: number): Generator<MockDirent> {
  for (let index = 0; index < count; index += 1) {
    yield directoryEntry(`unrelated-${index}`, index % 2 === 0)
  }
}

describe('cleanupExpiredRemoteClipboardFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    accessMock.mockResolvedValue(undefined)
    lstatMock.mockResolvedValue({
      mode: 0o700,
      uid: typeof process.getuid === 'function' ? process.getuid() : 0,
      isDirectory: () => true,
      isSymbolicLink: () => false
    })
    mkdirMock.mockResolvedValue(undefined)
    opendirMock.mockImplementation(async (targetPath: string) => {
      if (targetPath !== STAGING_ROOT) {
        throw new Error(`unexpected directory scan: ${targetPath}`)
      }
      return openedDirectory([])
    })
    rmMock.mockResolvedValue(undefined)
    statMock.mockResolvedValue({ mtimeMs: NOW_MS - TTL_MS - 1 })
    writeFileMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('scans only the owned staging root after legacy migration', async () => {
    await cleanupExpiredRemoteClipboardFiles(NOW_MS)

    expect(opendirMock).toHaveBeenCalledOnce()
    expect(opendirMock).toHaveBeenCalledWith(STAGING_ROOT)
    expect(opendirMock).not.toHaveBeenCalledWith('/tmp')
  })

  it('keeps cleanup concurrency at eight inside the staging root', async () => {
    opendirMock.mockResolvedValue(openedDirectory(stagingDirectories(257)))
    let active = 0
    let peak = 0
    statMock.mockImplementation(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => setImmediate(resolve))
      active -= 1
      return { mtimeMs: NOW_MS - TTL_MS - 1 }
    })

    await cleanupExpiredRemoteClipboardFiles(NOW_MS)

    expect(rmMock).toHaveBeenCalledTimes(257)
    expect(peak).toBe(8)
  })

  it('removes only expired directories inside the owned root', async () => {
    opendirMock.mockResolvedValue(
      openedDirectory([
        directoryEntry('expired'),
        directoryEntry('fresh'),
        directoryEntry('plain-file', false),
        directoryEntry('.legacy-cleanup-complete', false)
      ])
    )
    statMock.mockImplementation(async (targetPath: string) => ({
      mtimeMs: targetPath.endsWith('expired') ? NOW_MS - TTL_MS - 1 : NOW_MS - 1000
    }))

    await cleanupExpiredRemoteClipboardFiles(NOW_MS)

    expect(statMock).toHaveBeenCalledTimes(2)
    expect(rmMock).toHaveBeenCalledOnce()
    expect(rmMock).toHaveBeenCalledWith(join(STAGING_ROOT, 'expired'), {
      recursive: true,
      force: true
    })
  })

  it('finishes pending cleanup when owned-root enumeration fails', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    opendirMock.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield directoryEntry('expired')
        throw new Error('EIO')
      },
      close
    })

    await expect(cleanupExpiredRemoteClipboardFiles(NOW_MS)).resolves.toBeUndefined()

    expect(rmMock).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects an unsafe staging-root symlink before scanning it', async () => {
    lstatMock.mockResolvedValue({
      mode: 0o700,
      uid: typeof process.getuid === 'function' ? process.getuid() : 0,
      isDirectory: () => false,
      isSymbolicLink: () => true
    })

    await expect(cleanupExpiredRemoteClipboardFiles(NOW_MS)).resolves.toBeUndefined()

    expect(opendirMock).not.toHaveBeenCalled()
    expect(rmMock).not.toHaveBeenCalled()
  })

  it('rejects a POSIX staging root owned by another user', async () => {
    if (typeof process.getuid !== 'function') {
      return
    }
    lstatMock.mockResolvedValue({
      mode: 0o700,
      uid: process.getuid() + 1,
      isDirectory: () => true,
      isSymbolicLink: () => false
    })

    await cleanupExpiredRemoteClipboardFiles(NOW_MS)

    expect(opendirMock).not.toHaveBeenCalled()
  })

  it('rejects a POSIX staging root with insecure permissions', async () => {
    const processWithUid = Object.assign(Object.create(process) as NodeJS.Process, {
      getuid: () => 1000
    })
    vi.stubGlobal('process', processWithUid)
    lstatMock.mockResolvedValue({
      mode: 0o755,
      uid: 1000,
      isDirectory: () => true,
      isSymbolicLink: () => false
    })

    await cleanupExpiredRemoteClipboardFiles(NOW_MS)

    expect(opendirMock).not.toHaveBeenCalled()
  })

  it('migrates legacy directories once and records completion', async () => {
    accessMock.mockRejectedValue(new Error('ENOENT'))
    opendirMock.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/tmp') {
        return openedDirectory(
          (function* (): Generator<MockDirent> {
            yield* foreignTempEntries(200_000)
            yield directoryEntry('orca-clipboard-file-expired')
          })()
        )
      }
      throw new Error(`unexpected directory scan: ${targetPath}`)
    })

    await migrateLegacyRemoteClipboardFiles(NOW_MS)

    expect(statMock).toHaveBeenCalledOnce()
    expect(rmMock).toHaveBeenCalledWith(join('/tmp', 'orca-clipboard-file-expired'), {
      recursive: true,
      force: true
    })
    expect(writeFileMock).toHaveBeenCalledWith(MIGRATION_MARKER, '', { flag: 'wx' })
  })

  it('skips the shared temp root once migration is marked complete', async () => {
    await migrateLegacyRemoteClipboardFiles(NOW_MS)

    expect(accessMock).toHaveBeenCalledWith(MIGRATION_MARKER)
    expect(opendirMock).not.toHaveBeenCalled()
  })

  it('delays the legacy scan until after startup', async () => {
    vi.useFakeTimers()
    accessMock.mockRejectedValue(new Error('ENOENT'))
    opendirMock.mockResolvedValue(openedDirectory([]))

    scheduleLegacyRemoteClipboardFileMigration()
    scheduleLegacyRemoteClipboardFileMigration()
    await vi.advanceTimersByTimeAsync(29_999)

    expect(opendirMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(opendirMock).toHaveBeenCalledOnce()
    expect(opendirMock).toHaveBeenCalledWith('/tmp')
  })

  it('retries migration until fresh legacy directories can expire', async () => {
    accessMock.mockRejectedValue(new Error('ENOENT'))
    opendirMock.mockImplementation(async () =>
      openedDirectory([directoryEntry('orca-clipboard-file-recent')])
    )
    statMock.mockResolvedValueOnce({ mtimeMs: NOW_MS - 1000 })

    await migrateLegacyRemoteClipboardFiles(NOW_MS)

    expect(writeFileMock).not.toHaveBeenCalled()
    expect(rmMock).not.toHaveBeenCalled()

    statMock.mockResolvedValue({ mtimeMs: NOW_MS - TTL_MS - 1 })
    await migrateLegacyRemoteClipboardFiles(NOW_MS)

    expect(rmMock).toHaveBeenCalledOnce()
    expect(writeFileMock).toHaveBeenCalledWith(MIGRATION_MARKER, '', { flag: 'wx' })
  })

  it('does not mark migration complete after a partial legacy scan', async () => {
    accessMock.mockRejectedValue(new Error('ENOENT'))
    opendirMock.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield directoryEntry('orca-clipboard-file-expired')
        throw new Error('EIO')
      },
      close: vi.fn().mockResolvedValue(undefined)
    })

    await migrateLegacyRemoteClipboardFiles(NOW_MS)

    expect(rmMock).toHaveBeenCalledOnce()
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('does not mark migration complete when a legacy entry cannot be inspected', async () => {
    accessMock.mockRejectedValue(new Error('ENOENT'))
    opendirMock.mockResolvedValue(
      openedDirectory([directoryEntry('orca-clipboard-file-unreadable')])
    )
    statMock.mockRejectedValue(new Error('EACCES'))

    await migrateLegacyRemoteClipboardFiles(NOW_MS)

    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('returns quietly when the owned root cannot be prepared', async () => {
    mkdirMock.mockRejectedValue(new Error('EACCES'))

    await expect(cleanupExpiredRemoteClipboardFiles(NOW_MS)).resolves.toBeUndefined()

    expect(opendirMock).not.toHaveBeenCalled()
    expect(rmMock).not.toHaveBeenCalled()
  })
})
