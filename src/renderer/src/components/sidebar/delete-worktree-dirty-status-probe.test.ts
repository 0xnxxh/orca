import { describe, expect, it, vi } from 'vitest'
import type { GitRepositorySnapshot } from '../../../../shared/git-repository-snapshot'
import type { GitStatusResult } from '../../../../shared/types'
import type { DesktopGitRepositorySnapshotContext } from '@/runtime/desktop-git-repository-snapshot-client'
import {
  probeDeleteWorktreeDirtyStatus,
  readDeleteWorktreeDirtyStatusSnapshot
} from './delete-worktree-dirty-status-probe'

const status: GitStatusResult = {
  entries: [{ path: 'src/app.ts', status: 'modified', area: 'unstaged' }],
  conflictOperation: 'rebase',
  head: 'abc123',
  branch: 'feature',
  ignoredPaths: ['dist'],
  upstreamStatus: {
    hasUpstream: true,
    upstreamName: 'origin/feature',
    ahead: 1,
    behind: 0
  }
}

function freshness(
  state: GitRepositorySnapshot['freshness']['status']['state'] = 'fresh',
  identity: string | null = 'status-identity',
  revision: number | null = 7
): GitRepositorySnapshot['freshness']['status'] {
  return {
    state,
    generation: 1,
    currentGeneration: 1,
    revision,
    identity
  }
}

