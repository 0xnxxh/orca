import { describe, expect, it, vi } from 'vitest'
import type { GitRepositorySnapshot } from '../../../../shared/git-repository-snapshot'
import type { GitPushTarget, GitUpstreamStatus } from '../../../../shared/types'
import type { getRuntimeGitRepositorySnapshot } from '@/runtime/runtime-git-repository-snapshot-client'
import {
  loadSourceControlAutomaticUpstream,
  readSourceControlAutomaticUpstreamSnapshot,
  type SourceControlAutomaticUpstreamContext
} from './source-control-automatic-upstream-snapshot'

function freshness(
  identity: string,
  overrides: Partial<GitRepositorySnapshot['freshness']['status']> = {}
): GitRepositorySnapshot['freshness']['status'] {
  return {
    state: 'fresh',
    generation: 3,
    currentGeneration: 3,
    revision: 8,
    identity,
    ...overrides
  }
}

function snapshot(
  overrides: {
    statusRevision?: number | null
    branch?: string | null
    retentionTruncated?: boolean
    statusFreshness?: Partial<GitRepositorySnapshot['freshness']['status']>
    repositoryFreshness?: Partial<GitRepositorySnapshot['freshness']['status']>
    upstreamFreshness?: Partial<GitRepositorySnapshot['freshness']['status']>
    upstream?: unknown
  } = {}
): GitRepositorySnapshot {
  const statusRevision = 'statusRevision' in overrides ? (overrides.statusRevision ?? null) : 8
  return {
    revision: 12,
    generatedAt: 100,
    repositoryIdentity: {
      head: 'abc123',
      branch: 'branch' in overrides ? (overrides.branch ?? null) : 'refs/heads/feature'
    },
    status: {
      entries: [],
      didHitLimit: false,
      statusLength: 0,
      ignoredPaths: [],
      lineStatsState: 'complete',
      retentionTruncated: overrides.retentionTruncated ?? false
    },
    upstream:
      'upstream' in overrides
        ? (overrides.upstream as GitRepositorySnapshot['upstream'])
        : {
            hasUpstream: true,
            upstreamName: 'origin/feature',
            ahead: 1,
            behind: 0
          },
    conflicts: 'unknown',
    worktreeGraphVersion: 0,
    freshness: {
      status: freshness('status', {
        revision: statusRevision,
        ...overrides.statusFreshness
      }),
      repositoryIdentity: freshness('status', {
        revision: statusRevision,
        ...overrides.repositoryFreshness
      }),
      conflicts: freshness('status', { revision: statusRevision }),
      upstream: freshness('upstream-has-independent-identity', {
        revision: 12,
        ...overrides.upstreamFreshness
      }),
      worktreeGraph: freshness('worktree', { state: 'placeholder', revision: null })
    }
  }
}

const context: SourceControlAutomaticUpstreamContext = {
  settings: { activeRuntimeEnvironmentId: null },
  worktreeId: 'repo::/worktrees/feature',
  worktreePath: '/worktrees/feature',
  branch: 'feature'
}

function dependencies(
  input: {
    getSnapshot?: typeof getRuntimeGitRepositorySnapshot
    fetchFresh?: () => Promise<GitUpstreamStatus | null>
    apply?: (upstream: GitUpstreamStatus) => void
  } = {}
) {
  return {
    getSnapshot:
      input.getSnapshot ??
      vi.fn<typeof getRuntimeGitRepositorySnapshot>().mockResolvedValue(snapshot()),
    fetchFresh:
      input.fetchFresh ??
      vi.fn().mockResolvedValue({
        hasUpstream: true,
        upstreamName: 'origin/fresh',
        ahead: 0,
        behind: 0
      } satisfies GitUpstreamStatus),
    apply: input.apply ?? vi.fn()
  }
}

