import { afterEach, describe, expect, it, vi } from 'vitest'

const { gitExecFileAsyncMock } = vi.hoisted(() => ({
  gitExecFileAsyncMock: vi.fn()
}))

vi.mock('./runner', () => ({
  gitExecFileAsync: gitExecFileAsyncMock,
  gitExecFileSync: vi.fn()
}))

import { getBranchConflictKind } from './repo'

describe('getBranchConflictKind local probe evidence', () => {
  afterEach(() => {
    gitExecFileAsyncMock.mockReset()
  })

  it.each([
    ['local', {}],
    ['WSL', { wslDistro: 'Ubuntu' }]
  ])('does not repeat a known-missing %s branch probe', async (_label, gitOptions) => {
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'remote') {
        return { stdout: 'origin\n', stderr: '' }
      }
      if (args[0] === 'for-each-ref') {
        return { stdout: '', stderr: '' }
      }
      throw new Error(`unexpected Git call: ${args.join(' ')}`)
    })

    await expect(
      getBranchConflictKind('/repo', 'feature/fix', 'origin/main', {
        ...gitOptions,
        knownLocalBranchExists: false
      })
    ).resolves.toBeNull()

    expect(gitExecFileAsyncMock.mock.calls.map(([args]) => args[0])).toEqual([
      'remote',
      'for-each-ref'
    ])
    expect(gitExecFileAsyncMock).not.toHaveBeenCalledWith(
      ['rev-parse', '--verify', 'refs/heads/feature/fix'],
      expect.anything()
    )
  })

  it('returns a known local conflict without another subprocess', async () => {
    await expect(
      getBranchConflictKind('/repo', 'feature/fix', 'origin/main', {
        knownLocalBranchExists: true
      })
    ).resolves.toBe('local')

    expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
  })

  it('retries local classification when the earlier evidence was not authoritative', async () => {
    gitExecFileAsyncMock.mockResolvedValue({ stdout: 'branch-sha\n', stderr: '' })

    await expect(
      getBranchConflictKind('/repo', 'feature/fix', 'origin/main', {
        knownLocalBranchExists: undefined
      })
    ).resolves.toBe('local')

    expect(gitExecFileAsyncMock).toHaveBeenCalledOnce()
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['rev-parse', '--verify', 'refs/heads/feature/fix'],
      { cwd: '/repo' }
    )
  })
})
