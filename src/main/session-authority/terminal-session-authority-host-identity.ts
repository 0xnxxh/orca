import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  open,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  type FileHandle
} from 'node:fs/promises'
import path from 'node:path'
import {
  readBootIdentity,
  readManagedHookHostIdentity
} from '../agent-hooks/managed-hook-owner-identity'
import {
  assertAuthorityId,
  assertAuthorityStoragePath,
  isRecord
} from '../../shared/terminal-session-authority-identity'
import { failTerminalSessionAuthority } from '../../shared/terminal-session-authority-mutation'

const HOST_IDENTITY_PATH = 'authority-host.json'
const HOST_IDENTITY_RECORD = 'identity.json'
const MAX_HOST_IDENTITY_BYTES = 4 * 1024
const MAX_EXECUTION_SCOPE_COMPONENT_BYTES = 1_024
const UNSAFE_EXECUTION_SCOPE_TEXT = /[\p{Cc}\u2028\u2029]/u

export type TerminalAuthorityExecutionScope = Readonly<{
  executionScope?: string
  bootId?: string
  linuxPidNamespace?: string
}>

type TerminalAuthorityExecutionScopeDependencies = Readonly<{
  readBootIdentity?: () => Promise<string | undefined>
  readHostIdentity?: () => Promise<string | undefined>
  readLinuxPidNamespace?: (pid: number | 'self') => Promise<string | undefined>
}>

let currentExecutionScopePromise: Promise<TerminalAuthorityExecutionScope> | undefined

export async function readCurrentTerminalAuthorityExecutionScope(): Promise<TerminalAuthorityExecutionScope> {
  currentExecutionScopePromise ??= inspectTerminalAuthorityExecutionScope(process.platform)
  return await currentExecutionScopePromise
}

export async function inspectTerminalAuthorityExecutionScope(
  platform: NodeJS.Platform,
  dependencies: TerminalAuthorityExecutionScopeDependencies = {}
): Promise<TerminalAuthorityExecutionScope> {
  try {
    if (platform === 'linux') {
      const [hostIdentity, bootId, linuxPidNamespace] = await Promise.all([
        (dependencies.readHostIdentity ?? readProvenManagedHookHostIdentity)(),
        (dependencies.readBootIdentity ?? readBootIdentity)(),
        (dependencies.readLinuxPidNamespace ?? readTerminalAuthorityLinuxPidNamespace)('self')
      ])
      return createExecutionScope(platform, [provenHostIdentity(hostIdentity), linuxPidNamespace], {
        bootId,
        linuxPidNamespace
      })
    }
    if (platform === 'darwin') {
      const hostIdentity = await (
        dependencies.readHostIdentity ?? readProvenManagedHookHostIdentity
      )()
      return createExecutionScope(platform, [provenHostIdentity(hostIdentity), 'global'])
    }
    if (platform === 'win32') {
      const hostIdentity = await (
        dependencies.readHostIdentity ?? readProvenManagedHookHostIdentity
      )()
      return createExecutionScope(platform, [provenHostIdentity(hostIdentity), 'global'])
    }
  } catch {
    // An unreadable scope cannot authorize owner death.
  }
  return Object.freeze({})
}

export async function readTerminalAuthorityLinuxPidNamespace(
  pid: number | 'self'
): Promise<string | undefined> {
  try {
    return normalizeExecutionScopeComponent(await readlink(`/proc/${pid}/ns/pid`))
  } catch {
    return undefined
  }
}

