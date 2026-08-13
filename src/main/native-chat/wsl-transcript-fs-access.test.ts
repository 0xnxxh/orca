import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFsModule from 'node:fs'
import type * as NodeFsPromisesModule from 'node:fs/promises'
import type * as GateModule from './wsl-transcript-fs-gate'

const UNC_PATH = '\\\\wsl.localhost\\Ubuntu\\home\\ada\\.codex\\sessions\\a.jsonl'
const LEGACY_UNC_PATH = '\\\\wsl$\\Ubuntu\\home\\ada\\.codex\\sessions\\a.jsonl'
const WINDOWS_PATH = 'C:\\Users\\ada\\.codex\\sessions\\a.jsonl'
const POSIX_PATH = '/home/ada/.codex/sessions/a.jsonl'

const mocks = vi.hoisted(() => ({
  stat: vi.fn(),
  lstat: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  open: vi.fn(),
  createReadStream: vi.fn(),
  runTask: vi.fn()
}))

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFsModule>()),
  createReadStream: mocks.createReadStream
}))

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFsPromisesModule>()),
  stat: mocks.stat,
  lstat: mocks.lstat,
  readdir: mocks.readdir,
  readFile: mocks.readFile,
  open: mocks.open
}))

vi.mock('./wsl-transcript-fs-gate', async (importOriginal) => {
  const original = await importOriginal<typeof GateModule>()
  mocks.runTask.mockImplementation(original.runWslTranscriptFsTask)
  return { ...original, runWslTranscriptFsTask: mocks.runTask }
})

import {
  closeTranscriptHandle,
  openTranscriptReadStream,
  readTranscriptSlice,
  wslGatedLstat,
  wslGatedOpen,
  wslGatedRead,
  wslGatedReaddir,
  wslGatedReadFile,
  wslGatedStat
} from './wsl-transcript-fs-access'
import { WSL_TRANSCRIPT_FS_EXACT_TIMEOUT_MS, WslTranscriptFsError } from './wsl-transcript-fs-gate'

function fakeHandle() {
  return { read: vi.fn(), close: vi.fn(async () => {}) }
}

beforeEach(() => {
  // runTask keeps the real gate implementation installed by the mock factory;
  // only its call log is cleared.
  mocks.runTask.mockClear()
  for (const [name, mock] of Object.entries(mocks)) {
    if (name !== 'runTask') {
      mock.mockReset()
    }
  }
})

describe('transcript filesystem accessor off WSL UNC', () => {
  it.each([
    ['a posix path', POSIX_PATH],
    ['a Windows drive path', WINDOWS_PATH]
  ])('never enters the gate for %s', async (_label, path) => {
    mocks.stat.mockResolvedValue({ size: 1 })
    mocks.lstat.mockResolvedValue({ size: 1 })
    mocks.readdir.mockResolvedValue([])
    mocks.readFile.mockResolvedValue('body')
    const handle = fakeHandle()
    handle.read.mockResolvedValue({ bytesRead: 0, buffer: Buffer.alloc(0) })
    mocks.open.mockResolvedValue(handle)
    mocks.createReadStream.mockReturnValue('raw-stream')

    await wslGatedStat(path, 'exact')
    await wslGatedLstat(path, 'scan')
    await wslGatedReaddir(path, 'scan')
    await wslGatedReadFile(path, 'utf-8', 'scan')
    const opened = await wslGatedOpen(path, 'exact')
    await wslGatedRead(opened, path, Buffer.alloc(1), 0, 1, 0, 'exact')
    const stream = openTranscriptReadStream(path, { encoding: 'utf-8' }, 'scan')

    expect(mocks.runTask).not.toHaveBeenCalled()
    expect(mocks.stat).toHaveBeenCalledWith(path)
    expect(mocks.readdir).toHaveBeenCalledWith(path, { withFileTypes: true })
    expect(mocks.readFile).toHaveBeenCalledWith(path, 'utf-8')
    expect(mocks.open).toHaveBeenCalledWith(path, 'r')
    // Off UNC the raw stream is handed back verbatim, encoding included.
    expect(stream).toBe('raw-stream')
    expect(mocks.createReadStream).toHaveBeenCalledWith(path, { encoding: 'utf-8' })
  })
})

