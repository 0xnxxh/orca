import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm, stat, truncate, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import {
  assertAuthorityNamespace,
  type TerminalAuthorityNamespace
} from '../../shared/terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  TerminalSessionAuthorityError,
  type TerminalSessionAuthorityLogEvent,
  type TerminalSessionAuthorityLogRecord,
  type TerminalSessionAuthoritySnapshot
} from '../../shared/terminal-session-authority-mutation'
import { assertSafeInteger } from '../../shared/terminal-session-authority-record-validation'
import {
  readTerminalAuthorityRecordFiles,
  TERMINAL_AUTHORITY_CHECKPOINT_FILE,
  TERMINAL_AUTHORITY_LOG_FILE,
  type TerminalAuthorityCheckpoint
} from './terminal-session-authority-record-files'
import { removeAuthorityCrashTemporaryFiles } from './terminal-session-authority-temporary-files'
import type { TerminalAuthorityWriterLock } from './terminal-session-authority-writer-lock'

export const TERMINAL_AUTHORITY_DEFAULT_MAX_CHECKPOINT_BYTES = 32 * 1024 * 1024
export const TERMINAL_AUTHORITY_DEFAULT_MAX_LOG_BYTES = 64 * 1024 * 1024

export type TerminalAuthorityFileStoreOptions = Readonly<{
  directory: string
  namespace: TerminalAuthorityNamespace
  lock: TerminalAuthorityWriterLock
  maxCheckpointBytes?: number
  maxLogBytes?: number
  onCrashBoundary?: (
    boundary: 'record-synced' | 'checkpoint-synced' | 'checkpoint-renamed' | 'log-reset-renamed',
    detail: Readonly<{
      namespace: TerminalAuthorityNamespace
      recordId?: number
      eventKind?: TerminalSessionAuthorityLogEvent['kind']
    }>
  ) => void
}>

export type OpenTerminalAuthorityFileStore = Readonly<{
  store: TerminalAuthorityFileStore
  checkpoint: TerminalSessionAuthoritySnapshot | null
  records: readonly TerminalSessionAuthorityLogRecord[]
}>

export class TerminalAuthorityFileStore {
  private queue: Promise<void> = Promise.resolve()
  private poisoned = false
  private accepting = true
  private closed = false
  private closePromise: Promise<void> | null = null

  private constructor(
    private readonly options: TerminalAuthorityFileStoreOptions,
    private recordId: number,
    private readonly maxLogBytes: number,
    private readonly maxCheckpointBytes: number,
    private logBytes: number,
    private recordsSinceCheckpoint: number
  ) {}

  static async open(
    options: TerminalAuthorityFileStoreOptions
  ): Promise<OpenTerminalAuthorityFileStore> {
    assertAuthorityNamespace(options.namespace)
    const directory = path.resolve(options.directory)
    await mkdir(directory, { recursive: true })
    const maxCheckpointBytes = positiveLimit(
      options.maxCheckpointBytes,
      TERMINAL_AUTHORITY_DEFAULT_MAX_CHECKPOINT_BYTES
    )
    const maxLogBytes = positiveLimit(options.maxLogBytes, TERMINAL_AUTHORITY_DEFAULT_MAX_LOG_BYTES)
    await options.lock.runExclusive(() =>
      removeAuthorityCrashTemporaryFiles(directory, [
        TERMINAL_AUTHORITY_CHECKPOINT_FILE,
        TERMINAL_AUTHORITY_LOG_FILE
      ])
    )
    const { checkpoint, log: loadedLog } = await readTerminalAuthorityRecordFiles(
      directory,
      options.namespace,
      maxCheckpointBytes,
      maxLogBytes
    )
    const throughRecordId = checkpoint?.throughRecordId ?? 0
    await options.lock.runExclusive(async () => {
      if (loadedLog.truncateToBytes !== null) {
        await truncate(path.join(directory, TERMINAL_AUTHORITY_LOG_FILE), loadedLog.truncateToBytes)
      }
      await ensureLogFile(directory)
    })
    const records = loadedLog.records
    const recordId = records.at(-1)?.recordId ?? throughRecordId
    const store = new TerminalAuthorityFileStore(
      { ...options, directory },
      recordId,
      maxLogBytes,
      maxCheckpointBytes,
      loadedLog.completeBytes,
      records.length
    )
    return Object.freeze({
      store,
      checkpoint: checkpoint?.snapshot ?? null,
      records: Object.freeze(records)
    })
  }