describe('readSourceControlAutomaticUpstreamSnapshot', () => {
  it('admits an exact current-generation branch without equating upstream identity', () => {
    expect(readSourceControlAutomaticUpstreamSnapshot(snapshot(), 'feature')).toEqual({
      revision: 8,
      upstream: {
        hasUpstream: true,
        upstreamName: 'origin/feature',
        ahead: 1,
        behind: 0
      }
    })
  })

  it.each([
    ['stale status', { statusFreshness: { state: 'stale' as const } }],
    ['failed repository', { repositoryFreshness: { state: 'failed' as const } }],
    ['missing upstream', { upstreamFreshness: { state: 'missing' as const } }],
    ['old status generation', { statusFreshness: { currentGeneration: 4 } }],
    ['repository generation mismatch', { repositoryFreshness: { generation: 2 } }],
    ['upstream generation mismatch', { upstreamFreshness: { generation: 2 } }],
    ['repository identity mismatch', { repositoryFreshness: { identity: 'other' } }],
    ['repository revision mismatch', { repositoryFreshness: { revision: 7 } }],
    ['missing status revision', { statusRevision: null }],
    ['truncated status retention', { retentionTruncated: true }],
    ['branch mismatch', { branch: 'refs/heads/other' }],
    ['malformed branch', { branch: 42 as unknown as string }]
  ])('rejects %s', (_label, overrides) => {
    expect(readSourceControlAutomaticUpstreamSnapshot(snapshot(overrides), 'feature')).toBeNull()
  })

  it.each([
    [
      'malformed count',
      { hasUpstream: true, upstreamName: 'origin/feature', ahead: -1, behind: 0 }
    ],
    [
      'malformed optional field',
      {
        hasUpstream: true,
        upstreamName: 'origin/feature',
        ahead: 0,
        behind: 0,
        hasConfiguredPushTarget: 'true'
      }
    ],
    [
      'ambiguous divergence',
      { hasUpstream: true, upstreamName: 'origin/feature', ahead: 1, behind: 1 }
    ]
  ])('rejects %s upstream data', (_label, upstream) => {
    expect(readSourceControlAutomaticUpstreamSnapshot(snapshot({ upstream }), 'feature')).toBeNull()
  })
})

