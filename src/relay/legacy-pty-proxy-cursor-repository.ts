import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { PtySourceRecoveryRequest } from '../shared/pty-source-recovery-contract'
import type {
  LegacyPtyProxyCheckpointStore,
  LegacyPtyProxyCursorCheckpoint,
  LegacyPtyProxyRestoredCursor
} from './legacy-pty-proxy-cursor'

const CURSOR_REPOSITORY_VERSION = 1
const DEFAULT_MAX_CURSOR_RECORDS = 256
const DEFAULT_MAX_CURSOR_BYTES = 1024 * 1024

type CursorRecord = Readonly<{
  bindingKey: string
  checkpoint: LegacyPtyProxyCursorCheckpoint
}>

type CursorSnapshot = Readonly<{
  version: typeof CURSOR_REPOSITORY_VERSION
  records: readonly CursorRecord[]
}>

export type LegacyPtyProxyCursorRestore = Readonly<{
  checkpoint: LegacyPtyProxyCursorCheckpoint
  cursor: LegacyPtyProxyRestoredCursor
  sourceRecovery: PtySourceRecoveryRequest
}>

export type LegacyPtyProxyCursorRepository = Readonly<{
  restore(bindingKey: string): LegacyPtyProxyCursorRestore | null
  checkpointStore(bindingKey: string): LegacyPtyProxyCheckpointStore
}>

export class FileLegacyPtyProxyCursorRepository implements LegacyPtyProxyCursorRepository {
  private readonly records = new Map<string, LegacyPtyProxyCursorCheckpoint>()
  private tail: Promise<void> = Promise.resolve()

  private constructor(
    private readonly file: string,
    private readonly maxRecords: number,
    private readonly maxBytes: number
  ) {}

  static async open(
    file: string,
    limits: Readonly<{ maxRecords?: number; maxBytes?: number }> = {}
  ): Promise<FileLegacyPtyProxyCursorRepository> {
    const maxRecords = positiveLimit(limits.maxRecords, DEFAULT_MAX_CURSOR_RECORDS)
    const maxBytes = positiveLimit(limits.maxBytes, DEFAULT_MAX_CURSOR_BYTES)
    await mkdir(dirname(file), { recursive: true })
    const repository = new FileLegacyPtyProxyCursorRepository(file, maxRecords, maxBytes)
    const snapshot = await readSnapshot(file, maxBytes)
    for (const record of snapshot?.records ?? []) {
      assertBindingKey(record.bindingKey)
      assertCheckpoint(record.checkpoint)
      if (repository.records.has(record.bindingKey)) {
        throw new Error('legacy PTY proxy cursor binding is duplicated')
      }
      repository.records.set(record.bindingKey, Object.freeze(structuredClone(record.checkpoint)))
    }
    if (repository.records.size > maxRecords) {
      throw new Error('legacy PTY proxy cursor repository exceeds its bound')
    }
    return repository
  }

  restore(bindingKey: string): LegacyPtyProxyCursorRestore | null {
    assertBindingKey(bindingKey)
    const checkpoint = this.records.get(bindingKey)
    if (!checkpoint) {
      return null
    }
    return Object.freeze({
      checkpoint: structuredClone(checkpoint),
      cursor: Object.freeze({
        durableDownstreamAckedEndSu: checkpoint.creditedEndSu,
        upstreamAckedEndSu: 0
      }),
      sourceRecovery: Object.freeze({
        status: 'checkpoint',
        clientGeneration: checkpoint.identity.clientGeneration,
        ownerGeneration: checkpoint.identity.ownerGeneration,
        ptyIncarnation: checkpoint.identity.ptyIncarnation,
        deliveryToken: checkpoint.identity.deliveryToken,
        acceptedSourceEndSu: checkpoint.creditedEndSu
      })
    })
  }

  checkpointStore(bindingKey: string): LegacyPtyProxyCheckpointStore {
    assertBindingKey(bindingKey)
    return Object.freeze({
      commit: (checkpoint: LegacyPtyProxyCursorCheckpoint) =>
        this.enqueueCommit(bindingKey, checkpoint)
    })
  }

