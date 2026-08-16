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
    // Why this test exists: the sync twin blocks ~21s on an unreachable UNC
    // share, which froze the daemon's whole RPC loop (STA-4470). Proving the
    // loop still turns is the actual regression guard.
    let ticked = false
    const pending = validateWorkingDirectoryAsync(tempDir)
    setImmediate(() => {
      ticked = true
    })

    await pending

    expect(ticked).toBe(true)
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

    it(`rejects on the distro no without falling back to a Win32 stat`, async () => {
      wslUncDirectoryExistsAsyncMock.mockResolvedValue(false)

      await expect(validateWorkingDirectoryAsync(wslPath)).rejects.toThrow(/does not exist/)
    })

    it('falls back to the filesystem when the distro probe is inconclusive', async () => {
      // Win32 stat against the 9P share is unreliable, so null must not be a no.
      wslUncDirectoryExistsAsyncMock.mockResolvedValue(null)

      await expect(validateWorkingDirectoryAsync(wslPath)).rejects.toThrow(/does not exist/)
      expect(wslUncDirectoryExistsAsyncMock).toHaveBeenCalledOnce()
    })
  })
})
