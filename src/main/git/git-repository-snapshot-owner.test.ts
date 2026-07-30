import { describe, expect, it, vi } from 'vitest'
import type { GitPushTarget, GitStatusResult, GitUpstreamStatus } from '../../shared/types'
import {
  GitRepositorySnapshotOwner,
  type GitRepositoryExecutionIdentity,
  type GitRepositoryStatusIdentity
} from './git-repository-snapshot-owner'
import { MAX_GIT_REPOSITORY_SNAPSHOT_STATUS_ENTRIES } from './git-repository-snapshot-projection'

const native = { kind: 'native' } as const
const defaultStatusIdentity: GitRepositoryStatusIdentity = {
  includeIgnored: false,
  reuseLineStats: false,
  bypassEffectiveUpstreamNegativeCache: false,
  limit: 1_000,
  sharedLinkPaths: []
}
const statusResult: GitStatusResult = {
  entries: [{ path: 'src/app.ts', status: 'modified', area: 'unstaged', added: 2, removed: 1 }],
  conflictOperation: 'merge',
  head: 'abc123',
  branch: 'refs/heads/main',
  upstreamStatus: {
    hasUpstream: true,
    upstreamName: 'origin/main',
    ahead: 1,
    behind: 2
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

function query(
  executionIdentity: GitRepositoryExecutionIdentity = native,
  worktreePath = '/repo',
  identity: GitRepositoryStatusIdentity = defaultStatusIdentity,
  pushTarget?: GitPushTarget
) {
  return { executionIdentity, worktreePath, statusIdentity: identity, pushTarget }
}

describe('GitRepositorySnapshotOwner', () => {
  it('publishes immutable combined projections with monotonic revisions', async () => {
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(200)
    const owner = new GitRepositorySnapshotOwner(128, 8, now)

    await owner.readStatus(
      native,
      '/repo',
      defaultStatusIdentity,
      undefined,
      async () => statusResult
    )
    const first = owner.getSnapshot(query())

    expect(first).toMatchObject({
      revision: 1,
      generatedAt: 100,
      repositoryIdentity: { head: 'abc123', branch: 'refs/heads/main' },
      status: {
        entries: statusResult.entries,
        didHitLimit: false,
        statusLength: null,
        lineStatsState: 'complete'
      },
      upstream: statusResult.upstreamStatus,
      conflicts: 'merge',
      worktreeGraphVersion: 0,
      freshness: {
        status: { state: 'fresh', generation: 0, revision: 1 },
        upstream: { state: 'fresh', generation: 0, revision: 1 },
        worktreeGraph: { state: 'placeholder', generation: 0 }
      }
    })
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first?.status)).toBe(true)
    expect(Object.isFrozen(first?.status.entries)).toBe(true)
    expect(Object.isFrozen(first?.status.entries[0])).toBe(true)

    const refreshedUpstream = {
      hasUpstream: true,
      upstreamName: 'origin/main',
      ahead: 3,
      behind: 0,
      behindCommitsArePatchEquivalent: true
    }
    await owner.readUpstream(native, '/repo', undefined, async () => refreshedUpstream)
    const second = owner.getSnapshot(query())

    expect(second?.revision).toBe(2)
    expect(second?.generatedAt).toBe(200)
    expect(second?.status.entries).toEqual(first?.status.entries)
    expect(second?.upstream).toEqual(refreshedUpstream)
    expect(second?.freshness.status.revision).toBe(1)
    expect(second?.freshness.upstream.revision).toBe(2)
  })

  it('reduces settled polling plus Checks demand from two physical loads to one per projection', async () => {
    const pushTarget = {
      remoteName: 'fork',
      branchName: 'feature',
      remoteUrl: 'ssh://git.example/repo',
      remoteCreated: false
    }
    const upstreamResult = {
      hasUpstream: true,
      upstreamName: 'fork/feature',
      ahead: 1,
      behind: 0
    }
    const baselineOwner = new GitRepositorySnapshotOwner()
    const baselineStatusLoads = vi.fn(async () => statusResult)
    const baselineUpstreamLoads = vi.fn(async () => upstreamResult)
    await baselineOwner.readStatus(
      native,
      '/repo',
      defaultStatusIdentity,
      undefined,
      baselineStatusLoads
    )
    await baselineOwner.readUpstream(native, '/repo', pushTarget, baselineUpstreamLoads)
    await baselineOwner.readStatus(
      native,
      '/repo',
      defaultStatusIdentity,
      undefined,
      baselineStatusLoads
    )
    await baselineOwner.readUpstream(native, '/repo', pushTarget, baselineUpstreamLoads)

    const migratedOwner = new GitRepositorySnapshotOwner()
    const migratedStatusLoads = vi.fn(async () => statusResult)
    const migratedUpstreamLoads = vi.fn(async () => upstreamResult)
    await migratedOwner.readStatus(
      native,
      '/repo',
      defaultStatusIdentity,
      undefined,
      migratedStatusLoads
    )
    await migratedOwner.readUpstream(native, '/repo', pushTarget, migratedUpstreamLoads)
    const snapshot = migratedOwner.getSnapshot(
      query(native, '/repo', defaultStatusIdentity, pushTarget)
    )

    expect(baselineStatusLoads).toHaveBeenCalledTimes(2)
    expect(baselineUpstreamLoads).toHaveBeenCalledTimes(2)
    expect(migratedStatusLoads).toHaveBeenCalledOnce()
    expect(migratedUpstreamLoads).toHaveBeenCalledOnce()
    expect(snapshot).toMatchObject({
      freshness: { status: { state: 'fresh' }, upstream: { state: 'fresh' } },
      upstream: { upstreamName: 'fork/feature' }
    })
  })

  it('does not publish rejected reads and always retries settled work', async () => {
    const owner = new GitRepositorySnapshotOwner()
    const failure = new Error('read failed')
    const statusLoad = vi
      .fn<(_signal: AbortSignal) => Promise<GitStatusResult>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(statusResult)
      .mockResolvedValueOnce(statusResult)
      .mockRejectedValueOnce(failure)
    const upstreamLoad = vi
      .fn<() => Promise<GitUpstreamStatus>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ hasUpstream: false, ahead: 0, behind: 0 })
      .mockResolvedValueOnce({ hasUpstream: false, ahead: 0, behind: 0 })
      .mockRejectedValueOnce(failure)

    await expect(
      owner.readStatus(native, '/repo', defaultStatusIdentity, undefined, statusLoad)
    ).rejects.toBe(failure)
    await expect(owner.readUpstream(native, '/repo', undefined, upstreamLoad)).rejects.toBe(failure)
    expect(owner.getSnapshot(query())).toBeNull()
    expect(owner.getRetentionState().repositories).toBe(0)

    await owner.readStatus(native, '/repo', defaultStatusIdentity, undefined, statusLoad)
    await owner.readStatus(native, '/repo', defaultStatusIdentity, undefined, statusLoad)
    await owner.readUpstream(native, '/repo', undefined, upstreamLoad)
    await owner.readUpstream(native, '/repo', undefined, upstreamLoad)

    expect(statusLoad).toHaveBeenCalledTimes(3)
    expect(upstreamLoad).toHaveBeenCalledTimes(3)
    expect(owner.getSnapshot(query())?.revision).toBe(4)

    await expect(
      owner.readStatus(native, '/repo', defaultStatusIdentity, undefined, statusLoad)
    ).rejects.toBe(failure)
    await expect(owner.readUpstream(native, '/repo', undefined, upstreamLoad)).rejects.toBe(failure)
    expect(owner.getSnapshot(query())).toMatchObject({
      revision: 4,
      freshness: {
        status: { state: 'failed' },
        upstream: { state: 'failed' }
      }
    })
  })

  it('keeps status cancellation scoped to each lease', async () => {
    const owner = new GitRepositorySnapshotOwner()
    const pending = deferred<GitStatusResult>()
    const load = vi.fn((_signal: AbortSignal) => pending.promise)
    const firstController = new AbortController()
    const secondController = new AbortController()
    const firstError = new Error('first cancelled')

    const first = owner.readStatus(
      native,
      '/repo',
      defaultStatusIdentity,
      firstController.signal,
      load
    )
    const second = owner.readStatus(
      native,
      '/repo',
      defaultStatusIdentity,
      secondController.signal,
      load
    )
    firstController.abort(firstError)

    await expect(first).rejects.toBe(firstError)
    expect(load).toHaveBeenCalledOnce()
    expect(load.mock.calls[0][0].aborted).toBe(false)
    pending.resolve(statusResult)
    await expect(second).resolves.toBe(statusResult)
    expect(owner.getSnapshot(query())?.revision).toBe(1)
  })

  it('prefers a newer embedded upstream projection after invalidation', async () => {
    const owner = new GitRepositorySnapshotOwner()
    await owner.readUpstream(native, '/repo', undefined, async () => ({
      hasUpstream: true,
      upstreamName: 'old/main',
      ahead: 0,
      behind: 0
    }))
    owner.invalidate()
    await owner.readStatus(native, '/repo', defaultStatusIdentity, undefined, async () => ({
      ...statusResult,
      upstreamStatus: {
        hasUpstream: true,
        upstreamName: 'fresh/main',
        ahead: 1,
        behind: 0
      }
    }))

    expect(owner.getSnapshot(query())).toMatchObject({
      upstream: { upstreamName: 'fresh/main' },
      freshness: { upstream: { state: 'fresh', generation: 1 } }
    })
  })

  it('suppresses stale status and upstream completion across both mutation fences', async () => {
    const owner = new GitRepositorySnapshotOwner()
    const statuses = Array.from({ length: 3 }, () => deferred<GitStatusResult>())
    const upstreams = Array.from({ length: 3 }, () => deferred<GitUpstreamStatus>())
    let statusIndex = 0
    let upstreamIndex = 0
    const readStatus = () =>
      owner.readStatus(native, '/repo', defaultStatusIdentity, undefined, () => {
        const pending = statuses[statusIndex]
        statusIndex += 1
        return pending.promise
      })
    const readUpstream = () =>
      owner.readUpstream(native, '/repo', undefined, () => {
        const pending = upstreams[upstreamIndex]
        upstreamIndex += 1
        return pending.promise
      })

    const before = [readStatus(), readUpstream()]
    await Promise.resolve()
    owner.invalidate()
    const during = [readStatus(), readUpstream()]
    await Promise.resolve()
    owner.invalidate()
    const after = [readStatus(), readUpstream()]
    await Promise.resolve()

    statuses[0].resolve({ ...statusResult, head: 'before' })
    statuses[1].resolve({ ...statusResult, head: 'during' })
    statuses[2].resolve({ ...statusResult, head: 'after' })
    upstreams[0].resolve({ hasUpstream: true, upstreamName: 'before/main', ahead: 0, behind: 0 })
    upstreams[1].resolve({ hasUpstream: true, upstreamName: 'during/main', ahead: 0, behind: 0 })
    upstreams[2].resolve({ hasUpstream: true, upstreamName: 'after/main', ahead: 0, behind: 0 })

    await Promise.all([...before, ...during, ...after])
    expect(owner.getSnapshot(query())).toMatchObject({
      revision: 2,
      repositoryIdentity: { head: 'after' },
      upstream: { upstreamName: 'after/main' },
      freshness: {
        status: { state: 'fresh', generation: 2 },
        upstream: { state: 'fresh', generation: 2 }
      }
    })
  })

  it('isolates every host, path, status option, and upstream target dimension', async () => {
    const owner = new GitRepositorySnapshotOwner()
    const statusLoad = vi.fn(async () => statusResult)
    const upstreamLoad = vi.fn(async () => ({ hasUpstream: false, ahead: 0, behind: 0 }))
    const statusCases: [GitRepositoryExecutionIdentity, string, GitRepositoryStatusIdentity][] = [
      [native, '/repo-a', defaultStatusIdentity],
      [native, '/repo-b', defaultStatusIdentity],
      [{ kind: 'wsl', distro: 'Ubuntu' }, '/repo-a', defaultStatusIdentity],
      [{ kind: 'wsl', distro: 'Debian' }, '/repo-a', defaultStatusIdentity],
      [native, '/repo-a', { ...defaultStatusIdentity, includeIgnored: true }],
      [native, '/repo-a', { ...defaultStatusIdentity, reuseLineStats: true }],
      [native, '/repo-a', { ...defaultStatusIdentity, bypassEffectiveUpstreamNegativeCache: true }],
      [native, '/repo-a', { ...defaultStatusIdentity, limit: 20 }],
      [native, '/repo-a', { ...defaultStatusIdentity, sharedLinkPaths: ['node_modules'] }]
    ]
    const target = { remoteName: 'fork', branchName: 'feature' }
    const targets: (GitPushTarget | undefined)[] = [
      undefined,
      target,
      { ...target, remoteName: 'origin' },
      { ...target, branchName: 'other' },
      { ...target, remoteUrl: 'https://github.com/example/fork.git' },
      { ...target, remoteCreated: false },
      { ...target, remoteCreated: true }
    ]

    await Promise.all(
      statusCases.map(([host, path, identity]) =>
        owner.readStatus(host, path, identity, undefined, statusLoad)
      )
    )
    await Promise.all(
      targets.map((candidate) => owner.readUpstream(native, '/repo-a', candidate, upstreamLoad))
    )

    expect(statusLoad).toHaveBeenCalledTimes(statusCases.length)
    expect(upstreamLoad).toHaveBeenCalledTimes(targets.length)
  })

  it('bounds repositories and projection variants without merging evicted identities', async () => {
    const owner = new GitRepositorySnapshotOwner(2, 2)
    const evictedPending = deferred<GitStatusResult>()
    const evicted = owner.readStatus(
      native,
      '/repo-a',
      defaultStatusIdentity,
      undefined,
      () => evictedPending.promise
    )
    await owner.readStatus(native, '/repo-b', defaultStatusIdentity, undefined, async () => ({
      ...statusResult,
      head: 'repo-b'
    }))
    await owner.readStatus(native, '/repo-c', defaultStatusIdentity, undefined, async () => ({
      ...statusResult,
      head: 'repo-c'
    }))
    evictedPending.resolve({ ...statusResult, head: 'repo-a-late' })
    await evicted

    expect(owner.getRetentionState().repositories).toBe(2)
    expect(owner.getSnapshot(query(native, '/repo-a'))).toBeNull()
    expect(owner.getSnapshot(query(native, '/repo-c'))?.repositoryIdentity.head).toBe('repo-c')

    await owner.readStatus(
      native,
      '/repo-c',
      { ...defaultStatusIdentity, includeIgnored: true },
      undefined,
      async () => statusResult
    )
    await owner.readStatus(
      native,
      '/repo-c',
      { ...defaultStatusIdentity, reuseLineStats: true },
      undefined,
      async () => statusResult
    )
    const target = { remoteName: 'fork', branchName: 'feature' }
    await owner.readUpstream(native, '/repo-c', undefined, async () => ({
      hasUpstream: false,
      ahead: 0,
      behind: 0
    }))
    await owner.readUpstream(native, '/repo-c', target, async () => ({
      hasUpstream: false,
      ahead: 0,
      behind: 0
    }))
    await owner.readUpstream(native, '/repo-c', { ...target, branchName: 'other' }, async () => ({
      hasUpstream: false,
      ahead: 0,
      behind: 0
    }))

    expect(owner.getRetentionState()).toEqual({
      repositories: 2,
      statusProjections: 3,
      upstreamProjections: 2
    })
  })

  it('bounds retained status payloads without changing the caller result', async () => {
    const owner = new GitRepositorySnapshotOwner()
    const entries = Array.from(
      { length: MAX_GIT_REPOSITORY_SNAPSHOT_STATUS_ENTRIES + 1 },
      (_, index) => ({
        path: `generated/file-${index}.ts`,
        status: 'untracked' as const,
        area: 'untracked' as const
      })
    )
    const result = { entries, conflictOperation: 'unknown' as const }

    const returned = await owner.readStatus(
      native,
      '/large-repo',
      { ...defaultStatusIdentity, limit: 0 },
      undefined,
      async () => result
    )
    const snapshot = owner.getSnapshot(
      query(native, '/large-repo', { ...defaultStatusIdentity, limit: 0 })
    )

    expect(returned.entries).toHaveLength(MAX_GIT_REPOSITORY_SNAPSHOT_STATUS_ENTRIES + 1)
    expect(snapshot?.status.entries).toHaveLength(MAX_GIT_REPOSITORY_SNAPSHOT_STATUS_ENTRIES)
    expect(snapshot?.status.retentionTruncated).toBe(true)
  })
})