describe('loadSourceControlAutomaticUpstream', () => {
  it('selects the newest admissible identity and isolates a failed sibling read', async () => {
    const apply = vi.fn()
    const getSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot({ statusRevision: 4 }))
      .mockResolvedValueOnce(
        snapshot({
          statusRevision: 9,
          upstream: {
            hasUpstream: true,
            upstreamName: 'origin/newest',
            ahead: 0,
            behind: 0
          }
        })
      )
    const deps = dependencies({ getSnapshot, apply })

    await expect(
      loadSourceControlAutomaticUpstream({
        context,
        request: { shouldApply: () => true },
        dependencies: deps
      })
    ).resolves.toBe('snapshot')
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ upstreamName: 'origin/newest' }))

    getSnapshot.mockReset()
    getSnapshot
      .mockRejectedValueOnce(new Error('normal failed'))
      .mockResolvedValueOnce(snapshot({ statusRevision: 10 }))
    await expect(
      loadSourceControlAutomaticUpstream({
        context,
        request: { shouldApply: () => true },
        dependencies: deps
      })
    ).resolves.toBe('snapshot')
  })

  it.each(['method_not_found', 'disconnected', 'malformed snapshot'])(
    'preserves the fresh fallback for %s',
    async (failure) => {
      let freshUpstreamReads = 0
      const getSnapshot =
        failure === 'malformed snapshot'
          ? vi.fn().mockResolvedValue(snapshot({ retentionTruncated: true }))
          : vi.fn().mockRejectedValue(new Error(failure))
      const fetchFresh = vi.fn(async () => {
        freshUpstreamReads += 1
        return {
          hasUpstream: true,
          upstreamName: 'origin/fresh',
          ahead: 0,
          behind: 0
        } satisfies GitUpstreamStatus
      })
      const deps = dependencies({ getSnapshot, fetchFresh })

      await expect(
        loadSourceControlAutomaticUpstream({
          context,
          request: { shouldApply: () => true },
          dependencies: deps
        })
      ).resolves.toBe('fresh')
      expect(getSnapshot).toHaveBeenCalledTimes(2)
      expect(deps.fetchFresh).toHaveBeenCalledOnce()
      expect(freshUpstreamReads).toBe(1)
      expect(deps.apply).toHaveBeenCalledWith(
        expect.objectContaining({ upstreamName: 'origin/fresh' })
      )
    }
  )

  it('passes the exact push target to both independent identity queries', async () => {
    const pushTarget: GitPushTarget = {
      remoteName: 'fork',
      branchName: 'feature',
      remoteUrl: 'ssh://git.example/repo',
      remoteCreated: false
    }
    const getSnapshot = vi.fn().mockResolvedValue(snapshot())
    await loadSourceControlAutomaticUpstream({
      context: { ...context, pushTarget },
      request: { shouldApply: () => true },
      dependencies: dependencies({ getSnapshot })
    })

    expect(getSnapshot).toHaveBeenNthCalledWith(1, { ...context, pushTarget }, { pushTarget })
    expect(getSnapshot).toHaveBeenNthCalledWith(
      2,
      { ...context, pushTarget },
      { pushTarget, reuseLineStats: true }
    )
  })

  it('suppresses late snapshot and fresh results after cancellation', async () => {
    let resolveSnapshot!: (value: GitRepositorySnapshot | null) => void
    const pendingSnapshot = new Promise<GitRepositorySnapshot | null>((resolve) => {
      resolveSnapshot = resolve
    })
    let current = true
    const controller = new AbortController()
    const deps = dependencies({
      getSnapshot: vi.fn().mockReturnValue(pendingSnapshot)
    })
    const load = loadSourceControlAutomaticUpstream({
      context,
      request: {
        signal: controller.signal,
        shouldApply: () => current
      },
      dependencies: deps
    })
    current = false
    controller.abort()
    resolveSnapshot(snapshot())

    await expect(load).resolves.toBe('cancelled')
    expect(deps.fetchFresh).not.toHaveBeenCalled()
    expect(deps.apply).not.toHaveBeenCalled()
  })

  it.each(['native', 'exact WSL distro'])(
    'reduces post-poll %s configured-upstream work without changing status work',
    async () => {
      const armA = { status: 0, configuredUpstream: 0, separateUpstream: 0, ownerReads: 0 }
      const armB = { status: 0, configuredUpstream: 0, separateUpstream: 0, ownerReads: 0 }
      const recordStatusProducer = (counts: typeof armA): void => {
        counts.status += 1
        counts.configuredUpstream += 1
      }
      const baselineFresh = vi.fn(async () => {
        armA.configuredUpstream += 1
        armA.separateUpstream += 1
        return { hasUpstream: false, ahead: 0, behind: 0 } satisfies GitUpstreamStatus
      })
      recordStatusProducer(armA)
      await baselineFresh()

      const getSnapshot = vi.fn(async () => {
        armB.ownerReads += 1
        return snapshot()
      })
      const snapshotFreshFallback = vi.fn(async () => {
        armB.configuredUpstream += 1
        armB.separateUpstream += 1
        return { hasUpstream: false, ahead: 0, behind: 0 } satisfies GitUpstreamStatus
      })
      recordStatusProducer(armB)
      await loadSourceControlAutomaticUpstream({
        context,
        request: { shouldApply: () => true },
        dependencies: dependencies({ getSnapshot, fetchFresh: snapshotFreshFallback })
      })

      expect(baselineFresh).toHaveBeenCalledOnce()
      expect(getSnapshot).toHaveBeenCalledTimes(2)
      expect(snapshotFreshFallback).not.toHaveBeenCalled()
      expect(armA).toEqual({
        status: 1,
        configuredUpstream: 2,
        separateUpstream: 1,
        ownerReads: 0
      })
      expect(armB).toEqual({
        status: 1,
        configuredUpstream: 1,
        separateUpstream: 0,
        ownerReads: 2
      })
    }
  )

  it('reduces post-poll SSH provider/mux upstream work from one to zero', async () => {
    const armA = { gitStatus: 0, gitUpstreamStatus: 0, ownerReads: 0 }
    const armB = { gitStatus: 0, gitUpstreamStatus: 0, ownerReads: 0 }
    const recordSshStatusProducer = (counts: typeof armA): void => {
      counts.gitStatus += 1
    }
    const baselineFresh = vi.fn(async () => {
      armA.gitUpstreamStatus += 1
      return { hasUpstream: false, ahead: 0, behind: 0 } satisfies GitUpstreamStatus
    })
    recordSshStatusProducer(armA)
    await baselineFresh()

    const getSnapshot = vi.fn(async () => {
      armB.ownerReads += 1
      return snapshot()
    })
    const snapshotFreshFallback = vi.fn(async () => {
      armB.gitUpstreamStatus += 1
      return { hasUpstream: false, ahead: 0, behind: 0 } satisfies GitUpstreamStatus
    })
    recordSshStatusProducer(armB)
    await loadSourceControlAutomaticUpstream({
      context: { ...context, connectionId: 'ssh-current' },
      request: { shouldApply: () => true },
      dependencies: dependencies({ getSnapshot, fetchFresh: snapshotFreshFallback })
    })

    expect(baselineFresh).toHaveBeenCalledOnce()
    expect(getSnapshot).toHaveBeenCalledTimes(2)
    expect(snapshotFreshFallback).not.toHaveBeenCalled()
    expect(armA).toEqual({ gitStatus: 1, gitUpstreamStatus: 1, ownerReads: 0 })
    expect(armB).toEqual({ gitStatus: 1, gitUpstreamStatus: 0, ownerReads: 2 })
  })

  it('trades one extra runtime RPC for eliminating runtime physical upstream work', async () => {
    const armA = {
      gitStatus: 0,
      gitUpstreamStatus: 0,
      repositorySnapshot: 0,
      physicalUpstream: 0
    }
    const armB = {
      gitStatus: 0,
      gitUpstreamStatus: 0,
      repositorySnapshot: 0,
      physicalUpstream: 0
    }
    const recordRuntimeStatusProducer = (counts: typeof armA): void => {
      counts.gitStatus += 1
    }
    const baselineFresh = vi.fn(async () => {
      armA.gitUpstreamStatus += 1
      armA.physicalUpstream += 1
      return { hasUpstream: false, ahead: 0, behind: 0 } satisfies GitUpstreamStatus
    })
    recordRuntimeStatusProducer(armA)
    await baselineFresh()

    const getSnapshot = vi.fn(async () => {
      armB.repositorySnapshot += 1
      return snapshot()
    })
    const snapshotFreshFallback = vi.fn(async () => {
      armB.gitUpstreamStatus += 1
      armB.physicalUpstream += 1
      return { hasUpstream: false, ahead: 0, behind: 0 } satisfies GitUpstreamStatus
    })
    recordRuntimeStatusProducer(armB)
    await loadSourceControlAutomaticUpstream({
      context: {
        ...context,
        settings: { activeRuntimeEnvironmentId: 'runtime-1' }
      },
      request: { shouldApply: () => true },
      dependencies: dependencies({ getSnapshot, fetchFresh: snapshotFreshFallback })
    })

    expect(baselineFresh).toHaveBeenCalledOnce()
    expect(getSnapshot).toHaveBeenCalledTimes(2)
    expect(snapshotFreshFallback).not.toHaveBeenCalled()
    expect({ ...armA, totalRpc: armA.gitStatus + armA.gitUpstreamStatus }).toEqual({
      gitStatus: 1,
      gitUpstreamStatus: 1,
      repositorySnapshot: 0,
      physicalUpstream: 1,
      totalRpc: 2
    })
    expect({
      ...armB,
      totalRpc: armB.gitStatus + armB.gitUpstreamStatus + armB.repositorySnapshot
    }).toEqual({
      gitStatus: 1,
      gitUpstreamStatus: 0,
      repositorySnapshot: 2,
      physicalUpstream: 0,
      totalRpc: 3
    })
  })
})
