import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureSafeWorktreeTargetParent } from './worktree-target-safety'

const lstatMock = vi.hoisted(() => vi.fn())
const mkdirMock = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', () => ({
  lstat: lstatMock,
  mkdir: mkdirMock
}))

describe('ensureSafeWorktreeTargetParent', () => {
  beforeEach(() => {
    lstatMock.mockReset()
    mkdirMock.mockReset()
    mkdirMock.mockRejectedValue(Object.assign(new Error('exists'), { code: 'EEXIST' }))
  })

  it('checks a shared parent once across many copied files', async () => {
    const worktree = resolve('repo', 'worktree')
    const verifiedDirectories = new Set([worktree])
    lstatMock.mockResolvedValue({
      isDirectory: () => true,
      isSymbolicLink: () => false
    })

    await expect(
      ensureSafeWorktreeTargetParent(
        worktree,
        join(worktree, 'config', 'first.env'),
        verifiedDirectories
      )
    ).resolves.toBe(true)
    await expect(
      ensureSafeWorktreeTargetParent(
        worktree,
        join(worktree, 'config', 'second.env'),
        verifiedDirectories
      )
    ).resolves.toBe(true)

    expect(mkdirMock).toHaveBeenCalledTimes(1)
    expect(lstatMock).toHaveBeenCalledTimes(1)
  })

  it('rejects an existing symlink parent', async () => {
    const worktree = resolve('repo', 'worktree')
    lstatMock.mockResolvedValue({
      isDirectory: () => true,
      isSymbolicLink: () => true
    })

    await expect(
      ensureSafeWorktreeTargetParent(
        worktree,
        join(worktree, 'config', '.env'),
        new Set([worktree])
      )
    ).resolves.toBe(false)
  })
})
