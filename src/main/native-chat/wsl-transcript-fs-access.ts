import { createReadStream, type Dirent, type Stats } from 'node:fs'
import { lstat, open, readdir, readFile, stat, type FileHandle } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { isWslUncPath } from '../../shared/wsl-paths'
import { runWslTranscriptFsTask, type WslTranscriptFsTaskPriority } from './wsl-transcript-fs-gate'

/**
 * Transcript-layer filesystem primitives that route WSL UNC paths through the
 * admission gate and everything else straight to `node:fs`. The `isWslUncPath`
 * guard is the single switch: macOS, Linux, Windows drive paths, SSH remotes and
 * folder workspaces execute the exact call they execute today.
 *
 * Invariant future call sites must preserve: every gated unit here is a single
 * syscall, and `openTranscriptReadStream` composes them OUTSIDE the gate. A
 * gated call awaited from inside another gated task's operation would deadlock
 * on the single scan slot or the route+priority lane.
 */

// Why: one deadline per chunk instead of one for the whole file, so a large
// healthy-but-slow transcript is not false-failed by a whole-file timeout.
const WSL_TRANSCRIPT_READ_CHUNK_BYTES = 1024 * 1024

export function wslGatedStat(
  path: string,
  priority: WslTranscriptFsTaskPriority,
  signal?: AbortSignal
): Promise<Stats> {
  if (!isWslUncPath(path)) {
    return stat(path)
  }
  return runWslTranscriptFsTask({ operation: 'stat', path, priority, signal }, () => stat(path))
}

export function wslGatedLstat(
  path: string,
  priority: WslTranscriptFsTaskPriority,
  signal?: AbortSignal
): Promise<Stats> {
  if (!isWslUncPath(path)) {
    return lstat(path)
  }
  return runWslTranscriptFsTask({ operation: 'lstat', path, priority, signal }, () => lstat(path))
}

export function wslGatedReaddir(
  path: string,
  priority: WslTranscriptFsTaskPriority,
  signal?: AbortSignal
): Promise<Dirent[]> {
  if (!isWslUncPath(path)) {
    return readdir(path, { withFileTypes: true })
  }
  return runWslTranscriptFsTask({ operation: 'readdir', path, priority, signal }, () =>
    readdir(path, { withFileTypes: true })
  )
}

export function wslGatedReadFile(
  path: string,
  encoding: BufferEncoding,
  priority: WslTranscriptFsTaskPriority,
  signal?: AbortSignal
): Promise<string> {
  if (!isWslUncPath(path)) {
    return readFile(path, encoding)
  }
  return runWslTranscriptFsTask({ operation: 'readfile', path, priority, signal }, () =>
    readFile(path, encoding)
  )
}

// dedupe:false — two joiners would share one FileHandle and both close it.
export function wslGatedOpen(
  path: string,
  priority: WslTranscriptFsTaskPriority,
  signal?: AbortSignal
): Promise<FileHandle> {
  if (!isWslUncPath(path)) {
    return open(path, 'r')
  }
  return runWslTranscriptFsTask(
    {
      operation: 'open',
      path,
      priority,
      signal,
      dedupe: false,
      // An unabortable open can still succeed after its caller timed out or
      // cancelled; without this the descriptor leaks for the process lifetime.
      onAbandonedResult: (handle) => void closeTranscriptHandle(handle, path)
    },
    () => open(path, 'r')
  )
}

/**
 * `path` is only the gate's route key and UNC guard — the handle carries no
 * path and is never re-opened. dedupe:false because `read` fills the CALLER's
 * buffer: a joiner would receive the first caller's buffer while its own
 * (often `Buffer.allocUnsafe`) stays uninitialized.
 */
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
  if (!isWslUncPath(path)) {
    return handle.read(buffer, offset, length, position)
  }
  return runWslTranscriptFsTask({ operation: 'read', path, priority, signal, dedupe: false }, () =>
    handle.read(buffer, offset, length, position)
  )
}

/**
 * Never gated. Off UNC this is the prior contract verbatim — the caller awaits
 * fd teardown and a close failure surfaces. On UNC it is fire-and-forget:
 * closing a handle on a stalled mount can itself block, and a gated close would
 * burn a permit and a waiter deadline purely for teardown. One leaked fd until
 * the OS unblocks beats a second blocked waiter.
 */
export function closeTranscriptHandle(handle: FileHandle, path: string): Promise<void> {
  if (!isWslUncPath(path)) {
    return handle.close()
  }
  void handle.close().catch(() => {})
  return Promise.resolve()
}

/**
 * Open, read one slice, close — for callers that want bytes at an offset and
 * never touch the handle. Each of the two syscalls is admitted separately, so a
 * stalled mount fails at whichever one it blocks on.
 */
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
    const read = await wslGatedRead(handle, path, buffer, 0, length, position, priority, signal)
    return buffer.subarray(0, read.bytesRead)
  } finally {
    await closeTranscriptHandle(handle, path)
  }
}

export type TranscriptReadStreamOptions = {
  start?: number
  /** Inclusive, matching `createReadStream`. */
  end?: number
  /** Set it to get decoded string chunks on both branches; leave it unset and
   *  the UNC branch yields `Buffer`s the consumer must decode incrementally
   *  itself, since a chunk boundary can split a multibyte codepoint. */
  encoding?: BufferEncoding
}

async function* gatedChunks(
  path: string,
  options: TranscriptReadStreamOptions,
  priority: WslTranscriptFsTaskPriority,
  signal?: AbortSignal
): AsyncGenerator<Buffer | string> {
  const handle = await wslGatedOpen(path, priority, signal)
  // Why: chunk boundaries fall mid-codepoint, so decoding each slice
  // independently would emit U+FFFD on both sides of any straddling character.
  // The decoder carries the partial sequence across chunks, as the
  // `createReadStream` branch's own decoder does.
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
    // Trailing bytes of an incomplete sequence at EOF, replacement-char'd once.
    const trailing = decoder?.end()
    if (trailing) {
      yield trailing
    }
  } finally {
    // Runs on `.destroy()` too (Readable.from calls the generator's return()),
    // so an aborted head-read cannot leak the gated handle.
    await closeTranscriptHandle(handle, path)
  }
}

/**
 * A read stream whose UNC branch admits and deadlines each 1 MiB chunk
 * separately. A gate refusal mid-stream surfaces as an `'error'` event carrying
 * the `WslTranscriptFsError`, which every existing consumer funnels into its
 * `catch`.
 */
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
