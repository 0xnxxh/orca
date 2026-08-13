import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFsPromisesModule from 'node:fs/promises'

const UNC_PATH = '\\\\wsl.localhost\\Ubuntu\\home\\ada\\.claude\\projects\\p\\session.jsonl'
const SLOW_MESSAGE =
  'WSL transcript files are temporarily unavailable because filesystem access is taking too long. Try again shortly or restart Orca if the issue continues.'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn<() => Promise<string | null>>(),
  stat: vi.fn(),
  open: vi.fn()
}))

vi.mock('./session-file-resolver', () => ({ resolveSessionFilePath: mocks.resolve }))
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFsPromisesModule>()),
  stat: mocks.stat,
  open: mocks.open
}))

import {
  clearNativeChatTranscriptCache,
  readNativeChatTranscriptCached
} from './transcript-read-cache'
import { WSL_TRANSCRIPT_FS_EXACT_TIMEOUT_MS } from './wsl-transcript-fs-gate'

const BODY = Buffer.from(
  `${JSON.stringify({
    type: 'user',
    uuid: 'u-0',
    timestamp: '2026-06-01T10:00:00.000Z',
    message: { role: 'user', content: 'hello' }
  })}\n`
)

// The stalled body read keeps a permit until it settles, so every case releases
// it before the next gated call runs.
let releaseStall: (() => void) | undefined

function stallingHandle() {
  return {
    read: vi.fn(
      (buffer: Buffer) =>
        new Promise<{ bytesRead: number; buffer: Buffer }>((resolve) => {
          releaseStall = () => resolve({ bytesRead: 0, buffer })
        })
    ),
    close: vi.fn(async () => {})
  }
}

function servingHandle() {
  return {
    read: vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
      const slice = BODY.subarray(position, Math.min(position + length, BODY.length))
      slice.copy(buffer, offset)
      return { bytesRead: slice.length, buffer }
    }),
    close: vi.fn(async () => {})
  }
}

beforeEach(() => {
  clearNativeChatTranscriptCache()
  mocks.resolve.mockReset()
  mocks.stat.mockReset()
  mocks.open.mockReset()
  releaseStall = undefined
  mocks.resolve.mockResolvedValue(UNC_PATH)
  // The file itself never changes across the refusal and the recovery.
  mocks.stat.mockResolvedValue({ mtimeMs: 42, size: BODY.length })
  vi.useFakeTimers()
})

afterEach(async () => {
  releaseStall?.()
  releaseStall = undefined
  await vi.advanceTimersByTimeAsync(0)
  vi.useRealTimers()
})

describe('cached native chat transcript read with a refused transcript body', () => {
  it('retries the body on the next call even though the mtime is unchanged', async () => {
    mocks.open.mockResolvedValue(stallingHandle())
    const refused = readNativeChatTranscriptCached('claude', 'session-id')
    await vi.advanceTimersByTimeAsync(WSL_TRANSCRIPT_FS_EXACT_TIMEOUT_MS + 1)
    expect(await refused).toEqual({ error: SLOW_MESSAGE })

    // Free the permit the unabortable read still holds, then recover.
    releaseStall?.()
    releaseStall = undefined
    await vi.advanceTimersByTimeAsync(0)
    mocks.open.mockResolvedValue(servingHandle())

    const recovered = await readNativeChatTranscriptCached('claude', 'session-id')

    expect(mocks.open).toHaveBeenCalledTimes(2)
    expect(recovered).toMatchObject({ messages: [expect.objectContaining({ role: 'user' })] })
  })

  it('still caches a healthy parse, so recovery does not cost a read per call', async () => {
    mocks.open.mockResolvedValue(servingHandle())

    const first = await readNativeChatTranscriptCached('claude', 'session-id')
    const second = await readNativeChatTranscriptCached('claude', 'session-id')

    expect(mocks.open).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })
})