function repositorySnapshot(
  overrides: {
    revision?: number
    statusRevision?: number | null
    entryPath?: string
    statusState?: GitRepositorySnapshot['freshness']['status']['state']
    statusIdentity?: string | null
    repositoryIdentityState?: GitRepositorySnapshot['freshness']['repositoryIdentity']['state']
    repositoryIdentityProjection?: string | null
    conflictsState?: GitRepositorySnapshot['freshness']['conflicts']['state']
    conflictsIdentity?: string | null
    upstreamState?: GitRepositorySnapshot['freshness']['upstream']['state']
    upstream?: GitRepositorySnapshot['upstream']
    retentionTruncated?: boolean
  } = {}
): GitRepositorySnapshot {
  const statusIdentity =
    'statusIdentity' in overrides ? (overrides.statusIdentity ?? null) : 'status-identity'
  const revision = overrides.revision ?? 7
  const statusRevision =
    'statusRevision' in overrides ? (overrides.statusRevision ?? null) : revision
  return {
    revision,
    generatedAt: 1,
    repositoryIdentity: { head: status.head ?? null, branch: status.branch ?? null },
    status: {
      entries: [{ ...status.entries[0], path: overrides.entryPath ?? status.entries[0].path }],
      didHitLimit: false,
      statusLength: null,
      ignoredPaths: status.ignoredPaths ?? [],
      lineStatsState: 'complete',
      retentionTruncated: overrides.retentionTruncated ?? false
    },
    upstream:
      'upstream' in overrides ? (overrides.upstream ?? null) : (status.upstreamStatus ?? null),
    conflicts: status.conflictOperation,
    worktreeGraphVersion: 0,
    freshness: {
      repositoryIdentity: freshness(
        overrides.repositoryIdentityState,
        overrides.repositoryIdentityProjection ?? statusIdentity,
        statusRevision
      ),
      status: freshness(overrides.statusState, statusIdentity, statusRevision),
      upstream: freshness(overrides.upstreamState, 'upstream-identity', revision),
      conflicts: freshness(
        overrides.conflictsState,
        overrides.conflictsIdentity ?? statusIdentity,
        statusRevision
      ),
      worktreeGraph: freshness('placeholder', null)
    }
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

const localContext = {
  settings: { activeRuntimeEnvironmentId: null },
  worktreeId: 'repo::/worktrees/feature',
  worktreePath: '/worktrees/feature'
}

describe('readDeleteWorktreeDirtyStatusSnapshot', () => {
  it.each([
    ['missing', { upstream: null, upstreamState: 'missing' as const }],
    ['stale', { upstreamState: 'stale' as const }]
  ])('projects a complete fresh status without copying %s upstream', (_label, overrides) => {
    const snapshot = repositorySnapshot(overrides)

    expect(readDeleteWorktreeDirtyStatusSnapshot(snapshot)).toEqual({
      entries: status.entries,
      conflictOperation: 'rebase',
      head: 'abc123',
      branch: 'feature',
      ignoredPaths: ['dist']
    })
  })

  it.each(['stale', 'failed', 'missing'] as const)('rejects %s retained status', (statusState) => {
    expect(readDeleteWorktreeDirtyStatusSnapshot(repositorySnapshot({ statusState }))).toBeNull()
  })

  it.each([
    ['repository identity', { repositoryIdentityState: 'stale' as const }],
    ['conflicts', { conflictsState: 'stale' as const }]
  ])('rejects a stale %s sibling projection', (_label, overrides) => {
    expect(readDeleteWorktreeDirtyStatusSnapshot(repositorySnapshot(overrides))).toBeNull()
  })

  it('rejects truncated and identity-mismatched status-derived projections', () => {
    expect(
      readDeleteWorktreeDirtyStatusSnapshot(repositorySnapshot({ retentionTruncated: true }))
    ).toBeNull()
    expect(
      readDeleteWorktreeDirtyStatusSnapshot(
        repositorySnapshot({ repositoryIdentityProjection: 'other-status' })
      )
    ).toBeNull()
    expect(
      readDeleteWorktreeDirtyStatusSnapshot(
        repositorySnapshot({ conflictsIdentity: 'other-status' })
      )
    ).toBeNull()
  })

  it('rejects a fresh status projection without a revision', () => {
    expect(
      readDeleteWorktreeDirtyStatusSnapshot(repositorySnapshot({ statusRevision: null }))
    ).toBeNull()
  })
})

describe('probeDeleteWorktreeDirtyStatus', () => {
  it.each([
    ['native', localContext],
    ['exact WSL distro', localContext],
    [
      'SSH provider incarnation',
      { ...localContext, connectionId: 'ssh-provider-current-incarnation' }
    ]
  ])(
    'reduces settled active polling plus dialog %s physical status work from two to one',
    async (_label, context) => {
      let physicalStatusReads = 0
      const freshStatus = vi.fn(async () => {
        physicalStatusReads += 1
        return status
      })

      await freshStatus()
      await freshStatus()
      expect(physicalStatusReads).toBe(2)

      physicalStatusReads = 0
      await freshStatus()
      const commit = vi.fn()
      const getSnapshot = vi.fn(async () => repositorySnapshot())
      await probeDeleteWorktreeDirtyStatus(context, () => true, commit, {
        getSnapshot,
        getFreshStatus: freshStatus
      })

      expect(physicalStatusReads).toBe(1)
      expect(getSnapshot).toHaveBeenNthCalledWith(1, context)
      expect(getSnapshot).toHaveBeenNthCalledWith(2, context, { reuseLineStats: true })
      expect(commit).toHaveBeenCalledWith(expect.objectContaining({ entries: status.entries }))
    }
  )

  it('uses status projection revision when a shared upstream equalizes snapshot revisions', async () => {
    const commit = vi.fn()
    const normalSnapshot = repositorySnapshot({
      revision: 10,
      statusRevision: 4,
      entryPath: 'normal-older.ts'
    })
    const reuseSnapshot = repositorySnapshot({
      revision: 10,
      statusRevision: 8,
      entryPath: 'reuse-newer.ts'
    })

    await probeDeleteWorktreeDirtyStatus(localContext, () => true, commit, {
      getSnapshot: vi
        .fn()
        .mockResolvedValueOnce(normalSnapshot)
        .mockResolvedValueOnce(reuseSnapshot),
      getFreshStatus: vi.fn(async () => status)
    })

    expect(normalSnapshot.revision).toBe(reuseSnapshot.revision)
    expect(normalSnapshot.freshness.upstream.revision).toBe(10)
    expect(reuseSnapshot.freshness.upstream.revision).toBe(10)
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [expect.objectContaining({ path: 'reuse-newer.ts' })]
      })
    )
  })

  it('uses a normal-only admissible projection', async () => {
    const commit = vi.fn()
    const getFreshStatus = vi.fn(async () => status)
    const getSnapshot = vi
      .fn()
      .mockResolvedValueOnce(repositorySnapshot({ entryPath: 'normal.ts' }))
      .mockResolvedValueOnce(null)

    await probeDeleteWorktreeDirtyStatus(localContext, () => true, commit, {
      getSnapshot,
      getFreshStatus
    })

    expect(getSnapshot).toHaveBeenNthCalledWith(1, localContext)
    expect(getSnapshot).toHaveBeenNthCalledWith(2, localContext, { reuseLineStats: true })
    expect(getFreshStatus).not.toHaveBeenCalled()
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({ entries: [expect.objectContaining({ path: 'normal.ts' })] })
    )
  })

  it('uses a reuse-only admissible projection', async () => {
    const commit = vi.fn()
    const getFreshStatus = vi.fn(async () => status)

    await probeDeleteWorktreeDirtyStatus(localContext, () => true, commit, {
      getSnapshot: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(repositorySnapshot({ entryPath: 'reuse.ts' })),
      getFreshStatus
    })

    expect(getFreshStatus).not.toHaveBeenCalled()
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({ entries: [expect.objectContaining({ path: 'reuse.ts' })] })
    )
  })

  it.each([
    [
      'reuse',
      repositorySnapshot({ revision: 4, entryPath: 'normal-older.ts' }),
      repositorySnapshot({ revision: 8, entryPath: 'reuse-newer.ts' }),
      'reuse-newer.ts'
    ],
    [
      'normal',
      repositorySnapshot({ revision: 9, entryPath: 'normal-newer.ts' }),
      repositorySnapshot({ revision: 6, entryPath: 'reuse-older.ts' }),
      'normal-newer.ts'
    ]
  ])(
    'chooses the newer %s projection after both valid reads',
    async (_label, normalSnapshot, reuseSnapshot, expectedPath) => {
      const commit = vi.fn()
      const getSnapshot = vi
        .fn()
        .mockResolvedValueOnce(normalSnapshot)
        .mockResolvedValueOnce(reuseSnapshot)

      await probeDeleteWorktreeDirtyStatus(localContext, () => true, commit, {
        getSnapshot,
        getFreshStatus: vi.fn(async () => status)
      })

      expect(getSnapshot).toHaveBeenCalledTimes(2)
      expect(commit).toHaveBeenCalledWith(
        expect.objectContaining({
          entries: [expect.objectContaining({ path: expectedPath })]
        })
      )
    }
  )

  it.each(['normal', 'reuse'] as const)(
    'admits the other projection when the %s query fails',
    async (failedQuery) => {
      const commit = vi.fn()
      const admittedPath =
        failedQuery === 'normal' ? 'reuse-after-failure.ts' : 'normal-before-failure.ts'
      const getSnapshot = vi.fn(
        async (
          _context: DesktopGitRepositorySnapshotContext,
          options?: { reuseLineStats?: boolean }
        ): Promise<GitRepositorySnapshot | null> => {
          const isReuse = options?.reuseLineStats === true
          if ((failedQuery === 'reuse') === isReuse) {
            throw new Error(`${failedQuery} failed`)
          }
          return repositorySnapshot({ entryPath: admittedPath })
        }
      )
      const getFreshStatus = vi.fn(async () => status)

      await probeDeleteWorktreeDirtyStatus(localContext, () => true, commit, {
        getSnapshot,
        getFreshStatus
      })

      expect(getSnapshot).toHaveBeenCalledTimes(2)
      expect(getFreshStatus).not.toHaveBeenCalled()
      expect(commit).toHaveBeenCalledWith(
        expect.objectContaining({ entries: [expect.objectContaining({ path: admittedPath })] })
      )
    }
  )

  it('uses fresh fallback when neither projection is admissible', async () => {
    const commit = vi.fn()
    const getFreshStatus = vi.fn(async () => status)

    await probeDeleteWorktreeDirtyStatus(localContext, () => true, commit, {
      getSnapshot: vi
        .fn()
        .mockResolvedValueOnce(repositorySnapshot({ statusState: 'stale' }))
        .mockResolvedValueOnce(repositorySnapshot({ retentionTruncated: true })),
      getFreshStatus
    })

    expect(getFreshStatus).toHaveBeenCalledWith(localContext)
    expect(commit).toHaveBeenCalledWith(status)
  })

  it('uses fresh fallback when neither status projection has a revision', async () => {
    const commit = vi.fn()
    const getFreshStatus = vi.fn(async () => status)

    await probeDeleteWorktreeDirtyStatus(localContext, () => true, commit, {
      getSnapshot: vi.fn(async () => repositorySnapshot({ statusRevision: null })),
      getFreshStatus
    })

    expect(getFreshStatus).toHaveBeenCalledWith(localContext)
    expect(commit).toHaveBeenCalledWith(status)
  })

  it.each([
    ['stale', repositorySnapshot({ statusState: 'stale' })],
    ['failed', repositorySnapshot({ statusState: 'failed' })],
    ['missing', null],
    ['truncated', repositorySnapshot({ retentionTruncated: true })],
    ['mismatched', repositorySnapshot({ repositoryIdentityProjection: 'other-status-identity' })]
  ])('retains the fresh fallback for %s snapshots', async (_label, snapshot) => {
    const commit = vi.fn()
    const getFreshStatus = vi.fn(async () => status)

    await probeDeleteWorktreeDirtyStatus(localContext, () => true, commit, {
      getSnapshot: vi.fn(async () => snapshot),
      getFreshStatus
    })

    expect(getFreshStatus).toHaveBeenCalledWith(localContext)
    expect(commit).toHaveBeenCalledWith(status)
  })

  it('retains fresh fallback when the desktop snapshot API is unsupported', async () => {
    const commit = vi.fn()
    const getFreshStatus = vi.fn(async () => status)

    await probeDeleteWorktreeDirtyStatus(localContext, () => true, commit, {
      getSnapshot: vi.fn(async () => {
        throw new TypeError('repositorySnapshot is not a function')
      }),
      getFreshStatus
    })

    expect(getFreshStatus).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledWith(status)
  })

  it('retains runtime routing and swallows a failed fresh warning probe', async () => {
    const runtimeContext = {
      ...localContext,
      settings: { activeRuntimeEnvironmentId: 'runtime-owner' }
    }
    const getFreshStatus = vi.fn(async () => {
      throw new Error('runtime offline')
    })
    const commit = vi.fn()

    await expect(
      probeDeleteWorktreeDirtyStatus(runtimeContext, () => true, commit, {
        getSnapshot: vi.fn(async () => null),
        getFreshStatus
      })
    ).resolves.toBeUndefined()

    expect(getFreshStatus).toHaveBeenCalledWith(runtimeContext)
    expect(commit).not.toHaveBeenCalled()
  })

  it('does not start fallback or commit after cancellation during the snapshot read', async () => {
    const pendingSnapshot = deferred<GitRepositorySnapshot | null>()
    const getFreshStatus = vi.fn(async () => status)
    const commit = vi.fn()
    let current = true
    const probe = probeDeleteWorktreeDirtyStatus(localContext, () => current, commit, {
      getSnapshot: vi.fn(() => pendingSnapshot.promise),
      getFreshStatus
    })

    current = false
    pendingSnapshot.resolve(null)
    await probe

    expect(getFreshStatus).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
  })

  it('does not commit a late fallback after selected context replacement', async () => {
    const pendingStatus = deferred<GitStatusResult>()
    const commit = vi.fn()
    const getFreshStatus = vi.fn(() => pendingStatus.promise)
    let current = true
    const probe = probeDeleteWorktreeDirtyStatus(localContext, () => current, commit, {
      getSnapshot: vi.fn(async () => null),
      getFreshStatus
    })

    await vi.waitFor(() => expect(getFreshStatus).toHaveBeenCalledOnce())
    current = false
    pendingStatus.resolve(status)
    await probe

    expect(commit).not.toHaveBeenCalled()
  })
})
