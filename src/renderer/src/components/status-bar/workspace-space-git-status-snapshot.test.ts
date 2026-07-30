import { describe, expect, it, vi } from 'vitest'
import type { GitRepositorySnapshot } from '../../../../shared/git-repository-snapshot'
import type { GitStatusResult } from '../../../../shared/types'
import {
  loadWorkspaceSpaceGitStatus,
  readWorkspaceSpaceGitStatusSnapshot
} from './workspace-space-git-status-snapshot'

function freshness(
  identity: string,
  overrides: Partial<GitRepositorySnapshot['freshness']['status']> = {}
): GitRepositorySnapshot['freshness']['status'] {
  return {
    state: 'fresh',
    generation: 2,
    currentGeneration: 2,
    revision: 7,
    identity,
    ...overrides
  }
}

function snapshot(
  overrides: {
    entryPath?: string
    statusRevision?: number | null
    branch?: string | null
    retentionTruncated?: boolean
    statusFreshness?: Partial<GitRepositorySnapshot['freshness']['status']>
    repositoryFreshness?: Partial<GitRepositorySnapshot['freshness']['status']>
    conflictFreshness?: Partial<GitRepositorySnapshot['freshness']['status']>
    upstreamFreshness?: Partial<GitRepositorySnapshot['freshness']['status']>
    upstream?: unknown
  } = {}
): GitRepositorySnapshot {
  const statusRevision = 'statusRevision' in overrides ? (overrides.statusRevision ?? null) : 7
  return {
    revision: Math.max(statusRevision ?? 0, 11),
    generatedAt: 100,
    repositoryIdentity: {
      head: 'abc123',
      branch: 'branch' in overrides ? (overrides.branch ?? null) : 'refs/heads/feature'
    },
    status: {
      entries: [
        {
          path: overrides.entryPath ?? 'src/app.ts',
          status: 'modified',
          area: 'unstaged',
          added: 2,
          removed: 1
        }
      ],
      didHitLimit: false,
      statusLength: 1,
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
      conflicts: freshness('status', {
        revision: statusRevision,
        ...overrides.conflictFreshness
      }),
      upstream: freshness('status:status', {
        revision: 11,
        ...overrides.upstreamFreshness
      }),
      worktreeGraph: freshness('worktree', {
        state: 'placeholder',
        revision: null
      })
    }
  }
}

const context = {
  settings: { activeRuntimeEnvironmentId: null },
  worktreeId: 'repo::/worktrees/feature',
  worktreePath: '/worktrees/feature',
  expectedBranch: 'refs/heads/feature'
}

function dependencies() {
  return {
    setGitStatus: vi.fn(),
    updateWorktreeGitIdentity: vi.fn(),
    setUpstreamStatus: vi.fn(),
    fetchUpstreamStatus: vi.fn()
  }
}

describe('readWorkspaceSpaceGitStatusSnapshot', () => {
  it('admits the complete configured-upstream projection without equating upstream identity', () => {
    const value = snapshot({
      upstreamFreshness: { identity: 'configured-upstream-is-independent' }
    })

    expect(readWorkspaceSpaceGitStatusSnapshot(value, context.expectedBranch)).toEqual({
      revision: 7,
      status: {
        entries: value.status.entries,
        conflictOperation: 'unknown',
        head: 'abc123',
        branch: 'refs/heads/feature',
        upstreamStatus: value.upstream,
        ignoredPaths: [],
        statusLength: 1
      },
      upstream: value.upstream
    })
  })

  it.each([
    ['stale status', { statusFreshness: { state: 'stale' as const } }],
    ['failed repository identity', { repositoryFreshness: { state: 'failed' as const } }],
    ['missing conflicts', { conflictFreshness: { state: 'missing' as const } }],
    ['stale upstream', { upstreamFreshness: { state: 'stale' as const } }],
    ['generation mismatch', { upstreamFreshness: { generation: 1 } }],
    ['identity mismatch', { conflictFreshness: { identity: 'other' } }],
    ['revision mismatch', { repositoryFreshness: { revision: 6 } }],
    ['missing status revision', { statusRevision: null }],
    ['truncated retention', { retentionTruncated: true }],
    ['branch mismatch', { branch: 'refs/heads/other' }]
  ])('rejects %s', (_label, overrides) => {
    expect(
      readWorkspaceSpaceGitStatusSnapshot(snapshot(overrides), context.expectedBranch)
    ).toBeNull()
  })

  it.each([
    ['missing upstream name', { hasUpstream: true, ahead: 0, behind: 0 }],
    ['empty upstream name', { hasUpstream: true, upstreamName: '', ahead: 0, behind: 0 }],
    ['negative count', { hasUpstream: true, upstreamName: 'origin/feature', ahead: -1, behind: 0 }],
    [
      'fractional count',
      { hasUpstream: true, upstreamName: 'origin/feature', ahead: 0.5, behind: 0 }
    ],
    [
      'wrong optional type',
      {
        hasUpstream: true,
        upstreamName: 'origin/feature',
        ahead: 0,
        behind: 0,
        hasConfiguredPushTarget: 'yes'
      }
    ],
    [
      'invalid no-upstream shape',
      { hasUpstream: false, ahead: 1, behind: 0, hasConfiguredPushTarget: true }
    ],
    [
      'ambiguous divergence',
      { hasUpstream: true, upstreamName: 'origin/feature', ahead: 1, behind: 1 }
    ]
  ])('rejects %s', (_label, upstream) => {
    expect(
      readWorkspaceSpaceGitStatusSnapshot(snapshot({ upstream }), context.expectedBranch)
    ).toBeNull()
  })

  it('preserves producer-valid configured no-upstream semantics', () => {
    const value = snapshot({
      upstream: {
        hasUpstream: false,
        ahead: 0,
        behind: 0,
        hasConfiguredPushTarget: true
      }
    })
    expect(readWorkspaceSpaceGitStatusSnapshot(value, context.expectedBranch)?.upstream).toEqual(
      value.upstream
    )
  })
})

