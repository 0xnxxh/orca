import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/types'
import { findRepoForWorktreeHostIdentity, getRepoHostIdentityForParts } from './repo-host-identity'

type IndexedRepo = Pick<Repo, 'id' | 'connectionId' | 'executionHostId'> & {
  marker: string
}

function makeRuntimeRepo(
  repoId: string,
  environmentId: string,
  marker: string,
  onHostRead: () => void
): IndexedRepo {
  const repo = { id: repoId, connectionId: null, marker } as IndexedRepo
  Object.defineProperty(repo, 'executionHostId', {
    enumerable: true,
    get: () => {
      onHostRead()
      return `runtime:${environmentId}` as const
    }
  })
  return repo
}

describe('findRepoForWorktreeHostIdentity', () => {
  it('reuses the unique-runtime index and keeps ambiguous repo ids unresolved', () => {
    const hostRead = vi.fn()
    const uniqueRepo = makeRuntimeRepo('unique-repo', 'env-a', 'unique', hostRead)
    const ambiguousRepoA = makeRuntimeRepo('ambiguous-repo', 'env-a', 'first', hostRead)
    const ambiguousRepoB = makeRuntimeRepo('ambiguous-repo', 'env-b', 'second', hostRead)
    const repoByHostIdentity = new Map<string, IndexedRepo>([
      [getRepoHostIdentityForParts('unique-repo', 'runtime:env-a'), uniqueRepo],
      [getRepoHostIdentityForParts('ambiguous-repo', 'runtime:env-a'), ambiguousRepoA],
      [getRepoHostIdentityForParts('ambiguous-repo', 'runtime:env-b'), ambiguousRepoB]
    ])
    const repoById = new Map<string, IndexedRepo>()
    const legacyOwner = (repoId: string) =>
      findRepoForWorktreeHostIdentity(
        { repoId, hostId: 'ssh:nested' },
        repoById,
        repoByHostIdentity
      )

    expect(legacyOwner('unique-repo')?.marker).toBe('unique')
    expect(hostRead).toHaveBeenCalledTimes(3)
    expect(legacyOwner('unique-repo')).toBe(uniqueRepo)
    expect(legacyOwner('ambiguous-repo')).toBeUndefined()
    expect(hostRead).toHaveBeenCalledTimes(3)
  })
})
