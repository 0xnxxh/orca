import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFsPromisesModule from 'node:fs/promises'

const UNC_PATH = '\\\\wsl.localhost\\Ubuntu\\home\\ada\\.claude\\projects\\p\\session.jsonl'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn<() => Promise<string | null>>(),
  stat: vi.fn()
}))

vi.mock('./session-file-resolver', () => ({ resolveSessionFilePath: mocks.resolve }))
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFsPromisesModule>()),
  stat: mocks.stat
}))

import { readNativeChatTranscriptCached } from './transcript-read-cache'
import { WSL_TRANSCRIPT_FS_EXACT_TIMEOUT_MS } from './wsl-transcript-fs-gate'

const SLOW_MESSAGE =
  'WSL transcript files are temporarily unavailable because filesystem access is taking too long. Try again shortly or restart Orca if the issue continues.'

beforeEach(() => {
  mocks.resolve.mockReset()
  mocks.stat.mockReset()
  mocks.resolve.mockResolvedValue(UNC_PATH)
})

describe('cached native chat transcript read with a stalled post-resolution stat', () => {
  it('reports a retryable error without notFound and leaves nothing cached', async () => {
    vi.useFakeTimers()
    try {
      mocks.stat.mockReturnValueOnce(new Promise(() => {}))
      const stalled = readNativeChatTranscriptCached('claude', 'session-id')
      await vi.advanceTimersByTimeAsync(WSL_TRANSCRIPT_FS_EXACT_TIMEOUT_MS + 1)

      const result = await stalled
      expect(result).toEqual({ error: SLOW_MESSAGE })
      expect(result).not.toHaveProperty('notFound')
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-attempts the stat on the next call instead of serving a poisoned entry', async () => {
    // The stalled task above still holds its permit, so this fast-fails on the
    // stuck route rather than waiting out a second deadline — but it must still
    // reach `stat` again once a different distro answers.
    const healthyPath = '\\\\wsl.localhost\\Debian\\home\\ada\\.claude\\projects\\p\\session.jsonl'
    mocks.resolve.mockResolvedValue(healthyPath)
    mocks.stat.mockResolvedValue({ mtimeMs: 5, size: 0 })

    await readNativeChatTranscriptCached('claude', 'session-id')

    expect(mocks.stat).toHaveBeenCalledWith(healthyPath)
  })
})
