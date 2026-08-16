import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const wslUncDirectoryExistsAsyncMock = vi.hoisted(() => vi.fn())

vi.mock('../wsl', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, wslUncDirectoryExistsAsync: wslUncDirectoryExistsAsyncMock }
})

import { validateWorkingDirectoryAsync } from './local-pty-utils'

let tempDir: string

beforeEach(async () => {
  wslUncDirectoryExistsAsyncMock.mockReset()
  wslUncDirectoryExistsAsyncMock.mockResolvedValue(null)
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'orca-cwd-validate-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('validateWorkingDirectoryAsync', () => {
  it('accepts an existing directory', async () => {
    await expect(validateWorkingDirectoryAsync(tempDir)).resolves.toBeUndefined()
  })

  it('rejects a missing directory with the actionable unmounted-volume message', async () => {
    await expect(validateWorkingDirectoryAsync(path.join(tempDir, 'gone'))).rejects.toThrow(
      /does not exist.*unmounted volume/s
    )
  })

  it('rejects a path that exists but is a file', async () => {
    const filePath = path.join(tempDir, 'not-a-dir.txt')
    await writeFile(filePath, 'x')

    await expect(validateWorkingDirectoryAsync(filePath)).rejects.toThrow('is not a directory')
  })

  it('never blocks the event loop while the filesystem answers', async () => {
    // A dead UNC share must not freeze unrelated daemon RPCs (STA-4470).
    let ticked = false
    const pending = validateWorkingDirectoryAsync(tempDir)
    setImmediate(() => {
      ticked = true
    })

    await pending

    expect(ticked).toBe(true)
  })

  describe('cancellation', () => {
    // Unique per test: the dedupe map is module-level, and a never-settling
    // probe would otherwise leak into later cases.
    const deadShare = (name: string): string => `\\\\wsl.localhost\\Ubuntu\\dead-${name}`

    beforeEach(() => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('lets an aborted caller give up on a probe that never answers', async () => {
      // fs.stat takes no signal, so the caller leaves; the probe keeps running.
      wslUncDirectoryExistsAsyncMock.mockReturnValue(new Promise<boolean>(() => {}))
      const abort = new AbortController()

      const pending = validateWorkingDirectoryAsync(deadShare('abort'), { signal: abort.signal })
      abort.abort()

      await expect(pending).rejects.toThrow('was canceled')
    })

    it('rejects immediately when the signal is already aborted', async () => {
      wslUncDirectoryExistsAsyncMock.mockReturnValue(new Promise<boolean>(() => {}))

      await expect(
        validateWorkingDirectoryAsync(deadShare('pre-aborted'), { signal: AbortSignal.abort() })
      ).rejects.toThrow('was canceled')
    })

    it('leaves the shared probe intact for callers that are still waiting', async () => {
      let releaseProbe: () => void = () => {}
      wslUncDirectoryExistsAsyncMock.mockReturnValue(
        new Promise<boolean>((resolve) => {
          releaseProbe = () => resolve(true)
        })
      )
      const abort = new AbortController()

      const shared = deadShare('shared')
      const staying = validateWorkingDirectoryAsync(shared)
      const leaving = validateWorkingDirectoryAsync(shared, { signal: abort.signal })
      abort.abort()
      await expect(leaving).rejects.toThrow('was canceled')

      releaseProbe()
      await expect(staying).resolves.toBeUndefined()
      expect(wslUncDirectoryExistsAsyncMock).toHaveBeenCalledOnce()
    })

    it('stops a never-settling probe from poisoning the path forever', async () => {
      vi.useFakeTimers()
      try {
        wslUncDirectoryExistsAsyncMock.mockReturnValue(new Promise<boolean>(() => {}))

        const poisoned = deadShare('evicted')
        void validateWorkingDirectoryAsync(poisoned).catch(() => {})
        await vi.advanceTimersByTimeAsync(30_000)
        void validateWorkingDirectoryAsync(poisoned).catch(() => {})

        expect(wslUncDirectoryExistsAsyncMock).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('WSL UNC paths', () => {
    const wslPath = '\\\\wsl.localhost\\Ubuntu\\home\\jin\\repo'

    beforeEach(() => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('asks the distro asynchronously and accepts its yes', async () => {
      wslUncDirectoryExistsAsyncMock.mockResolvedValue(true)

      await expect(validateWorkingDirectoryAsync(wslPath)).resolves.toBeUndefined()
      expect(wslUncDirectoryExistsAsyncMock).toHaveBeenCalledWith(wslPath)
    })

    it('shares one in-flight probe for the same working directory', async () => {
      let releaseProbe: () => void = () => {}
      wslUncDirectoryExistsAsyncMock.mockReturnValue(
        new Promise<boolean>((resolve) => {
          releaseProbe = () => resolve(true)
        })
      )

      const first = validateWorkingDirectoryAsync(wslPath)
      const second = validateWorkingDirectoryAsync(wslPath)
      expect(wslUncDirectoryExistsAsyncMock).toHaveBeenCalledOnce()

      releaseProbe()
      await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
    })

    it('keeps byte-distinct working directories in separate probes', async () => {
      wslUncDirectoryExistsAsyncMock.mockResolvedValue(true)
      const decomposedPath = `${wslPath}-e\u0301`
      const composedPath = `${wslPath}-\u00e9`

      await Promise.all([
        validateWorkingDirectoryAsync(decomposedPath),
        validateWorkingDirectoryAsync(composedPath)
      ])

      expect(wslUncDirectoryExistsAsyncMock).toHaveBeenCalledTimes(2)
    })

    it(`rejects on the distro no without falling back to a Win32 stat`, async () => {
      wslUncDirectoryExistsAsyncMock.mockResolvedValue(false)

      await expect(validateWorkingDirectoryAsync(wslPath)).rejects.toThrow(/does not exist/)
    })

    it('falls back to the filesystem when the distro probe is inconclusive', async () => {
      // An inconclusive guest probe is not proof that the directory is missing.
      wslUncDirectoryExistsAsyncMock.mockResolvedValue(null)

      await expect(validateWorkingDirectoryAsync(wslPath)).rejects.toThrow(/does not exist/)
      expect(wslUncDirectoryExistsAsyncMock).toHaveBeenCalledOnce()
    })
  })
})
