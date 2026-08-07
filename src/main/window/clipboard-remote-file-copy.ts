import { randomUUID } from 'node:crypto'
import type { Dir } from 'node:fs'
import { access, lstat, mkdir, opendir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { app } from 'electron'

import { getRuntimePathBasename } from '../../shared/cross-platform-path'
import { requireSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import {
  writeFileToClipboard,
  type ClipboardFileDeps,
  type ClipboardFileResult
} from './clipboard-file-copy'

type RemoteClipboardFileDeps = Omit<ClipboardFileDeps, 'resolveFilePath'>

const REMOTE_CLIPBOARD_FILE_TTL_MS = 60 * 60 * 1000
const REMOTE_CLIPBOARD_STAGING_ROOT_NAME = 'orca-clipboard-files'
const REMOTE_CLIPBOARD_LEGACY_PREFIX = 'orca-clipboard-file-'
const REMOTE_CLIPBOARD_LEGACY_MIGRATION_MARKER = '.legacy-cleanup-complete'
const REMOTE_CLIPBOARD_LEGACY_MIGRATION_DELAY_MS = 30_000
const REMOTE_CLIPBOARD_CLEANUP_CONCURRENCY = 8
const WINDOWS_RESERVED_LOCAL_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const LOCAL_FILENAME_REPLACEMENT_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])
let legacyMigrationScheduled = false

export async function writeRemoteFileToClipboard({
  remotePath,
  connectionId,
  deps
}: {
  remotePath: string
  connectionId: string
  deps: RemoteClipboardFileDeps
}): Promise<ClipboardFileResult> {
  const provider = requireSshFilesystemProvider(connectionId)
  const remoteStat = await provider.stat(remotePath)
  if (remoteStat.type === 'directory') {
    return { ok: false, reason: 'is-directory' }
  }
  if (!provider.downloadFile) {
    throw new Error('Remote file download is unavailable. Reconnect the SSH target and retry.')
  }

  const stagingRoot = await ensureRemoteClipboardStagingRoot()
  const tempDir = join(stagingRoot, `${Date.now()}-${randomUUID()}`)
  await mkdir(tempDir, { mode: 0o700 })
  const localPath = join(
    tempDir,
    sanitizeLocalClipboardFilename(getRuntimePathBasename(remotePath))
  )
  let keepTempFile = false

  try {
    await provider.downloadFile(remotePath, localPath)
    const result = await writeFileToClipboard(localPath, {
      ...deps,
      resolveFilePath: async (path) => {
        if (path !== localPath) {
          return { ok: false, reason: 'invalid-path' }
        }
        try {
          await stat(path)
          return { ok: true, path }
        } catch {
          return { ok: false, reason: 'not-found' }
        }
      }
    })
    if (result.ok) {
      // Why: OS file clipboards keep a path reference, so the staged copy must
      // survive after this IPC call long enough for the user to paste it.
      keepTempFile = true
      scheduleRemoteClipboardFileCleanup(tempDir)
    }
    return result
  } finally {
    if (!keepTempFile) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

export async function cleanupExpiredRemoteClipboardFiles(nowMs = Date.now()): Promise<void> {
  let stagingRoot: string
  try {
    stagingRoot = await ensureRemoteClipboardStagingRoot()
  } catch {
    return
  }

  await sweepRemoteClipboardDirectories(stagingRoot, nowMs, () => true)
}

async function ensureRemoteClipboardStagingRoot(): Promise<string> {
  const uidSuffix = typeof process.getuid === 'function' ? `-${process.getuid()}` : ''
  const stagingRoot = join(app.getPath('temp'), `${REMOTE_CLIPBOARD_STAGING_ROOT_NAME}${uidSuffix}`)
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 })
  const rootStats = await lstat(stagingRoot)
  const wrongOwner = typeof process.getuid === 'function' && rootStats.uid !== process.getuid()
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || wrongOwner) {
    throw new Error('Remote clipboard staging root is unsafe')
  }
  return stagingRoot
}