  append(event: TerminalSessionAuthorityLogEvent): Promise<TerminalSessionAuthorityLogRecord> {
    return this.enqueue(async () => {
      const record = Object.freeze({
        version: 1 as const,
        recordId: this.recordId + 1,
        writerEpoch: this.options.lock.identity.epoch,
        event
      })
      await this.options.lock.runExclusive(async () => {
        const bytes = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8')
        const logPath = path.join(this.options.directory, TERMINAL_AUTHORITY_LOG_FILE)
        const metadata = await stat(logPath)
        if (metadata.size + bytes.byteLength > this.maxLogBytes) {
          failTerminalSessionAuthority('capacity', 'authority log reached its durable size limit')
        }
        const handle = await open(logPath, 'a', 0o600)
        try {
          await writeFully(handle, bytes)
          await handle.sync()
        } finally {
          await handle.close()
        }
        this.options.onCrashBoundary?.('record-synced', {
          namespace: this.options.namespace,
          recordId: record.recordId,
          eventKind: event.kind
        })
      })
      this.recordId = record.recordId
      this.logBytes += Buffer.byteLength(`${JSON.stringify(record)}\n`, 'utf8')
      this.recordsSinceCheckpoint += 1
      return record
    })
  }

  get shouldCompact(): boolean {
    return (
      this.recordsSinceCheckpoint >= 1_024 ||
      this.logBytes >= Math.max(1, Math.floor(this.maxLogBytes / 2))
    )
  }

  compact(snapshot: TerminalSessionAuthoritySnapshot): Promise<void> {
    return this.enqueue(async () => {
      if (snapshot.writerEpoch !== this.options.lock.identity.epoch) {
        failTerminalSessionAuthority('writer-fenced', 'checkpoint writer epoch is stale')
      }
      const checkpoint: TerminalAuthorityCheckpoint = Object.freeze({
        version: 1,
        namespace: this.options.namespace,
        throughRecordId: this.recordId,
        snapshot
      })
      await this.options.lock.runExclusive(() => this.writeCompaction(checkpoint))
      this.logBytes = 0
      this.recordsSinceCheckpoint = 0
    })
  }

  assertWriterCurrent(): Promise<void> {
    return this.options.lock.runExclusive(async () => {})
  }

  async close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise
    }
    this.accepting = false
    this.closePromise = (async () => {
      await this.queue
      this.closed = true
      await this.options.lock.release()
    })()
    return this.closePromise
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.accepting || this.closed || this.poisoned) {
      failTerminalSessionAuthority('writer-fenced', 'authority store is unavailable')
    }
    const result = this.queue.then(operation)
    this.queue = result.then(
      () => undefined,
      (error) => {
        if (!(error instanceof TerminalSessionAuthorityError && error.code === 'capacity')) {
          this.poisoned = true
        }
      }
    )
    return result
  }

  private async writeCompaction(checkpoint: TerminalAuthorityCheckpoint): Promise<void> {
    const checkpointPath = path.join(this.options.directory, TERMINAL_AUTHORITY_CHECKPOINT_FILE)
    const logPath = path.join(this.options.directory, TERMINAL_AUTHORITY_LOG_FILE)
    const checkpointTemp = temporarySibling(checkpointPath)
    const logTemp = temporarySibling(logPath)
    try {
      const checkpointContents = `${JSON.stringify(checkpoint)}\n`
      if (Buffer.byteLength(checkpointContents, 'utf8') > this.maxCheckpointBytes) {
        failTerminalSessionAuthority('capacity', 'authority checkpoint exceeds its size limit')
      }
      await writeSyncedFile(checkpointTemp, checkpointContents)
      this.options.onCrashBoundary?.('checkpoint-synced', {
        namespace: this.options.namespace
      })
      await rename(checkpointTemp, checkpointPath)
      await syncDirectory(this.options.directory)
      this.options.onCrashBoundary?.('checkpoint-renamed', {
        namespace: this.options.namespace
      })
      await writeSyncedFile(logTemp, '')
      await rename(logTemp, logPath)
      await syncDirectory(this.options.directory)
      this.options.onCrashBoundary?.('log-reset-renamed', {
        namespace: this.options.namespace
      })
    } finally {
      await rm(checkpointTemp, { force: true })
      await rm(logTemp, { force: true })
    }
  }
}

async function ensureLogFile(directory: string): Promise<void> {
  const handle = await open(path.join(directory, TERMINAL_AUTHORITY_LOG_FILE), 'a', 0o600)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  await syncDirectory(directory)
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

async function writeFully(handle: FileHandle, bytes: Buffer): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset)
    if (bytesWritten < 1) {
      throw new Error('authority log write made no progress')
    }
    offset += bytesWritten
  }
}

function temporarySibling(file: string): string {
  return `${file}.${process.pid}.${randomUUID()}.tmp`
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

function positiveLimit(value: number | undefined, fallback: number): number {
  const selected = value ?? fallback
  assertSafeInteger(selected, 'persistence size limit', 1)
  return selected
}