export async function readOrCreateTerminalAuthorityHostId(
  directory: string,
  createId: () => string = randomUUID
): Promise<string> {
  assertAuthorityStoragePath(directory, 'authority host directory')
  const resolvedDirectory = path.resolve(directory)
  await mkdir(resolvedDirectory, { recursive: true })
  const existing = await readHostId(resolvedDirectory)
  if (existing) {
    return existing
  }

  const authorityHostId = createId()
  assertAuthorityId(authorityHostId, 'authorityHostId')
  const target = path.join(resolvedDirectory, HOST_IDENTITY_PATH)
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    await mkdir(temporary, { mode: 0o700 })
    await writeSyncedFile(
      path.join(temporary, HOST_IDENTITY_RECORD),
      `${JSON.stringify({ version: 1, authorityHostId })}\n`
    )
    await syncDirectory(temporary)
    if (await publishDirectoryExclusive(temporary, target)) {
      await syncDirectory(resolvedDirectory)
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  const published = await readHostId(resolvedDirectory)
  if (!published) {
    failTerminalSessionAuthority('record-corrupt', 'authority host identity was not published')
  }
  return published
}

async function readHostId(directory: string): Promise<string | null> {
  const target = path.join(directory, HOST_IDENTITY_PATH)
  let metadata
  try {
    metadata = await stat(target)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return null
    }
    throw error
  }
  if (metadata.isFile()) {
    return readIdentityRecord(target, metadata.size)
  }
  if (!metadata.isDirectory()) {
    failTerminalSessionAuthority('record-corrupt', 'authority host identity is invalid')
  }
  const record = path.join(target, HOST_IDENTITY_RECORD)
  let recordMetadata
  try {
    recordMetadata = await stat(record)
  } catch {
    failTerminalSessionAuthority('record-corrupt', 'authority host identity is corrupt')
  }
  if (!recordMetadata.isFile()) {
    failTerminalSessionAuthority('record-corrupt', 'authority host identity is invalid')
  }
  return readIdentityRecord(record, recordMetadata.size)
}

async function readIdentityRecord(file: string, size: number): Promise<string> {
  if (size < 1 || size > MAX_HOST_IDENTITY_BYTES) {
    failTerminalSessionAuthority('record-corrupt', 'authority host identity is invalid')
  }
  let value: unknown
  try {
    value = JSON.parse(await readFile(file, 'utf8')) as unknown
  } catch {
    failTerminalSessionAuthority('record-corrupt', 'authority host identity is corrupt')
  }
  if (!isRecord(value) || value.version !== 1) {
    failTerminalSessionAuthority('record-corrupt', 'authority host identity is corrupt')
  }
  assertAuthorityId(value.authorityHostId, 'authorityHostId')
  return value.authorityHostId
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
      if (errorCode(targetError) !== 'ENOENT') {
        throw targetError
      }
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

function createExecutionScope(
  platform: NodeJS.Platform,
  components: readonly (string | undefined)[],
  evidence: Omit<TerminalAuthorityExecutionScope, 'executionScope'> = {}
): TerminalAuthorityExecutionScope {
  const normalizedComponents = components.map(normalizeExecutionScopeComponent)
  const bootId = normalizeExecutionScopeComponent(evidence.bootId)
  const linuxPidNamespace = normalizeExecutionScopeComponent(evidence.linuxPidNamespace)
  const normalizedEvidence = {
    ...(bootId ? { bootId } : {}),
    ...(linuxPidNamespace ? { linuxPidNamespace } : {})
  }
  if (normalizedComponents.some((component) => component === undefined)) {
    return Object.freeze(normalizedEvidence)
  }
  const digest = createHash('sha256')
    .update(JSON.stringify([platform, ...normalizedComponents]))
    .digest('base64url')
  return Object.freeze({
    executionScope: `terminal-authority-execution-v1:${platform}:${digest}`,
    ...normalizedEvidence
  })
}

async function readProvenManagedHookHostIdentity(): Promise<string | undefined> {
  return provenHostIdentity(await readManagedHookHostIdentity())
}

function provenHostIdentity(identity: string | undefined): string | undefined {
  const normalized = normalizeExecutionScopeComponent(identity)
  return normalized?.startsWith('runtime:') ? undefined : normalized
}

function normalizeExecutionScopeComponent(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized &&
    !UNSAFE_EXECUTION_SCOPE_TEXT.test(normalized) &&
    new TextEncoder().encode(normalized).byteLength <= MAX_EXECUTION_SCOPE_COMPONENT_BYTES
    ? normalized
    : undefined
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
}
