import { execFileSync } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGoldenWorktree } from './golden-source-control'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

const execFileSyncMock = vi.mocked(execFileSync)
const gitArgsFor = (): string[][] =>
  execFileSyncMock.mock.calls.map(([, args]) => (args ?? []) as string[])

describe('createGoldenWorktree', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset()
  })

  it('rolls back the worktree and branch when a configuration command fails', () => {
    const setupError = new Error('git config --worktree unsupported')
    execFileSyncMock.mockImplementation(((_file: string, args: string[]) => {
      if (args[0] === 'config' && args[1] === 'extensions.worktreeConfig') {
        throw setupError
      }
      return ''
    }) as unknown as typeof execFileSync)

    expect(() => createGoldenWorktree('/repo', 'rollback')).toThrow(setupError)

    const worktreePath = gitArgsFor().find((args) => args[0] === 'worktree')?.[2]
    expect(worktreePath).toBeDefined()
    const branchName = gitArgsFor().find((args) => args[0] === 'branch')?.[2]
    expect(gitArgsFor()).toContainEqual(['worktree', 'remove', '--force', worktreePath])
    expect(branchName).toMatch(/^e2e-golden-rollback-/)
  })

  it('keeps the setup error when rollback itself fails', () => {
    const setupError = new Error('git config --worktree unsupported')
    execFileSyncMock.mockImplementation(((_file: string, args: string[]) => {
      if (args[0] === 'config' && args[1] === 'extensions.worktreeConfig') {
        throw setupError
      }
      if (args[0] === 'branch') {
        throw new Error('branch is still checked out')
      }
      return ''
    }) as unknown as typeof execFileSync)

    expect(() => createGoldenWorktree('/repo', 'rollback-fails')).toThrow(setupError)
  })

  it('returns the fixture when every setup command succeeds', () => {
    execFileSyncMock.mockReturnValue('')

    const fixture = createGoldenWorktree('/repo', 'happy')

    expect(fixture.branchName).toMatch(/^e2e-golden-happy-/)
    expect(gitArgsFor().some((args) => args[0] === 'worktree' && args[1] === 'remove')).toBe(false)
    expect(gitArgsFor().some((args) => args[0] === 'branch')).toBe(false)
  })
})
