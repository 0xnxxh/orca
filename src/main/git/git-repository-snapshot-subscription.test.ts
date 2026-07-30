import { describe, expect, it, vi } from 'vitest'
import type { GitStatusResult } from '../../shared/types'
import type { GitRepositorySnapshotRevisionEvent } from '../../shared/git-repository-snapshot'
import {
  GitRepositorySnapshotOwner,
  type GitRepositoryExecutionIdentity,
  type GitRepositoryStatusIdentity
} from './git-repository-snapshot-owner'

const native = { kind: 'native' } as const
const defaultStatusIdentity: GitRepositoryStatusIdentity = {
  includeIgnored: false,
  reuseLineStats: false,
  bypassEffectiveUpstreamNegativeCache: false,
  limit: 1_000,
  sharedLinkPaths: []
}
const statusResult: GitStatusResult = {
  entries: [],
  conflictOperation: 'unknown',
  head: 'abc123',
  branch: 'refs/heads/main',
  upstreamStatus: {
    hasUpstream: true,
    upstreamName: 'origin/main',
    ahead: 1,
    behind: 0
  }
}
const explicitTarget = {
  remoteName: 'fork',
  branchName: 'feature',
  remoteUrl: 'ssh://git.example/repo',
  remoteCreated: false
}

function query(
  executionIdentity: GitRepositoryExecutionIdentity = native,
  worktreePath = '/repo',
  statusIdentity: GitRepositoryStatusIdentity = defaultStatusIdentity,
  pushTarget = explicitTarget
) {
  return { executionIdentity, worktreePath, statusIdentity, pushTarget }
}

