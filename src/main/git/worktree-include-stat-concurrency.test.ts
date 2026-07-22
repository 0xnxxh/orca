import { describe, expect, it, vi } from 'vitest'
import { resolveWorktreeIncludePaths, WORKTREE_INCLUDE_FILE } from './worktree-include-file'
import { gitExecFileAsync } from './runner'

const lstatMock = vi.hoisted(() => vi.fn())
const readFileMock = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', () => ({
  lstat: lstatMock,
  readFile: readFileMock
}))

vi.mock('./runner', () => ({
  gitExecFileAsync: vi.fn()
}))

describe('worktree include stat concurrency', () => {
  it('bounds anchored literal probes instead of awaiting thousands serially', async () => {
    let active = 0
    let peak = 0
    readFileMock.mockResolvedValue(
      Array.from({ length: 24 }, (_, index) => `/config/file-${index}`).join('\n')
    )
    lstatMock.mockImplementation(async (path: string) => {
      if (path.endsWith(WORKTREE_INCLUDE_FILE)) {
        return { isFile: () => true, size: 1_024 }
      }
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
      return { isDirectory: () => false }
    })
    vi.mocked(gitExecFileAsync).mockRejectedValue(
      Object.assign(new Error('no ignored paths'), { code: 1 })
    )

    await expect(resolveWorktreeIncludePaths('/repo')).resolves.toEqual([])

    expect(peak).toBe(8)
    expect(lstatMock).toHaveBeenCalledTimes(25)
    expect(gitExecFileAsync).toHaveBeenCalledTimes(1)
  })
})
