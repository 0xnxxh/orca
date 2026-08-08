import { randomUUID } from 'node:crypto'
import { open, readFile, rename, rm, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import type { LegacyRelayGcPathIdentity } from './legacy-relay-gc-path-policy'
import type { LegacyRelayGcQuarantineHold } from './legacy-relay-gc-quarantine'

const STORE_VERSION = 1
const MAX_STORE_BYTES = 256 * 1024
const MAX_HOLDS = 256

type QuarantineStoreSnapshot = Readonly<{
  version: typeof STORE_VERSION
  holds: readonly LegacyRelayGcQuarantineHold[]
}>

export class LegacyRelayGcQuarantineStore {
  private readonly holdsByPath = new Map<string, LegacyRelayGcQuarantineHold>()

  private constructor(
    private readonly file: string,
    holds: readonly LegacyRelayGcQuarantineHold[]
  ) {
    for (const hold of holds) {
      this.holdsByPath.set(hold.quarantinePath, hold)
    }
  }

  static async open(file: string): Promise<LegacyRelayGcQuarantineStore> {
    const snapshot = await readSnapshot(file)
    return new LegacyRelayGcQuarantineStore(file, snapshot?.holds ?? [])
  }

  values(): readonly LegacyRelayGcQuarantineHold[] {
    return Object.freeze([...this.holdsByPath.values()])
  }

  async add(hold: LegacyRelayGcQuarantineHold): Promise<void> {
    assertHold(hold)
    if (!this.holdsByPath.has(hold.quarantinePath) && this.holdsByPath.size >= MAX_HOLDS) {
      throw new Error('legacy relay GC quarantine hold capacity exceeded')
    }
    this.holdsByPath.set(hold.quarantinePath, structuredClone(hold))
    await this.persist()
  }

  async remove(quarantinePath: string): Promise<void> {
    if (!this.holdsByPath.delete(quarantinePath)) {
      return
    }
    await this.persist()
  }

  private async persist(): Promise<void> {
    const snapshot: QuarantineStoreSnapshot = Object.freeze({
      version: STORE_VERSION,
      holds: this.values()
    })
    const encoded = `${JSON.stringify(snapshot)}\n`
    if (Buffer.byteLength(encoded) > MAX_STORE_BYTES) {
      throw new Error('legacy relay GC quarantine store exceeds its bound')
    }
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(encoded, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporary, this.file)
      await syncDirectory(path.dirname(this.file))
    } finally {
      await rm(temporary, { force: true })
    }
  }
}

async function readSnapshot(file: string): Promise<QuarantineStoreSnapshot | null> {
  let encoded: Buffer
  try {
    encoded = await readFile(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
  if (encoded.byteLength < 1 || encoded.byteLength > MAX_STORE_BYTES) {
    throw new Error('legacy relay GC quarantine store is not bounded')
  }
  const value = JSON.parse(encoded.toString('utf8')) as Partial<QuarantineStoreSnapshot>
  if (
    value.version !== STORE_VERSION ||
    !Array.isArray(value.holds) ||
    value.holds.length > MAX_HOLDS
  ) {
    throw new Error('legacy relay GC quarantine store is invalid')
  }
  const holds = value.holds.map((hold) => {
    assertHold(hold)
    return Object.freeze(structuredClone(hold))
  })
  if (new Set(holds.map((hold) => hold.quarantinePath)).size !== holds.length) {
    throw new Error('legacy relay GC quarantine store contains duplicate holds')
  }
  return Object.freeze({ version: STORE_VERSION, holds: Object.freeze(holds) })
}

function assertHold(value: unknown): asserts value is LegacyRelayGcQuarantineHold {
  if (typeof value !== 'object' || value === null) {
    throw new Error('legacy relay GC quarantine hold is invalid')
  }
  const hold = value as Partial<LegacyRelayGcQuarantineHold>
  if (
    !boundedPath(hold.originalPath) ||
    !boundedPath(hold.canonicalPath) ||
    !boundedPath(hold.quarantinePath) ||
    !validIdentity(hold.identity)
  ) {
    throw new Error('legacy relay GC quarantine hold is invalid')
  }
}

function validIdentity(value: unknown): value is LegacyRelayGcPathIdentity {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const identity = value as Partial<LegacyRelayGcPathIdentity>
  return (
    typeof identity.directory === 'boolean' &&
    ['device', 'inode', 'changedAtNs', 'bornAtNs', 'modifiedAtNs', 'mode', 'size'].every((field) =>
      /^\d+$/.test(String(identity[field as keyof LegacyRelayGcPathIdentity] ?? ''))
    )
  )
}

function boundedPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 32 * 1024 &&
    !value.includes('\0')
  )
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