describe('GitRepositorySnapshotOwner revision subscriptions', () => {
  it('publishes configured-upstream readiness without a second upstream read', async () => {
    const owner = new GitRepositorySnapshotOwner()
    const events: GitRepositorySnapshotRevisionEvent[] = []
    owner.subscribe({ ...query(), pushTarget: undefined }, (event) => events.push(event))

    await owner.readStatus(
      native,
      '/repo',
      defaultStatusIdentity,
      undefined,
      async () => statusResult
    )

    expect(events).toEqual([{ state: 'ready', generation: 0, revision: 1 }])
  })

  it('waits for a complete explicit upstream projection before publishing readiness', async () => {
    const owner = new GitRepositorySnapshotOwner()
    const events: GitRepositorySnapshotRevisionEvent[] = []
    owner.subscribe(query(), (event) => events.push(event))

    await owner.readStatus(
      native,
      '/repo',
      defaultStatusIdentity,
      undefined,
      async () => statusResult
    )
    expect(events).toEqual([])

    await owner.readUpstream(native, '/repo', explicitTarget, async () => ({
      hasUpstream: true,
      upstreamName: 'fork/feature',
      ahead: 1,
      behind: 1
    }))
    expect(events).toEqual([])

    await owner.readUpstream(native, '/repo', explicitTarget, async () => ({
      hasUpstream: true,
      upstreamName: 'fork/feature',
      ahead: 1,
      behind: 1,
      behindCommitsArePatchEquivalent: false
    }))
    expect(events).toEqual([{ state: 'ready', generation: 0, revision: 3 }])
  })

  it('does not admit an ambiguous embedded upstream through an older complete projection', async () => {
    const owner = new GitRepositorySnapshotOwner()
    const events: GitRepositorySnapshotRevisionEvent[] = []
    const configuredQuery = { ...query(), pushTarget: undefined }
    owner.subscribe(configuredQuery, (event) => events.push(event))

    await owner.readStatus(
      native,
      '/repo',
      defaultStatusIdentity,
      undefined,
      async () => statusResult
    )
    await owner.readUpstream(native, '/repo', undefined, async () => ({
      hasUpstream: true,
      upstreamName: 'origin/main',
      ahead: 1,
      behind: 0
    }))
    events.length = 0

    await owner.readStatus(native, '/repo', defaultStatusIdentity, undefined, async () => ({
      ...statusResult,
      upstreamStatus: {
        hasUpstream: true,
        upstreamName: 'origin/main',
        ahead: 1,
        behind: 1
      }
    }))

    expect(events).toEqual([])
    expect(owner.getSnapshot(configuredQuery)?.upstream).toEqual({
      hasUpstream: true,
      upstreamName: 'origin/main',
      ahead: 1,
      behind: 1
    })
  })

  it('keeps overlapping producer and revision-driven consumer demand at one physical read each', async () => {
    const owner = new GitRepositorySnapshotOwner()
    const statusLoad = vi.fn(async () => statusResult)
    const upstreamLoad = vi.fn(async () => ({
      hasUpstream: true,
      upstreamName: 'fork/feature',
      ahead: 0,
      behind: 0
    }))
    const snapshots: unknown[] = []
    owner.subscribe(query(), (event) => {
      if (event.state === 'ready') {
        snapshots.push(owner.getSnapshot(query()))
      }
    })

    await Promise.all([
      owner.readStatus(native, '/repo', defaultStatusIdentity, undefined, statusLoad),
      owner.readStatus(native, '/repo', defaultStatusIdentity, undefined, statusLoad)
    ])
    await Promise.all([
      owner.readUpstream(native, '/repo', explicitTarget, upstreamLoad),
      owner.readUpstream(native, '/repo', explicitTarget, upstreamLoad)
    ])

    expect(statusLoad).toHaveBeenCalledOnce()
    expect(upstreamLoad).toHaveBeenCalledOnce()
    expect(snapshots).toHaveLength(1)
  })

  it('reuses a retained explicit upstream only while repository identity is unchanged', async () => {
    const owner = new GitRepositorySnapshotOwner()
    const events: GitRepositorySnapshotRevisionEvent[] = []
    owner.subscribe(query(), (event) => events.push(event))
    await owner.readStatus(
      native,
      '/repo',
      defaultStatusIdentity,
      undefined,
      async () => statusResult
    )
    await owner.readUpstream(native, '/repo', explicitTarget, async () => ({
      hasUpstream: true,
      upstreamName: 'fork/feature',
      ahead: 0,
      behind: 0
    }))
    events.length = 0

    await owner.readStatus(native, '/repo', defaultStatusIdentity, undefined, async () => ({
      ...statusResult,
      entries: [{ path: 'src/app.ts', status: 'modified', area: 'unstaged' }]
    }))
    expect(events).toEqual([{ state: 'ready', generation: 0, revision: 3 }])

    await owner.readStatus(native, '/repo', defaultStatusIdentity, undefined, async () => ({
      ...statusResult,
      head: 'def456',
      branch: 'refs/heads/other'
    }))
    expect(events).toHaveLength(1)

    await owner.readUpstream(native, '/repo', explicitTarget, async () => ({
      hasUpstream: true,
      upstreamName: 'fork/feature',
      ahead: 2,
      behind: 0
    }))
    expect(events.at(-1)).toEqual({ state: 'ready', generation: 0, revision: 5 })
  })

  it('reports both mutation fences and suppresses stale completion readiness', async () => {
    const owner = new GitRepositorySnapshotOwner()
    const events: GitRepositorySnapshotRevisionEvent[] = []
    let resolveStatus!: (result: GitStatusResult) => void
    const pending = new Promise<GitStatusResult>((resolve) => {
      resolveStatus = resolve
    })
    owner.subscribe({ ...query(), pushTarget: undefined }, (event) => events.push(event))
    const stale = owner.readStatus(native, '/repo', defaultStatusIdentity, undefined, () => pending)

    owner.invalidate()
    resolveStatus(statusResult)
    await stale
    owner.invalidate()
    await owner.readStatus(
      native,
      '/repo',
      defaultStatusIdentity,
      undefined,
      async () => statusResult
    )

    expect(events).toEqual([
      { state: 'invalidated', generation: 1, revision: 0 },
      { state: 'invalidated', generation: 2, revision: 0 },
      { state: 'ready', generation: 2, revision: 1 }
    ])
  })

  it('isolates exact host, path, status-option, and target subscriptions', async () => {
    const owner = new GitRepositorySnapshotOwner()
    const matching = vi.fn()
    const listeners = [
      owner.subscribe(query(), matching),
      owner.subscribe(query({ kind: 'wsl', distro: 'Ubuntu' }), vi.fn()),
      owner.subscribe(query(native, '/other'), vi.fn()),
      owner.subscribe(
        query(native, '/repo', { ...defaultStatusIdentity, reuseLineStats: true }),
        vi.fn()
      ),
      owner.subscribe(
        query(native, '/repo', defaultStatusIdentity, { ...explicitTarget, remoteCreated: true }),
        vi.fn()
      )
    ]

    await owner.readStatus(
      native,
      '/repo',
      defaultStatusIdentity,
      undefined,
      async () => statusResult
    )
    await owner.readUpstream(native, '/repo', explicitTarget, async () => ({
      hasUpstream: false,
      ahead: 0,
      behind: 0
    }))

    expect(matching).toHaveBeenCalledOnce()
    for (const unsubscribe of listeners.slice(1)) {
      expect(unsubscribe).toEqual(expect.any(Function))
    }
  })

  it('releases exact listeners and shares one immutable event allocation across fan-out', async () => {
    const owner = new GitRepositorySnapshotOwner()
    const events: GitRepositorySnapshotRevisionEvent[] = []
    const unsubscribes = Array.from({ length: 100 }, () =>
      owner.subscribe({ ...query(), pushTarget: undefined }, (event) => events.push(event))
    )

    await owner.readStatus(
      native,
      '/repo',
      defaultStatusIdentity,
      undefined,
      async () => statusResult
    )

    expect(events).toHaveLength(100)
    expect(new Set(events)).toHaveLength(1)
    expect(Object.isFrozen(events[0])).toBe(true)
    expect(owner.getSubscriptionCountForTests()).toBe(100)
    for (const unsubscribe of unsubscribes) {
      unsubscribe()
    }
    expect(owner.getSubscriptionCountForTests()).toBe(0)
  })

  it('does not publish failed or retention-truncated status projections', async () => {
    const owner = new GitRepositorySnapshotOwner()
    const listener = vi.fn()
    owner.subscribe({ ...query(), pushTarget: undefined }, listener)
    await expect(
      owner.readStatus(native, '/repo', defaultStatusIdentity, undefined, async () => {
        throw new Error('status failed')
      })
    ).rejects.toThrow('status failed')
    await owner.readStatus(native, '/repo', defaultStatusIdentity, undefined, async () => ({
      ...statusResult,
      entries: Array.from({ length: 1_001 }, (_, index) => ({
        path: `src/file-${index}.ts`,
        status: 'modified' as const,
        area: 'unstaged' as const
      }))
    }))

    expect(listener).not.toHaveBeenCalled()
  })
})