export async function migrateLegacyRemoteClipboardFiles(nowMs = Date.now()): Promise<void> {
  let stagingRoot: string
  try {
    stagingRoot = await ensureRemoteClipboardStagingRoot()
  } catch {
    return
  }

  const markerPath = join(stagingRoot, REMOTE_CLIPBOARD_LEGACY_MIGRATION_MARKER)
  const migrationComplete = await access(markerPath).then(
    () => true,
    () => false
  )
  if (migrationComplete) {
    return
  }

  const result = await sweepRemoteClipboardDirectories(app.getPath('temp'), nowMs, (name) =>
    name.startsWith(REMOTE_CLIPBOARD_LEGACY_PREFIX)
  )
  if (result.complete && !result.hasFreshDirectories) {
    await writeFile(markerPath, '', { flag: 'wx' }).catch(() => undefined)
  }
}

export function scheduleLegacyRemoteClipboardFileMigration(): void {
  if (legacyMigrationScheduled) {
    return
  }
  legacyMigrationScheduled = true
  const timer = setTimeout(() => {
    void migrateLegacyRemoteClipboardFiles()
  }, REMOTE_CLIPBOARD_LEGACY_MIGRATION_DELAY_MS)
  if (typeof timer === 'object' && 'unref' in timer) {
    timer.unref()
  }
}

async function sweepRemoteClipboardDirectories(
  root: string,
  nowMs: number,
  ownsEntry: (name: string) => boolean
): Promise<{ complete: boolean; hasFreshDirectories: boolean }> {
  let rootDir: Dir
  try {
    rootDir = await opendir(root)
  } catch {
    return { complete: false, hasFreshDirectories: false }
  }

  let complete = true
  let hasFreshDirectories = false
  const pending = new Set<Promise<void>>()
  try {
    for await (const entry of rootDir) {
      if (!entry.isDirectory() || !ownsEntry(entry.name)) {
        continue
      }
      const cleanup = cleanupExpiredRemoteClipboardDirectory(join(root, entry.name), nowMs).then(
        (result) => {
          hasFreshDirectories ||= result === 'fresh'
          complete &&= result !== 'failed'
        }
      )
      pending.add(cleanup)
      void cleanup.finally(() => pending.delete(cleanup))
      if (pending.size >= REMOTE_CLIPBOARD_CLEANUP_CONCURRENCY) {
        await Promise.race(pending)
      }
    }
  } catch {
    complete = false
  } finally {
    await rootDir.close().catch(() => undefined)
  }
  await Promise.all(pending)
  return { complete, hasFreshDirectories }
}

async function cleanupExpiredRemoteClipboardDirectory(
  tempDir: string,
  nowMs: number
): Promise<'failed' | 'fresh' | 'removed'> {
  try {
    const tempStats = await stat(tempDir)
    if (nowMs - tempStats.mtimeMs < REMOTE_CLIPBOARD_FILE_TTL_MS) {
      return 'fresh'
    }
    await rm(tempDir, { recursive: true, force: true })
    return 'removed'
  } catch {
    // Why: stale staged SSH files should not make startup cleanup noisy.
    return 'failed'
  }
}

function sanitizeLocalClipboardFilename(remoteBasename: string): string {
  const sanitized = Array.from(remoteBasename, (char) =>
    char.charCodeAt(0) < 32 || LOCAL_FILENAME_REPLACEMENT_CHARS.has(char) ? '_' : char
  )
    .join('')
    .replace(/[. ]+$/g, '')
  if (!sanitized || WINDOWS_RESERVED_LOCAL_BASENAME.test(sanitized)) {
    return 'download'
  }
  return sanitized
}

function scheduleRemoteClipboardFileCleanup(tempDir: string): void {
  const timer = setTimeout(() => {
    void rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }, REMOTE_CLIPBOARD_FILE_TTL_MS)
  if (typeof timer === 'object' && 'unref' in timer) {
    timer.unref()
  }
}
