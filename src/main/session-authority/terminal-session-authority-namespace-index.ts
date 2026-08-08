import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { assertAuthorityId, isRecord } from '../../shared/terminal-session-authority-identity'
import {
  assertTerminalAuthorityNamespaceLocator,
  terminalAuthorityNamespaceLocatorKey,
  type TerminalAuthorityNamespaceLocator
} from '../../shared/terminal-session-authority-locator'
import { failTerminalSessionAuthority } from '../../shared/terminal-session-authority-mutation'

export const TERMINAL_AUTHORITY_NAMESPACE_INDEX_FILE = 'terminal-authority-namespaces.json'
const MAX_INDEX_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_NAMESPACES = 16_384

export type TerminalAuthorityNamespaceEntry = Readonly<{
  locator: TerminalAuthorityNamespaceLocator
  namespaceId: string
}>

type NamespaceIndex = Readonly<{
  version: 1
  authorityHostId: string
  entries: readonly TerminalAuthorityNamespaceEntry[]
}>

export function resolveTerminalAuthorityNamespaceLimit(value: number | undefined): number {
  const selected = value ?? DEFAULT_MAX_NAMESPACES
  if (!Number.isSafeInteger(selected) || selected < 1) {
    failTerminalSessionAuthority('capacity', 'namespace capacity is invalid')
  }
  return selected
}

export async function readTerminalAuthorityNamespaceIndex(
  directory: string,
  authorityHostId: string,
  maxNamespaces: number
): Promise<readonly TerminalAuthorityNamespaceEntry[]> {
  const file = path.join(directory, TERMINAL_AUTHORITY_NAMESPACE_INDEX_FILE)
  let metadata
  try {
    metadata = await stat(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
  if (!metadata.isFile() || metadata.size > MAX_INDEX_BYTES) {
    failTerminalSessionAuthority('record-corrupt', 'namespace index is not a bounded file')
  }
  const value = JSON.parse(await readFile(file, 'utf8')) as unknown
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.authorityHostId !== authorityHostId ||
    !Array.isArray(value.entries) ||
    value.entries.length > maxNamespaces
  ) {
    failTerminalSessionAuthority('record-corrupt', 'namespace index is invalid')
  }
  const locatorKeys = new Set<string>()
  const namespaceIds = new Set<string>()
  return Object.freeze(
    value.entries.map((raw) => {
      if (!isRecord(raw)) {
        failTerminalSessionAuthority('record-corrupt', 'namespace entry is invalid')
      }
      assertAuthorityId(raw.namespaceId, 'namespaceId')
      assertTerminalAuthorityNamespaceLocator(raw.locator as TerminalAuthorityNamespaceLocator)
      const locator = raw.locator as TerminalAuthorityNamespaceLocator
      const locatorKey = terminalAuthorityNamespaceLocatorKey(locator)
      if (locatorKeys.has(locatorKey) || namespaceIds.has(raw.namespaceId)) {
        failTerminalSessionAuthority('record-corrupt', 'namespace index contains a duplicate')
      }
      locatorKeys.add(locatorKey)
      namespaceIds.add(raw.namespaceId)
      return Object.freeze({ locator, namespaceId: raw.namespaceId })
    })
  )
}

export async function writeTerminalAuthorityNamespaceIndex(
  directory: string,
  index: NamespaceIndex
): Promise<void> {
  await mkdir(directory, { recursive: true })
  const target = path.join(directory, TERMINAL_AUTHORITY_NAMESPACE_INDEX_FILE)
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  const contents = `${JSON.stringify(index)}\n`
  if (Buffer.byteLength(contents, 'utf8') > MAX_INDEX_BYTES) {
    failTerminalSessionAuthority('capacity', 'namespace index exceeds its size limit')
  }
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, target)
    await syncDirectory(directory)
  } finally {
    await rm(temporary, { force: true })
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: FileHandle | null = null
  try {
    handle = await open(directory, 'r')
    await handle.sync()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (!['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(code ?? '')) {
      throw error
    }
  } finally {
    await handle?.close()
  }
}
