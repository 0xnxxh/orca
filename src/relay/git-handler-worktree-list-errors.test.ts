import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as FsPromises from 'node:fs/promises'

const statMock = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof FsPromises>()),
  stat: statMock
}))

import { annotatePrunableWorktreesByExistence } from './git-handler-worktree-list'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('relay prunable worktree probe errors', () => {
  beforeEach(() => {
    statMock.mockReset()
  })

  it('marks ENOTDIR registrations as prunable', async () => {
    statMock.mockRejectedValue(Object.assign(new Error('not a directory'), { code: 'ENOTDIR' }))

    await expect(annotatePrunableWorktreesByExistence([{ path: '/repo/child' }])).resolves.toEqual([
      expect.objectContaining({ path: '/repo/child', prunable: true })
    ])
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
    const worktrees = Array.from({ length: 12 }, (_, index) => ({
      path: `/repo/child-${index}`
    }))
    const result = annotatePrunableWorktreesByExistence(worktrees)
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
