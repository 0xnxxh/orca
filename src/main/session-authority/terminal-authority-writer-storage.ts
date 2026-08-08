import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  type FileHandle
} from 'node:fs/promises'
import path from 'node:path'
import { assertAuthorityId, isRecord } from '../../shared/terminal-session-authority-identity'
import { failTerminalSessionAuthority } from '../../shared/terminal-session-authority-mutation'
import { removeAuthorityCrashTemporaryFiles } from './terminal-session-authority-temporary-files'

const MARKER_FILE = 'authority-writer.json'
const GUARD_FILE = 'authority-writer.guard'
const GUARD_OWNER_PREFIX = 'owner-'
const MAX_MARKER_BYTES = 4 * 1024
const MAX_GUARD_BYTES = 4 * 1024
const GUARD_ATTEMPTS = 200

export type TerminalAuthorityWriterMarker = Readonly<{
  version: 1
  ownerToken: string
  epoch: number
  active: boolean
}>

export type TerminalAuthorityWriterGuard = Readonly<{ ownerToken: string }>

export async function acquireTerminalAuthorityWriterGuard(
  directory: string,
  ownerToken: string
): Promise<TerminalAuthorityWriterGuard> {
  const guardPath = path.join(directory, GUARD_FILE)
  for (let attempt = 0; attempt < GUARD_ATTEMPTS; attempt++) {
    const temporary = `${guardPath}.${process.pid}.${randomUUID()}.tmp`
    try {
      await mkdir(temporary, { mode: 0o700 })
      await writeSyncedFile(path.join(temporary, guardOwnerFileName(ownerToken)), `${ownerToken}\n`)
      await syncDirectory(temporary)
      if (await publishDirectoryExclusive(temporary, guardPath)) {
        await syncDirectory(directory)
        return Object.freeze({ ownerToken })
      }
      await removeEmptyGuardDirectory(guardPath)
      await new Promise<void>((resolve) => setTimeout(resolve, 5))
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }
  failTerminalSessionAuthority('writer-fenced', 'authority writer guard is busy')
}

export async function releaseTerminalAuthorityWriterGuard(
  directory: string,
  guard: TerminalAuthorityWriterGuard
): Promise<void> {
  if (!(await removeTerminalAuthorityWriterGuard(directory, guard.ownerToken))) {
    failTerminalSessionAuthority('writer-fenced', 'authority writer guard was replaced')
  }
}

export async function clearTerminalAuthorityWriterGuard(
  directory: string,
  ownerToken: string
): Promise<boolean> {
  return removeTerminalAuthorityWriterGuard(directory, ownerToken)
}

export async function readTerminalAuthorityWriterGuardOwner(
  directory: string
): Promise<string | null> {
  const guardPath = path.join(directory, GUARD_FILE)
  let metadata
  try {
    metadata = await stat(guardPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
  if (metadata.isFile()) {
    return readBoundedOwnerFile(guardPath, metadata.size)
  }
  if (!metadata.isDirectory()) {
    failTerminalSessionAuthority('record-corrupt', 'authority writer guard is invalid')
  }
  const entries = await readdir(guardPath)
  if (entries.length === 0) {
    return null
  }
  if (entries.length !== 1 || !entries[0]!.startsWith(GUARD_OWNER_PREFIX)) {
    failTerminalSessionAuthority('record-corrupt', 'authority writer guard is invalid')
  }
  const ownerFile = path.join(guardPath, entries[0]!)
  const ownerMetadata = await stat(ownerFile)
  const ownerToken = await readBoundedOwnerFile(ownerFile, ownerMetadata.size)
  if (entries[0] !== guardOwnerFileName(ownerToken)) {
    failTerminalSessionAuthority('record-corrupt', 'authority writer guard identity changed')
  }
  return ownerToken
}

export async function readTerminalAuthorityWriterMarker(
  directory: string
): Promise<TerminalAuthorityWriterMarker | null> {
  const markerPath = path.join(directory, MARKER_FILE)
  let metadata
  try {
    metadata = await stat(markerPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
  if (!metadata.isFile() || metadata.size > MAX_MARKER_BYTES) {
    failTerminalSessionAuthority('record-corrupt', 'authority writer marker is invalid')
  }
  let value: unknown
  try {
    value = JSON.parse(await readFile(markerPath, 'utf8')) as unknown
  } catch {
    failTerminalSessionAuthority('record-corrupt', 'authority writer marker is corrupt')
  }
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.active !== 'boolean' ||
    !Number.isSafeInteger(value.epoch) ||
    (value.epoch as number) < 1
  ) {
    failTerminalSessionAuthority('record-corrupt', 'authority writer marker is corrupt')
  }
  assertAuthorityId(value.ownerToken, 'writer ownerToken')
  return Object.freeze({
    version: 1,
    ownerToken: value.ownerToken,
    epoch: value.epoch as number,
    active: value.active
  })
}

export async function writeTerminalAuthorityWriterMarker(
  directory: string,
  marker: TerminalAuthorityWriterMarker
): Promise<void> {
  const markerPath = path.join(directory, MARKER_FILE)
  const temporary = `${markerPath}.${process.pid}.${randomUUID()}.tmp`
  await writeSyncedFile(temporary, `${JSON.stringify(marker)}\n`)
  try {
    await rename(temporary, markerPath)
    await syncDirectory(directory)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function removeTerminalAuthorityWriterCrashFiles(directory: string): Promise<void> {
  await removeAuthorityCrashTemporaryFiles(directory, [MARKER_FILE])
}

async function removeTerminalAuthorityWriterGuard(
  directory: string,
  ownerToken: string
): Promise<boolean> {
  const guardPath = path.join(directory, GUARD_FILE)
  const ownerPath = path.join(guardPath, guardOwnerFileName(ownerToken))
  let ownerMetadata
  try {
    ownerMetadata = await stat(ownerPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
  if ((await readBoundedOwnerFile(ownerPath, ownerMetadata.size)) !== ownerToken) {
    return false
  }
  try {
    await unlink(ownerPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
  await removeEmptyGuardDirectory(guardPath)
  await syncDirectory(directory)
  return true
}

async function readBoundedOwnerFile(file: string, size: number): Promise<string> {
  if (size < 1 || size > MAX_GUARD_BYTES) {
    failTerminalSessionAuthority('record-corrupt', 'authority writer guard is invalid')
  }
  const ownerToken = (await readFile(file, 'utf8')).trim()
  assertAuthorityId(ownerToken, 'writer guard ownerToken')
  return ownerToken
}

async function publishDirectoryExclusive(source: string, target: string): Promise<boolean> {
  try {
    await rename(source, target)
    return true
  } catch (error) {
    try {
      await stat(target)
      return false
    } catch (targetError) {
      if ((targetError as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw targetError
      }
      throw error
    }
  }
}

async function removeEmptyGuardDirectory(guardPath: string): Promise<void> {
  try {
    await rmdir(guardPath)
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST', 'ENOTDIR'].includes(errorCode(error))) {
      throw error
    }
  }
}

async function writeSyncedFile(file: string, contents: string): Promise<void> {
  const handle = await open(file, 'wx', 0o600)
  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function guardOwnerFileName(ownerToken: string): string {
  return `${GUARD_OWNER_PREFIX}${createHash('sha256').update(ownerToken).digest('hex')}`
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: FileHandle | null = null
  try {
    handle = await open(directory, 'r')
    await handle.sync()
  } catch (error) {
    if (!['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(errorCode(error))) {
      throw error
    }
  } finally {
    await handle?.close()
  }
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
}
