import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  copyFileWithWindowsRetryAsync,
  realpathNativeAsync,
  renameFileWithWindowsRetryAsync,
  serializeAtomicFileWrite
} from '../codex-accounts/fs-utils'
import { grantDirAcl, isPermissionError } from '../win32-utils'
import type { HooksConfig } from './installer-utils'

// Why: main-thread twins of writeHooksJson / writeManagedScript. The sync
// versions stay for the CLI process and Codex's launch-prep path; these exist
// so a stalled HOME mount parks a threadpool slot instead of the UI thread.
//
// Why serializeAtomicFileWrite and not a local chain: a second per-path map in
// this module could not see writes the codex-accounts one is already holding,
// so the ordering invariant would only hold while no file is written by both.

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return null
  }
}

type ExistingConfig = { exists: boolean; content: string | null }

// Why: the sync twin gates the backup and the mode probe on existsSync, which
// is false only when stat fails. A file that stats but fails to read (EACCES,
// EIO) still exists and must not lose its .bak or its mode.
async function readExistingConfig(path: string): Promise<ExistingConfig> {
  try {
    return { exists: true, content: await readFile(path, 'utf-8') }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false, content: null }
    }
    return { exists: await statSucceeds(path), content: null }
  }
}

async function statSucceeds(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch {
    // best effort
  }
}

// Why: async twin of resolveHooksJsonWritePath — renaming over the link path
// would disconnect a dotfiles-managed config; a dangling link must fail closed.
async function resolveWritePath(configPath: string): Promise<string> {
  let isSymlink = false
  try {
    isSymlink = (await lstat(configPath)).isSymbolicLink()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    return configPath
  }
  return isSymlink ? await realpathNativeAsync(configPath) : configPath
}

// Why: async twin of writeRollingFileBackup — a fresh inode cannot mutate
// another file through a hard link, and a failed rename keeps the prior backup.
async function writeRollingBackup(sourcePath: string, backupPath: string): Promise<void> {
  try {
    if ((await lstat(backupPath)).isSymbolicLink()) {
      throw new Error(`Refusing to overwrite symlinked backup: ${backupPath}`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  const tempPath = `${backupPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await copyFileWithWindowsRetryAsync(sourcePath, tempPath)
    await renameFileWithWindowsRetryAsync(tempPath, backupPath)
  } finally {
    await unlinkIfPresent(tempPath)
  }
}

async function writeWithAclRetry(path: string, content: string, mode?: number): Promise<void> {
  try {
    await writeFile(path, content, { encoding: 'utf-8', mode })
  } catch (error) {
    if (isPermissionError(error) && process.platform === 'win32') {
      try {
        grantDirAcl(dirname(path))
        await writeFile(path, content, { encoding: 'utf-8', mode })
        return
      } catch {
        // icacls failure is not actionable; re-throw the original EPERM
      }
    }
    throw error
  }
}

export function writeManagedScriptAsync(scriptPath: string, content: string): Promise<void> {
  return serializeAtomicFileWrite(scriptPath, () => writeManagedScriptNow(scriptPath, content))
}

async function writeManagedScriptNow(scriptPath: string, content: string): Promise<void> {
  const dir = dirname(scriptPath)
  await mkdir(dir, { recursive: true })

  // Why: one read answers both "does it exist" and "is it already current".
  if ((await readFileOrNull(scriptPath)) === content) {
    if (process.platform !== 'win32') {
      await chmod(scriptPath, 0o755)
    }
    return
  }

  const tmpPath = join(dir, `.${Date.now()}-${randomUUID()}.tmp`)
  try {
    await writeWithAclRetry(tmpPath, content)
    // Why: chmod before rename so the canonical path is never visible non-executable, else the POSIX guard skips the hook.
    if (process.platform !== 'win32') {
      await chmod(tmpPath, 0o755)
    }
    await renameFileWithWindowsRetryAsync(tmpPath, scriptPath)
  } finally {
    await unlinkIfPresent(tmpPath)
  }
}

export function writeHooksJsonAsync(
  configPath: string,
  config: HooksConfig,
  options?: { preserveMode?: boolean }
): Promise<void> {
  // Why: key on the caller's path, not the resolved one — the symlink probe is
  // itself part of the critical section.
  return serializeAtomicFileWrite(configPath, () => writeHooksJsonNow(configPath, config, options))
}

async function writeHooksJsonNow(
  configPath: string,
  config: HooksConfig,
  options?: { preserveMode?: boolean }
): Promise<void> {
  const writePath = await resolveWritePath(configPath)
  const dir = dirname(writePath)
  await mkdir(dir, { recursive: true })

  const serialized = `${JSON.stringify(config, null, 2)}\n`
  const existing = await readExistingConfig(writePath)
  // Why: skip the write (and the .bak rotation) when the on-disk content is
  // already identical, so a repeated install can't roll the last recoverable
  // copy forward and destroy it.
  if (existing.content === serialized) {
    return
  }
  const existingMode =
    options?.preserveMode === true && existing.exists
      ? await statModeOrUndefined(writePath)
      : undefined

  // Why: temp+rename leaves the original untouched on a crash/disk-full mid-write.
  // Why randomUUID: avoids tmp-path collisions when two install() calls fire in the same millisecond.
  const tmpPath = join(dir, `.${Date.now()}-${randomUUID()}.tmp`)
  try {
    await writeFile(tmpPath, serialized, { encoding: 'utf-8', mode: existingMode })
    // Why: single rolling backup so a merge-logic bug producing bad JSON is always recoverable.
    if (existing.exists) {
      await writeRollingBackup(writePath, `${writePath}.bak`)
    }
    await renameFileWithWindowsRetryAsync(tmpPath, writePath)
  } finally {
    await unlinkIfPresent(tmpPath)
  }
}

async function statModeOrUndefined(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mode
  } catch {
    return undefined
  }
}
