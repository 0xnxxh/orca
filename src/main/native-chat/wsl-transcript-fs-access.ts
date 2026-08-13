import { createReadStream, type Dirent, type Stats } from 'node:fs'
import { lstat, open, readdir, readFile, stat, type FileHandle } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { isWslUncPath } from '../../shared/wsl-paths'
import { runWslTranscriptFsTask, type WslTranscriptFsTaskPriority } from './wsl-transcript-fs-gate'

const WSL_TRANSCRIPT_READ_CHUNK_BYTES = 1024 * 1024
type Operation = Parameters<typeof runWslTranscriptFsTask>[0]['operation']

function runPathOperation<T>(
  operation: Operation,
  path: string,
  priority: WslTranscriptFsTaskPriority,
  signal: AbortSignal | undefined,
  task: () => Promise<T>,
  options?: { dedupe?: boolean; onAbandonedResult?: (value: T) => void }
): Promise<T> {
  return isWslUncPath(path)
    ? runWslTranscriptFsTask({ operation, path, priority, signal, ...options }, task)
    : task()
}

export function wslGatedStat(
  path: string,
  priority: WslTranscriptFsTaskPriority,
  signal?: AbortSignal
): Promise<Stats> {
  return runPathOperation('stat', path, priority, signal, () => stat(path))
}

export function wslGatedLstat(
  path: string,
  priority: WslTranscriptFsTaskPriority,
  signal?: AbortSignal
): Promise<Stats> {
  return runPathOperation('lstat', path, priority, signal, () => lstat(path))
}

export function wslGatedReaddir(
  path: string,
  priority: WslTranscriptFsTaskPriority,
  signal?: AbortSignal
): Promise<Dirent[]> {
  return runPathOperation('readdir', path, priority, signal, () =>
    readdir(path, { withFileTypes: true })
  )
}

export function wslGatedReadFile(
  path: string,
  encoding: BufferEncoding,
  priority: WslTranscriptFsTaskPriority,
  signal?: AbortSignal
): Promise<string> {
  return runPathOperation('readfile', path, priority, signal, () => readFile(path, encoding))
}

export function wslGatedOpen(
  path: string,
  priority: WslTranscriptFsTaskPriority,
  signal?: AbortSignal
): Promise<FileHandle> {
  return runPathOperation('open', path, priority, signal, () => open(path, 'r'), {
    dedupe: false,
    onAbandonedResult: (handle) => void closeTranscriptHandle(handle, path)
  })
}

export function wslGatedRead(
  handle: FileHandle,
  path: string,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number,
  priority: WslTranscriptFsTaskPriority,
  signal?: AbortSignal
): Promise<{ bytesRead: number; buffer: Buffer }> {
  return runPathOperation(
    'read',
    path,
    priority,
    signal,
    () => handle.read(buffer, offset, length, position),
    { dedupe: false }
  )
}

export function closeTranscriptHandle(handle: FileHandle, path: string): Promise<void> {
  if (!isWslUncPath(path)) {
    return handle.close()
  }
  void handle.close().catch(() => {})
  return Promise.resolve()
}

export async function readTranscriptSlice(
  path: string,
  position: number,
  length: number,
  priority: WslTranscriptFsTaskPriority,
  signal?: AbortSignal
): Promise<Buffer> {
  const handle = await wslGatedOpen(path, priority, signal)
  try {
    const buffer = Buffer.allocUnsafe(length)
    const { bytesRead } = await wslGatedRead(
      handle,
      path,
      buffer,
      0,
      length,
      position,
      priority,
      signal
    )
    return buffer.subarray(0, bytesRead)
  } finally {
    await closeTranscriptHandle(handle, path)
  }
}

export type TranscriptReadStreamOptions = {
  start?: number
  end?: number
  encoding?: BufferEncoding
}

async function* gatedChunks(
  path: string,
  options: TranscriptReadStreamOptions,
  priority: WslTranscriptFsTaskPriority,
  signal?: AbortSignal
): AsyncGenerator<Buffer | string> {
  const handle = await wslGatedOpen(path, priority, signal)
  const decoder = options.encoding ? new StringDecoder(options.encoding) : null
  try {
    let position = options.start ?? 0
    for (;;) {
      const length =
        options.end === undefined
          ? WSL_TRANSCRIPT_READ_CHUNK_BYTES
          : Math.min(WSL_TRANSCRIPT_READ_CHUNK_BYTES, options.end - position + 1)
      if (length <= 0) {
        break
      }
      const buffer = Buffer.allocUnsafe(length)
      const { bytesRead } = await wslGatedRead(
        handle,
        path,
        buffer,
        0,
        length,
        position,
        priority,
        signal
      )
      if (bytesRead <= 0) {
        break
      }
      position += bytesRead
      const chunk = buffer.subarray(0, bytesRead)
      if (!decoder) {
        yield chunk
        continue
      }
      const decoded = decoder.write(chunk)
      if (decoded) {
        yield decoded
      }
    }
    const trailing = decoder?.end()
    if (trailing) {
      yield trailing
    }
  } finally {
    await closeTranscriptHandle(handle, path)
  }
}

export function openTranscriptReadStream(
  path: string,
  options: TranscriptReadStreamOptions,
  priority: WslTranscriptFsTaskPriority,
  signal?: AbortSignal
): Readable {
  if (!isWslUncPath(path)) {
    return createReadStream(path, options)
  }
  return Readable.from(gatedChunks(path, options, priority, signal))
}
