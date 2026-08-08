import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type DurableRenameOptions = {
  move?: (source: string, destination: string) => void
  afterRename?: () => void
}

/** Sync a file before publishing its name so a crash cannot expose unwritten contents. */
export function fsyncFileSync(path: string): void {
  // Windows FlushFileBuffers requires a handle opened with write access.
  const fd = openSync(path, 'r+')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** Sync a directory after a rename/unlink where the host filesystem supports directory fsync. */
export function fsyncDirectorySync(directory: string): void {
  if (process.platform === 'win32') {
    return
  }
  let fd: number | null = null
  try {
    fd = openSync(directory, 'r')
    fsyncSync(fd)
  } catch (error) {
    if (!isDirectoryFsyncUnsupported(error)) {
      throw error
    }
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // The directory fsync is best effort after the operation has committed.
      }
    }
  }
}

function isDirectoryFsyncUnsupported(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return (
    code === 'EINVAL' ||
    code === 'EISDIR' ||
    code === 'ENOSYS' ||
    code === 'ENOTSUP' ||
    code === 'EOPNOTSUPP'
  )
}

/** Fsync a file, rename it, run post-publication hardening, then fsync its directory. */
export function renameFileDurableSync(
  source: string,
  destination: string,
  options: DurableRenameOptions = {}
): void {
  const move = options.move ?? renameSync
  fsyncFileSync(source)
  let renamed = false
  try {
    move(source, destination)
    renamed = true
    options.afterRename?.()
  } finally {
    if (renamed) {
      fsyncDirectorySync(dirname(destination))
    }
  }
}

/** Remove a lifecycle artifact and make the containing directory durable. */
export function removeFileDurableSync(path: string): void {
  rmSync(path, { force: true })
  fsyncDirectorySync(dirname(path))
}

/** Write a payload, fsync it, rename it atomically, and fsync the containing directory. */
export function writeFileDurableSync(
  tmpPath: string,
  finalPath: string,
  payload: string,
  options: DurableRenameOptions = {}
): void {
  writeFileSync(tmpPath, payload, 'utf-8')
  try {
    renameFileDurableSync(tmpPath, finalPath, options)
  } catch (error) {
    rmSync(tmpPath, { force: true })
    throw error
  }
}