describe('loadWorkspaceSpaceGitStatus', () => {
  it.each(['native', 'exact WSL distro', 'current SSH provider incarnation'])(
    'reduces cleanup plus Space Manager %s physical status/upstream work from two to one',
    async () => {
      let physicalStatusReads = 0
      let embeddedUpstreamReads = 0
      const physicalStatus = async (): Promise<void> => {
        physicalStatusReads += 1
        embeddedUpstreamReads += 1
      }
      await physicalStatus()
      await physicalStatus()
      expect([physicalStatusReads, embeddedUpstreamReads]).toEqual([2, 2])

      physicalStatusReads = 0
      embeddedUpstreamReads = 0
      await physicalStatus()
      const deps = dependencies()
      const getSnapshot = vi.fn().mockResolvedValue(snapshot())
      const result = await loadWorkspaceSpaceGitStatus({
        context,
        deps,
        request: { shouldStart: () => true, shouldContinue: () => true },
        dependencies: {
          getSnapshot,
          refreshFresh: vi.fn()
        }
      })

      expect(result).toBe('snapshot')
      expect([physicalStatusReads, embeddedUpstreamReads]).toEqual([1, 1])
      expect(getSnapshot).toHaveBeenNthCalledWith(1, context, {})
      expect(getSnapshot).toHaveBeenNthCalledWith(2, context, { reuseLineStats: true })
      expect(deps.setGitStatus).toHaveBeenCalledOnce()
      expect(deps.setUpstreamStatus).toHaveBeenCalledOnce()
    }
  )

  it('chooses the newest status revision despite an equal newer upstream revision', async () => {
    const deps = dependencies()
    await loadWorkspaceSpaceGitStatus({
      context,
      deps,
      request: { shouldStart: () => true, shouldContinue: () => true },
      dependencies: {
        getSnapshot: vi
          .fn()
          .mockResolvedValueOnce(snapshot({ entryPath: 'normal.ts', statusRevision: 4 }))
          .mockResolvedValueOnce(snapshot({ entryPath: 'reuse.ts', statusRevision: 8 })),
        refreshFresh: vi.fn()
      }
    })

    expect(deps.setGitStatus).toHaveBeenCalledWith(
      context.worktreeId,
      expect.objectContaining({ entries: [expect.objectContaining({ path: 'reuse.ts' })] })
    )
  })

  it('admits one identity when the other read fails independently', async () => {
    const deps = dependencies()
    const refreshFresh = vi.fn()
    await loadWorkspaceSpaceGitStatus({
      context,
      deps,
      request: { shouldStart: () => true, shouldContinue: () => true },
      dependencies: {
        getSnapshot: vi
          .fn()
          .mockRejectedValueOnce(new Error('normal failed'))
          .mockResolvedValueOnce(snapshot()),
        refreshFresh
      }
    })

    expect(deps.setGitStatus).toHaveBeenCalledOnce()
    expect(refreshFresh).not.toHaveBeenCalled()
  })

  it.each(['method_not_found', 'disconnected', 'stale projection'])(
    'keeps the fresh fallback for %s snapshot results',
    async (failure) => {
      const deps = dependencies()
      const refreshFresh = vi.fn(async ({ deps: refreshDeps }) => {
        refreshDeps.setGitStatus(context.worktreeId, {
          entries: [],
          conflictOperation: 'unknown'
        } as GitStatusResult)
      })
      await loadWorkspaceSpaceGitStatus({
        context,
        deps,
        request: { shouldStart: () => true, shouldContinue: () => true },
        dependencies: {
          getSnapshot:
            failure === 'stale projection'
              ? vi.fn().mockResolvedValue(snapshot({ statusFreshness: { state: 'stale' } }))
              : vi.fn().mockRejectedValue(new Error(failure)),
          refreshFresh
        }
      })

      expect(refreshFresh).toHaveBeenCalledOnce()
    }
  )

  it('lets an accepted fresh fallback finish identity and upstream after its own status write', async () => {
    let statusMissing = true
    const deps = dependencies()
    deps.setGitStatus.mockImplementation(() => {
      statusMissing = false
    })
    const refreshFresh = vi.fn(async ({ deps: freshDeps, request }) => {
      if (!request?.shouldApply?.()) {
        return
      }
      freshDeps.setGitStatus(context.worktreeId, {
        entries: [],
        conflictOperation: 'unknown'
      })
      freshDeps.updateWorktreeGitIdentity(context.worktreeId, {
        head: 'fresh-head',
        branch: context.expectedBranch
      })
      if (request.shouldApply()) {
        freshDeps.setUpstreamStatus(context.worktreeId, {
          hasUpstream: true,
          upstreamName: 'origin/feature',
          ahead: 0,
          behind: 0
        })
      }
    })

    await expect(
      loadWorkspaceSpaceGitStatus({
        context,
        deps,
        request: {
          shouldStart: () => statusMissing,
          shouldContinue: () => true
        },
        dependencies: {
          getSnapshot: vi.fn().mockResolvedValue(null),
          refreshFresh
        }
      })
    ).resolves.toBe('fresh')

    expect(deps.setGitStatus).toHaveBeenCalledOnce()
    expect(statusMissing).toBe(false)
    expect(deps.updateWorktreeGitIdentity).toHaveBeenCalledOnce()
    expect(deps.setUpstreamStatus).toHaveBeenCalledOnce()
  })

  it('does not claim a fresh fallback when an external status arrives before its first commit', async () => {
    let statusMissing = true
    const deps = dependencies()
    const refreshFresh = vi.fn(async ({ deps: freshDeps, request }) => {
      statusMissing = false
      if (request?.shouldApply?.()) {
        freshDeps.setGitStatus(context.worktreeId, {
          entries: [],
          conflictOperation: 'unknown'
        })
      }
    })

    await expect(
      loadWorkspaceSpaceGitStatus({
        context,
        deps,
        request: {
          shouldStart: () => statusMissing,
          shouldContinue: () => true
        },
        dependencies: {
          getSnapshot: vi.fn().mockResolvedValue(null),
          refreshFresh
        }
      })
    ).resolves.toBe('cancelled')

    expect(deps.setGitStatus).not.toHaveBeenCalled()
    expect(deps.updateWorktreeGitIdentity).not.toHaveBeenCalled()
    expect(deps.setUpstreamStatus).not.toHaveBeenCalled()
  })

  it('stops an owned fresh fallback when its exact context is cancelled after status', async () => {
    let statusMissing = true
    let contextCurrent = true
    const deps = dependencies()
    deps.setGitStatus.mockImplementation(() => {
      statusMissing = false
      contextCurrent = false
    })
    const refreshFresh = vi.fn(async ({ deps: freshDeps, request }) => {
      if (!request?.shouldApply?.()) {
        return
      }
      freshDeps.setGitStatus(context.worktreeId, {
        entries: [],
        conflictOperation: 'unknown'
      })
      freshDeps.updateWorktreeGitIdentity(context.worktreeId, {
        head: 'stale-head',
        branch: context.expectedBranch
      })
      if (request.shouldApply()) {
        freshDeps.setUpstreamStatus(context.worktreeId, {
          hasUpstream: false,
          ahead: 0,
          behind: 0
        })
      }
    })

    await expect(
      loadWorkspaceSpaceGitStatus({
        context,
        deps,
        request: {
          shouldStart: () => statusMissing && contextCurrent,
          shouldContinue: () => contextCurrent
        },
        dependencies: {
          getSnapshot: vi.fn().mockResolvedValue(null),
          refreshFresh
        }
      })
    ).resolves.toBe('cancelled')

    expect(deps.setGitStatus).toHaveBeenCalledOnce()
    expect(deps.updateWorktreeGitIdentity).not.toHaveBeenCalled()
    expect(deps.setUpstreamStatus).not.toHaveBeenCalled()
  })

  it('suppresses late snapshot and fallback application after cancellation or context change', async () => {
    let resolveSnapshot!: (value: GitRepositorySnapshot) => void
    const pending = new Promise<GitRepositorySnapshot>((resolve) => {
      resolveSnapshot = resolve
    })
    const deps = dependencies()
    const controller = new AbortController()
    let current = true
    const load = loadWorkspaceSpaceGitStatus({
      context,
      deps,
      request: {
        signal: controller.signal,
        shouldStart: () => current,
        shouldContinue: () => current
      },
      dependencies: {
        getSnapshot: vi.fn().mockReturnValue(pending),
        refreshFresh: vi.fn()
      }
    })
    current = false
    controller.abort()
    resolveSnapshot(snapshot())

    await expect(load).resolves.toBe('cancelled')
    expect(deps.setGitStatus).not.toHaveBeenCalled()
  })
})
