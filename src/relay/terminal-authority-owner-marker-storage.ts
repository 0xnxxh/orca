import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import {
  parseSshTerminalAuthorityMarker,
  type SshTerminalAuthorityMarker
} from '../shared/ssh-terminal-authority-marker'

const AUTHORITY_HOST_ID_FILE = 'authority-host-id'
const MAX_MARKER_BYTES = 16 * 1024

export function prepareTerminalAuthorityStateDirectory(stateDir: string): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') {
    chmodSync(stateDir, 0o700)
  }
}

export function readOrCreateTerminalAuthorityHostId(stateDir: string): string {
  const path = join(stateDir, AUTHORITY_HOST_ID_FILE)
  if (!existsSync(path)) {
    createTerminalAuthorityMarkerFile(path, `${randomUUID()}\n`, stateDir)
  }
  const value = readFileSync(path, 'utf8').trim()
  if (!/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error('Terminal authority host identity is invalid')
  }
  return value
}

export function readTerminalAuthorityOwnerMarker(
  markerPath: string
): SshTerminalAuthorityMarker | null {
  try {
    const metadata = statSync(markerPath)
    if (!metadata.isFile() || metadata.size > MAX_MARKER_BYTES) {
      return null
    }
    return parseSshTerminalAuthorityMarker(JSON.parse(readFileSync(markerPath, 'utf8')))
  } catch {
    return null
  }
}

export function createTerminalAuthorityMarkerFile(
  markerPath: string,
  contents: string,
  stateDir: string
): boolean {
  const temporary = `${markerPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeDurableTemporaryFile(temporary, contents)
    try {
      linkSync(temporary, markerPath)
      syncDirectory(stateDir)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return false
      }
      throw error
    }
  } finally {
    unlinkIfPresent(temporary)
  }
}

export function replaceTerminalAuthorityMarkerFile(
  markerPath: string,
  contents: string,
  stateDir: string
): void {
  const temporary = `${markerPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeDurableTemporaryFile(temporary, contents)
    renameSync(temporary, markerPath)
    syncDirectory(stateDir)
  } finally {
    unlinkIfPresent(temporary)
  }
}

function writeDurableTemporaryFile(file: string, contents: string): void {
  const fd = openSync(file, 'wx', 0o600)
  try {
    writeFileSync(fd, contents, 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function unlinkIfPresent(file: string): void {
  try {
    unlinkSync(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

function syncDirectory(directory: string): void {
  let fd: number | undefined
  try {
    fd = openSync(directory, 'r')
    fsyncSync(fd)
  } catch (error) {
    if (!isUnsupportedDirectorySync(error)) {
      throw error
    }
  } finally {
    if (fd !== undefined) {
      closeSync(fd)
    }
  }
}

function isUnsupportedDirectorySync(error: unknown): boolean {
  return ['EBADF', 'EISDIR', 'EINVAL', 'EPERM'].includes(
    (error as NodeJS.ErrnoException).code ?? ''
  )
}
