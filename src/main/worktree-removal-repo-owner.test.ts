/**
 * STA-4343 (host side): a repo id registered on two hosts has no single owner,
 * so unqualified legacy resolution is ambiguous and a qualified call picks the
 * named host. The destructive RPC boundary rejects missing qualifiers earlier.
 */
import { describe, expect, it } from 'vitest'
import { resolveWorktreeRemovalRepoOwner } from './worktree-removal-repo-owner'
import type { Repo } from '../shared/repo-types'

function makeRepo(overrides: Partial<Repo> & Pick<Repo, 'id'>): Repo {
  return {
    path: '/repos/shared',
    displayName: 'Shared',
    badgeColor: '#000',
    addedAt: 0,
    ...overrides
  } as Repo
}

function makeStore(repos: readonly Repo[]): {
  getRepos: () => readonly Repo[]
  getRepo: (repoId: string) => Repo | undefined
} {
  return {
    getRepos: () => repos,
    getRepo: (repoId) => repos.find((repo) => repo.id === repoId)
  }
}

describe('resolveWorktreeRemovalRepoOwner', () => {
  const localRepo = makeRepo({ id: 'repo1' })
  const sshRepo = makeRepo({ id: 'repo1', connectionId: 'ssh-1' })

  it('fails closed when an unqualified request matches two hosts', () => {
    expect(resolveWorktreeRemovalRepoOwner(makeStore([localRepo, sshRepo]), 'repo1')).toEqual({
      kind: 'ambiguous'
    })
  })

  it('selects the named host even when a same-id repo is registered first', () => {
    const owner = resolveWorktreeRemovalRepoOwner(
      makeStore([localRepo, sshRepo]),
      'repo1',
      'ssh:ssh-1'
    )
    expect(owner).toEqual({ kind: 'resolved', repo: sshRepo })
  })

  it('reports missing when the named host owns no such repo', () => {
    expect(resolveWorktreeRemovalRepoOwner(makeStore([localRepo]), 'repo1', 'ssh:ssh-1')).toEqual({
      kind: 'missing'
    })
    expect(resolveWorktreeRemovalRepoOwner(makeStore([]), 'repo1')).toEqual({ kind: 'missing' })
  })
})