  private enqueueCommit(
    bindingKey: string,
    unsafeCheckpoint: LegacyPtyProxyCursorCheckpoint
  ): Promise<void> {
    const checkpoint = Object.freeze(structuredClone(unsafeCheckpoint))
    assertCheckpoint(checkpoint)
    const operation = this.tail.then(async () => {
      const previous = this.records.get(bindingKey)
      if (previous && checkpoint.creditedEndSu < previous.creditedEndSu) {
        throw new Error('legacy PTY proxy cursor regressed')
      }
      if (!previous && this.records.size >= this.maxRecords) {
        throw new Error('legacy PTY proxy cursor repository is full')
      }
      this.records.set(bindingKey, checkpoint)
      try {
        await this.writeSnapshot()
      } catch (error) {
        if (previous) {
          this.records.set(bindingKey, previous)
        } else {
          this.records.delete(bindingKey)
        }
        throw error
      }
    })
    this.tail = operation.catch(() => {})
    return operation
  }

  private async writeSnapshot(): Promise<void> {
    const snapshot: CursorSnapshot = Object.freeze({
      version: CURSOR_REPOSITORY_VERSION,
      records: Object.freeze(
        [...this.records.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([bindingKey, checkpoint]) => Object.freeze({ bindingKey, checkpoint }))
      )
    })
    const encoded = `${JSON.stringify(snapshot)}\n`
    if (Buffer.byteLength(encoded) > this.maxBytes) {
      throw new Error('legacy PTY proxy cursor snapshot exceeds its bound')
    }
    const temporary = `${this.file}.${process.pid}.tmp`
    try {
      const handle = await open(temporary, 'w', 0o600)
      try {
        await handle.writeFile(encoded, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporary, this.file)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      throw error
    }
    await syncDirectory(dirname(this.file))
  }
}

async function readSnapshot(file: string, maxBytes: number): Promise<CursorSnapshot | null> {
  let encoded: Buffer
  try {
    encoded = await readFile(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
  if (encoded.byteLength < 1 || encoded.byteLength > maxBytes) {
    throw new Error('legacy PTY proxy cursor snapshot is not bounded')
  }
  const value = JSON.parse(encoded.toString('utf8')) as Partial<CursorSnapshot>
  if (value.version !== CURSOR_REPOSITORY_VERSION || !Array.isArray(value.records)) {
    throw new Error('legacy PTY proxy cursor snapshot is invalid')
  }
  return value as CursorSnapshot
}

function assertCheckpoint(checkpoint: LegacyPtyProxyCursorCheckpoint): void {
  if (
    !checkpoint.checkpointId ||
    !checkpoint.acknowledgementId ||
    !checkpoint.identity?.deliveryToken ||
    !Number.isSafeInteger(checkpoint.creditedEndSu) ||
    checkpoint.creditedEndSu < 0
  ) {
    throw new Error('legacy PTY proxy cursor checkpoint is invalid')
  }
  assertDeliveryIdentity(checkpoint.identity)
  if (checkpoint.downstreamIdentity) {
    assertDeliveryIdentity(checkpoint.downstreamIdentity)
  }
}

function assertDeliveryIdentity(identity: LegacyPtyProxyCursorCheckpoint['identity']): void {
  if (
    !identity.id ||
    !identity.ptyIncarnation ||
    !identity.deliveryToken ||
    !Number.isSafeInteger(identity.providerGeneration) ||
    identity.providerGeneration < 1 ||
    !Number.isSafeInteger(identity.clientGeneration) ||
    identity.clientGeneration < 1 ||
    !Number.isSafeInteger(identity.ownerGeneration) ||
    identity.ownerGeneration < 1
  ) {
    throw new Error('legacy PTY proxy cursor delivery identity is invalid')
  }
}

function assertBindingKey(bindingKey: string): void {
  if (!bindingKey || Buffer.byteLength(bindingKey) > 4_096 || bindingKey.includes('\0')) {
    throw new Error('legacy PTY proxy cursor binding key is invalid')
  }
}

function positiveLimit(value: number | undefined, fallback: number): number {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected < 1) {
    throw new Error('legacy PTY proxy cursor repository limit is invalid')
  }
  return selected
}

async function syncDirectory(path: string): Promise<void> {
  let directory
  try {
    directory = await open(path, 'r')
    await directory.sync()
  } catch (error) {
    if (
      !['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(
        (error as NodeJS.ErrnoException).code ?? ''
      )
    ) {
      throw error
    }
  } finally {
    await directory?.close()
  }
}
