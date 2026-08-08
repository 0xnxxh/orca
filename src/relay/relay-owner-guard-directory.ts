import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
  type FileHandle
} from 'node:fs/promises'
import path from 'node:path'

const OWNER_FILE_PREFIX = 'owner-'
const MAX_OWNER_TOKEN_BYTES = 4 * 1024

export type RelayOwnerGuardInspection =
  | Readonly<{ status: 'missing' | 'invalid' }>
  | Readonly<{ status: 'owned'; ownerToken: string }>

export async function createRelayOwnerGuardDirectory(
  directory: string,
  ownerToken: string
): Promise<boolean> {
  assertOwnerToken(ownerToken)
  const temporary = `${directory}.${process.pid}.${randomUUID()}.tmp`
  try {
    await mkdir(temporary, { mode: 0o700 })
    await writeSyncedFile(path.join(temporary, ownerFileName(ownerToken)), `${ownerToken}\n`)
    await syncDirectory(temporary)
    try {
      await rename(temporary, directory)
      await syncDirectory(path.dirname(directory))
      return true
    } catch (error) {
      try {
        await lstat(directory)
        return false
      } catch (targetError) {
        if (errorCode(targetError) !== 'ENOENT') {
          throw targetError
        }
        throw error
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function inspectRelayOwnerGuardDirectory(
  directory: string
): Promise<RelayOwnerGuardInspection> {
  let directoryMetadata
  try {
    directoryMetadata = await lstat(directory)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return Object.freeze({ status: 'missing' })
    }
    throw error
  }
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    return Object.freeze({ status: 'invalid' })
  }
  const entries = await readdir(directory)
  if (entries.length !== 1 || !entries[0]!.startsWith(OWNER_FILE_PREFIX)) {
    return Object.freeze({ status: 'invalid' })
  }
  const ownerPath = path.join(directory, entries[0]!)
  const ownerMetadata = await lstat(ownerPath)
  if (!ownerMetadata.isFile() || ownerMetadata.isSymbolicLink()) {
    return Object.freeze({ status: 'invalid' })
  }
  const ownerToken = await readBoundedOwnerToken(ownerPath, ownerMetadata.size)
  if (!ownerToken || entries[0] !== ownerFileName(ownerToken)) {
    return Object.freeze({ status: 'invalid' })
  }
  return Object.freeze({ status: 'owned', ownerToken })
}

export async function relayOwnerGuardIsOwnedBy(
  directory: string,
  ownerToken: string
): Promise<boolean> {
  const inspection = await inspectRelayOwnerGuardDirectory(directory)
  return inspection.status === 'owned' && inspection.ownerToken === ownerToken
}

export async function releaseRelayOwnerGuardDirectory(
  directory: string,
  ownerToken: string
): Promise<boolean> {
  assertOwnerToken(ownerToken)
  const inspection = await inspectRelayOwnerGuardDirectory(directory)
  if (inspection.status === 'missing') {
    return true
  }
  if (inspection.status !== 'owned' || inspection.ownerToken !== ownerToken) {
    return false
  }
  try {
    await unlink(path.join(directory, ownerFileName(ownerToken)))
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      throw error
    }
    return (await inspectRelayOwnerGuardDirectory(directory)).status === 'missing'
  }
  try {
    await rmdir(directory)
    await syncDirectory(path.dirname(directory))
    return true
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return true
    }
    if (['EEXIST', 'ENOTEMPTY', 'ENOTDIR'].includes(errorCode(error))) {
      return false
    }
    throw error
  }
}

async function readBoundedOwnerToken(file: string, size: number): Promise<string | null> {
  if (size < 1 || size > MAX_OWNER_TOKEN_BYTES) {
    return null
  }
  const ownerToken = (await readFile(file, 'utf8')).trim()
  try {
    assertOwnerToken(ownerToken)
    return ownerToken
  } catch {
    return null
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

function ownerFileName(ownerToken: string): string {
  return `${OWNER_FILE_PREFIX}${createHash('sha256').update(ownerToken).digest('hex')}`
}

function assertOwnerToken(ownerToken: string): void {
  if (
    typeof ownerToken !== 'string' ||
    ownerToken.trim().length === 0 ||
    ownerToken.includes('\0') ||
    Buffer.byteLength(ownerToken) > MAX_OWNER_TOKEN_BYTES
  ) {
    throw new Error('relay owner guard token is invalid')
  }
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
}
