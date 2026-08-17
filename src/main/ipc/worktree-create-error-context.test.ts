import { describe, expect, it } from 'vitest'

import {
  describeWorktreeCreateFailure,
  resolveWorktreeCreateRoute
} from './worktree-create-error-context'
import type { Repo } from '../../shared/repo-types'

/**
 * A worktree create over SSH failed with a bare
 * `ENOENT: no such file or directory, lstat '/home/neil/projects/orca-test1234'`.
 *
 * That message names nothing useful. An lstat is Node's LOCAL filesystem, so hitting one against a
 * path that lives on an SSH host means creation ran a local implementation for a remote repo — but
 * the user could not know that, and neither could we without re-deriving the routing by hand. The
 * route is knowable at the throw site, so it should be stated there.
 */
function repo(overrides: Partial<Repo> = {}): Pick<Repo, 'kind' | 'connectionId' | 'path'> {
  return {
    kind: 'git',
    connectionId: undefined,
    path: '/home/neil/projects/orca',
    ...overrides
  } as Pick<Repo, 'kind' | 'connectionId' | 'path'>
}

function fsError(code: string, syscall = 'lstat'): NodeJS.ErrnoException {
  const error = new Error(
    `${code}: no such file or directory, ${syscall} '/home/neil/projects/orca-test1234'`
  ) as NodeJS.ErrnoException
  error.code = code
  error.syscall = syscall
  return error
}

describe('resolveWorktreeCreateRoute', () => {
  it('sends a folder repo to the folder route even when it has a connection', () => {
    // Load-bearing ordering: the handler checks isFolderRepo BEFORE connectionId, so a folder repo
    // on an SSH host never reaches the remote implementation.
    expect(resolveWorktreeCreateRoute({ kind: 'folder', connectionId: 'ssh-1' } as never)).toBe(
      'folder'
    )
  })

  it('sends a git repo with a connection to the remote route', () => {
    expect(resolveWorktreeCreateRoute({ kind: 'git', connectionId: 'ssh-1' } as never)).toBe(
      'remote'
    )
  })

  it('sends a git repo without a connection to the local route', () => {
    expect(resolveWorktreeCreateRoute({ kind: 'git', connectionId: undefined } as never)).toBe(
      'local'
    )
  })
})

describe('describeWorktreeCreateFailure', () => {
  it('calls out a remote repo that failed on a local filesystem call', () => {
    const described = describeWorktreeCreateFailure(
      fsError('ENOENT'),
      repo({ connectionId: 'ssh-1' })
    )

    expect(described).toBeInstanceOf(Error)
    const message = (described as Error).message
    expect(message).toContain('remote (SSH) path failed on a local filesystem call')
    expect(message).toContain('ENOENT')
    expect(message).toContain('lstat')
    expect(message).toContain('connection=ssh-1')
    expect(message).toContain('/home/neil/projects/orca')
  })

  it('names the local route when a repo has no connection', () => {
    const described = describeWorktreeCreateFailure(fsError('ENOENT'), repo())

    expect((described as Error).message).toContain('local path ran a local filesystem call')
    expect((described as Error).message).toContain('connection=none')
  })

  it('names the folder route, which ignores the connection entirely', () => {
    const described = describeWorktreeCreateFailure(
      fsError('EACCES'),
      repo({ kind: 'folder', connectionId: 'ssh-1' })
    )

    expect((described as Error).message).toContain('folder path ran a local filesystem call')
    expect((described as Error).message).toContain('EACCES')
  })

  it('keeps the original error as the cause', () => {
    // Anything matching on `code` or reading the stack must keep working; this only adds context.
    const original = fsError('ENOENT')
    const described = describeWorktreeCreateFailure(original, repo({ connectionId: 'ssh-1' }))

    expect((described as Error).cause).toBe(original)
    expect((described as Error).message).toContain(original.message)
  })

  it('leaves a non-filesystem failure completely untouched', () => {
    // Git failures, relay-not-ready, validation errors — all already say what went wrong, and
    // rewriting them would bury a good message under a worse one.
    const gitFailure = new Error('Remote connection dropped. Click Reconnect on the SSH target.')

    expect(describeWorktreeCreateFailure(gitFailure, repo({ connectionId: 'ssh-1' }))).toBe(
      gitFailure
    )
  })

  it('leaves an fs error with an unrelated code untouched', () => {
    const busy = fsError('EBUSY')

    expect(describeWorktreeCreateFailure(busy, repo({ connectionId: 'ssh-1' }))).toBe(busy)
  })
})
