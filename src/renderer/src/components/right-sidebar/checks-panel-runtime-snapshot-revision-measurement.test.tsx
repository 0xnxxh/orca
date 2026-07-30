// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { useCallback, useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitRepositorySnapshotSubscriptionEvent } from '../../../../shared/git-repository-snapshot'
import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import { shouldPollChecksPanelRuntimeSshStatus } from './checks-panel-git-status-snapshot'
import { useChecksPanelRepositorySnapshotRevision } from './use-checks-panel-repository-snapshot-revision'

const subscribeRuntime = vi.fn()

vi.mock('@/runtime/desktop-git-repository-snapshot-client', () => ({
  subscribeDesktopGitRepositorySnapshot: vi.fn()
}))

vi.mock('@/runtime/runtime-git-repository-snapshot-revision-client', () => ({
  getRuntimeGitRepositorySnapshotRevisionTargetKey: () => 'env-1\\08\\0id:wt-1',
  subscribeRuntimeGitRepositorySnapshotRevision: (
    ...args: Parameters<typeof subscribeRuntime>
  ): ReturnType<typeof subscribeRuntime> => subscribeRuntime(...args)
}))

type Counts = {
  physicalStatus: number
  physicalUpstream: number
  snapshotRpc: number
  ownerReads: number
}

function runActiveStatusProducer(counts: Counts): void {
  counts.physicalStatus += 1
  counts.physicalUpstream += 1
}

function useMeasuredRuntimeChecks(
  counts: Counts,
  runtimeStreamEnabled: boolean,
  reuseIdentityHit: boolean
): void {
  const revisionRef = useRef<ReturnType<typeof useChecksPanelRepositorySnapshotRevision> | null>(
    null
  )
  const readSnapshot = useCallback(() => {
    const revision = revisionRef.current
    if (!revision) {
      return
    }
    const read = revision.beginRead()
    counts.snapshotRpc += 1
    counts.ownerReads += 1
    if (reuseIdentityHit) {
      counts.snapshotRpc += 1
      counts.ownerReads += 1
    }
    revision.finishRead(read, 10, true)
  }, [counts, reuseIdentityHit])
  const revision = useChecksPanelRepositorySnapshotRevision({
    context: {
      settings: { activeRuntimeEnvironmentId: 'env-1' },
      worktreeId: 'wt-1',
      worktreePath: '/repo'
    },
    contextKey: 'runtime-ssh',
    enabled: false,
    runtimeEnabled: runtimeStreamEnabled,
    pushTarget: null,
    requestRefresh: readSnapshot
  })
  revisionRef.current = revision

  useEffect(() => {
    if (
      !shouldPollChecksPanelRuntimeSshStatus({
        isPanelVisible: true,
        runtimeEnvironmentId: 'env-1',
        repoConnectionId: 'ssh-1',
        runtimeSnapshotPollingRequired: revision.runtimeSnapshotPollingRequired
      })
    ) {
      return undefined
    }
    let skippedInitialRun = false
    return installWindowVisibilityInterval({
      run: () => {
        if (!skippedInitialRun) {
          skippedInitialRun = true
          return
        }
        readSnapshot()
      },
      intervalMs: 3_000
    })
  }, [readSnapshot, revision.runtimeSnapshotPollingRequired])
}

describe('runtime Checks snapshot revision measurement', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    subscribeRuntime.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['normal identity', false, 20],
    ['reuse identity', true, 40]
  ])(
    'changes one visible idle minute from %s polling to zero after readiness',
    async (_label, reuseIdentityHit, baselineReads) => {
      const baseline = {
        physicalStatus: 0,
        physicalUpstream: 0,
        snapshotRpc: 0,
        ownerReads: 0
      }
      runActiveStatusProducer(baseline)
      const baselineHook = renderHook(() =>
        useMeasuredRuntimeChecks(baseline, false, reuseIdentityHit)
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      baselineHook.unmount()

      const callbacks: {
        onSubscribed: (incarnation: number) => void
        onRevision: (event: GitRepositorySnapshotSubscriptionEvent) => void
      }[] = []
      subscribeRuntime.mockImplementation(async (_context, _options, nextCallbacks) => {
        callbacks.push(nextCallbacks)
        return { unsubscribe: vi.fn() }
      })
      const migrated = {
        physicalStatus: 0,
        physicalUpstream: 0,
        snapshotRpc: 0,
        ownerReads: 0
      }
      runActiveStatusProducer(migrated)
      const migratedHook = renderHook(() =>
        useMeasuredRuntimeChecks(migrated, true, reuseIdentityHit)
      )
      await act(async () => {
        await Promise.resolve()
      })
      expect(callbacks).toHaveLength(2)
      act(() => {
        callbacks[0]?.onSubscribed(4)
        callbacks[1]?.onSubscribed(4)
        callbacks[0]?.onRevision({
          state: 'ready',
          generation: 2,
          revision: 10,
          incarnation: 4
        })
      })
      expect(migrated.snapshotRpc).toBe(reuseIdentityHit ? 2 : 1)
      migrated.snapshotRpc = 0
      migrated.ownerReads = 0
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      migratedHook.unmount()

      expect({
        baseline,
        migrated,
        registrations: subscribeRuntime.mock.calls.length
      }).toEqual({
        baseline: {
          physicalStatus: 1,
          physicalUpstream: 1,
          snapshotRpc: baselineReads,
          ownerReads: baselineReads
        },
        migrated: {
          physicalStatus: 1,
          physicalUpstream: 1,
          snapshotRpc: 0,
          ownerReads: 0
        },
        registrations: 2
      })
    }
  )
})