describe('transcript filesystem accessor on WSL UNC', () => {
  it.each([
    ['wsl.localhost', UNC_PATH],
    ['wsl$', LEGACY_UNC_PATH]
  ])('routes %s paths through the gate', async (_label, path) => {
    mocks.stat.mockResolvedValue({ size: 7 })
    await expect(wslGatedStat(path, 'exact')).resolves.toEqual({ size: 7 })
    expect(mocks.runTask).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'stat', path, priority: 'exact' }),
      expect.any(Function)
    )
    expect(mocks.createReadStream).not.toHaveBeenCalled()
  })

  it('opts positional reads and opens out of coalescing', async () => {
    const handle = fakeHandle()
    handle.read.mockResolvedValue({ bytesRead: 1, buffer: Buffer.alloc(1) })
    mocks.open.mockResolvedValue(handle)

    const opened = await wslGatedOpen(UNC_PATH, 'exact')
    await wslGatedRead(opened, UNC_PATH, Buffer.alloc(1), 0, 1, 0, 'exact')

    for (const call of mocks.runTask.mock.calls) {
      expect(call[0]).toMatchObject({ dedupe: false })
    }
  })

  it('reads a slice and closes the handle even when the read rejects', async () => {
    const handle = fakeHandle()
    handle.read.mockRejectedValue(new Error('EIO'))
    mocks.open.mockResolvedValue(handle)

    await expect(readTranscriptSlice(UNC_PATH, 4, 8, 'scan')).rejects.toThrow('EIO')
    expect(handle.close).toHaveBeenCalledTimes(1)
  })

  it('yields Buffer chunks and closes the handle when the consumer destroys the stream', async () => {
    const handle = fakeHandle()
    handle.read.mockImplementation(
      async (buffer: Buffer, offset: number, length: number, position: number) => {
        const body = Buffer.from('{"a":1}\n{"b":2}\n')
        const slice = body.subarray(position, Math.min(position + length, body.length))
        slice.copy(buffer, offset)
        return { bytesRead: slice.length, buffer }
      }
    )
    mocks.open.mockResolvedValue(handle)

    const stream = openTranscriptReadStream(UNC_PATH, {}, 'exact')
    const chunks: unknown[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
      break
    }
    stream.destroy()
    await new Promise((resolve) => setImmediate(resolve))

    expect(chunks).toHaveLength(1)
    expect(Buffer.isBuffer(chunks[0])).toBe(true)
    expect((chunks[0] as Buffer).toString('utf-8')).toBe('{"a":1}\n{"b":2}\n')
    expect(handle.close).toHaveBeenCalledTimes(1)
  })

  it('swallows close failures so teardown never rejects', async () => {
    const handle = fakeHandle()
    handle.close.mockRejectedValue(new Error('stalled close'))
    expect(() => closeTranscriptHandle(handle as never)).not.toThrow()
    await new Promise((resolve) => setImmediate(resolve))
  })
})

describe('per-chunk admission', () => {
  it('streams a long healthy-but-slow file past the whole-file deadline', async () => {
    vi.useFakeTimers()
    try {
      const chunkDelayMs = WSL_TRANSCRIPT_FS_EXACT_TIMEOUT_MS / 4
      const totalChunks = 6
      let served = 0
      const handle = fakeHandle()
      handle.read.mockImplementation(
        (buffer: Buffer) =>
          new Promise((resolve) => {
            setTimeout(() => {
              if (served++ >= totalChunks) {
                resolve({ bytesRead: 0, buffer })
                return
              }
              buffer.write('x')
              resolve({ bytesRead: 1, buffer })
            }, chunkDelayMs)
          })
      )
      mocks.open.mockResolvedValue(handle)

      const stream = openTranscriptReadStream(UNC_PATH, {}, 'exact')
      const collected: Promise<Buffer[]> = (async () => {
        const out: Buffer[] = []
        for await (const chunk of stream) {
          out.push(chunk as Buffer)
        }
        return out
      })()

      // Elapsed time far exceeds one exact deadline; each chunk stays under it.
      await vi.advanceTimersByTimeAsync(chunkDelayMs * (totalChunks + 2))
      await expect(collected).resolves.toHaveLength(totalChunks)
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces a gate refusal mid-stream as an error event', async () => {
    vi.useFakeTimers()
    try {
      let served = 0
      const handle = fakeHandle()
      handle.read.mockImplementation((buffer: Buffer) => {
        if (served++ === 0) {
          buffer.write('x')
          return Promise.resolve({ bytesRead: 1, buffer })
        }
        return new Promise(() => {})
      })
      mocks.open.mockResolvedValue(handle)

      const stream = openTranscriptReadStream(UNC_PATH, {}, 'exact')
      const drained = (async () => {
        for await (const chunk of stream) {
          void chunk
        }
      })()
      const settled = drained.then(
        () => null,
        (error: unknown) => error
      )
      await vi.advanceTimersByTimeAsync(WSL_TRANSCRIPT_FS_EXACT_TIMEOUT_MS + 1)

      await expect(settled).resolves.toBeInstanceOf(WslTranscriptFsError)
      expect(handle.close).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
