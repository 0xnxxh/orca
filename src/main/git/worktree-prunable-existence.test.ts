import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as FsPromises from 'node:fs/promises'
import type { GitWorktreeInfo } from '../../shared/types'

const statMock = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof FsPromises>()),
  stat: statMock
}))

import { annotatePrunableByExistence } from './worktree'

function linkedWorktree(path: string): GitWorktreeInfo {
  return {
    path,
    head: 'abc',
    branch: 'feature',
    isBare: false,
    isMainWorktree: false
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('annotatePrunableByExistence', () => {
  beforeEach(() => {
    statMock.mockReset()
  })

  it('marks ENOTDIR registrations as prunable', async () => {
    statMock.mockRejectedValue(Object.assign(new Error('not a directory'), { code: 'ENOTDIR' }))

    await expect(
      annotatePrunableByExistence([linkedWorktree('/repo/child')], '/repo')
    ).resolves.toEqual([expect.objectContaining({ path: '/repo/child', prunable: true })])
  })

  it('drains started probes and rejects permission errors without scheduling more', async () => {
    const held = deferred<void>()
    statMock.mockImplementation((path: string) => {
      if (path.endsWith('/child-0')) {
        return Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
      }
      if (path.endsWith('/child-1')) {
        return held.promise
      }
      return Promise.resolve()
    })
    const worktrees = Array.from({ length: 12 }, (_, index) =>
      linkedWorktree(`/repo/child-${index}`)
    )
    const result = annotatePrunableByExistence(worktrees, '/repo')
    let rejected = false
    void result.catch(() => {
      rejected = true
    })

    await Promise.resolve()
    expect(rejected).toBe(false)
    expect(statMock.mock.calls.length).toBeLessThanOrEqual(8)
    held.resolve()

    await expect(result).rejects.toMatchObject({ code: 'EACCES' })
    expect(statMock.mock.calls.length).toBeLessThanOrEqual(8)
  })
})
