import { describe, expect, it, vi } from 'vitest'
import type { GitRepositorySnapshotSubscriptionEvent } from '../../../../shared/git-repository-snapshot'
import type { RuntimeGitRepositorySnapshotRevisionCallbacks } from '@/runtime/runtime-git-repository-snapshot-revision-client'
import { ChecksPanelRuntimeRepositorySnapshotRevisions } from './checks-panel-runtime-repository-snapshot-revisions'

const subscribeRuntime = vi.hoisted(() => vi.fn())

vi.mock('@/runtime/runtime-git-repository-snapshot-revision-client', () => ({
  subscribeRuntimeGitRepositorySnapshotRevision: (
    ...args: Parameters<typeof subscribeRuntime>
  ): ReturnType<typeof subscribeRuntime> => subscribeRuntime(...args)
}))

describe('ChecksPanelRuntimeRepositorySnapshotRevisions', () => {
  it('requires paired live incarnations before a ready read can suppress polling', async () => {
    const streamCallbacks: RuntimeGitRepositorySnapshotRevisionCallbacks[] = []
    const unsubscribes = [vi.fn(), vi.fn()]
    subscribeRuntime.mockImplementation(async (_context, _options, callbacks) => {
      streamCallbacks.push(callbacks)
      return { unsubscribe: unsubscribes[streamCallbacks.length - 1] }
    })
    const callbacks = {
      onReady: vi.fn(),
      onInvalidated: vi.fn(),
      onReplay: vi.fn(),
      onUnavailable: vi.fn()
    }
    const revisions = new ChecksPanelRuntimeRepositorySnapshotRevisions(
      'runtime-one',
      {
        settings: { activeRuntimeEnvironmentId: 'env-1' },
        worktreeId: 'wt-1',
        worktreePath: '/repo'
      },
      null,
      callbacks
    )
    revisions.retain()
    await vi.waitFor(() => expect(streamCallbacks).toHaveLength(2))

    streamCallbacks[0]?.onSubscribed(4)
    streamCallbacks[1]?.onSubscribed(4)
    streamCallbacks[0]?.onRevision(event('ready', 4, 1, 2))
    revisions.beginRead(1)

    streamCallbacks[0]?.onRevision(event('invalidated', 5, 0, 0))
    streamCallbacks[0]?.onRevision(event('ready', 5, 0, 1))
    expect(revisions.finishRead(1, true)).toBe(false)
    revisions.beginRead(2)
    expect(revisions.finishRead(2, true)).toBe(false)
    expect(callbacks.onReady).toHaveBeenCalledTimes(1)

    streamCallbacks[0]?.onRevision(event('ready', 4, 9, 9))
    streamCallbacks[0]?.onRevision(event('invalidated', 4, 9, 9))
    streamCallbacks[1]?.onRevision(event('invalidated', 5, 0, 0))
    streamCallbacks[1]?.onRevision(event('ready', 6, 0, 1))
    expect(callbacks.onInvalidated).toHaveBeenCalledTimes(2)
    expect(callbacks.onReady).toHaveBeenCalledTimes(1)

    streamCallbacks[0]?.onRevision(event('ready', 5, 0, 2))
    revisions.beginRead(3)
    expect(revisions.finishRead(3, true)).toBe(true)
    expect(callbacks.onReady).toHaveBeenCalledTimes(2)

    revisions.close()
    expect(unsubscribes[0]).toHaveBeenCalledOnce()
    expect(unsubscribes[1]).toHaveBeenCalledOnce()
  })
})

function event(
  state: 'invalidated' | 'ready',
  incarnation: number,
  generation: number,
  revision: number
): GitRepositorySnapshotSubscriptionEvent {
  return { state, incarnation, generation, revision }
}
