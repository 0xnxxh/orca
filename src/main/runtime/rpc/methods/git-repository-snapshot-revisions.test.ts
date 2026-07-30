import { describe, expect, it, vi } from 'vitest'
import type { GitRepositorySnapshotSubscriptionEvent } from '../../../../shared/git-repository-snapshot'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { GIT_REPOSITORY_SNAPSHOT_REVISION_METHODS } from './git-repository-snapshot-revisions'

function request(params: unknown): RpcRequest {
  return {
    id: 'req-1',
    authToken: 'token',
    method: 'git.repositorySnapshotRevisions.subscribe',
    params
  }
}

describe('git repository snapshot revision RPC stream', () => {
  it('registers the exact identity, emits revisions, and cleans the owner subscription', async () => {
    let publish: ((event: GitRepositorySnapshotSubscriptionEvent) => void) | undefined
    const unsubscribeOwner = vi.fn()
    const cleanups = new Map<string, () => void | Promise<void>>()
    const runtime = {
      getRuntimeId: () => 'runtime-1',
      subscribeRuntimeGitRepositorySnapshotRevision: vi.fn(
        async (_worktree, _options, _pushTarget, listener) => {
          publish = listener
          return { incarnation: 7, unsubscribe: unsubscribeOwner }
        }
      ),
      registerSubscriptionCleanup: vi.fn((id, cleanup) => cleanups.set(id, cleanup)),
      cleanupSubscription: vi.fn((id) => {
        void cleanups.get(id)?.()
      }),
      cleanupSubscriptionAndWait: vi.fn(async (id) => {
        await cleanups.get(id)?.()
        cleanups.delete(id)
      })
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({
      runtime,
      methods: GIT_REPOSITORY_SNAPSHOT_REVISION_METHODS
    })
    const responses: { result?: unknown }[] = []

    const stream = dispatcher.dispatchStreaming(
      request({
        worktree: 'id:wt-1',
        reuseLineStats: true,
        pushTarget: {
          remoteName: 'fork',
          branchName: 'feature/checks',
          remoteUrl: 'ssh://git.example/repo',
          remoteCreated: false
        }
      }),
      (response) => responses.push(JSON.parse(response)),
      { connectionId: 'client-1' }
    )
    await vi.waitFor(() =>
      expect(
        responses.some(
          (response) => (response.result as { type?: string } | undefined)?.type === 'subscribed'
        )
      ).toBe(true)
    )
    publish?.({ state: 'ready', generation: 2, revision: 11, incarnation: 7 })
    const cleanup = [...cleanups.values()][0]
    await cleanup?.()
    await stream

    expect(runtime.subscribeRuntimeGitRepositorySnapshotRevision).toHaveBeenCalledWith(
      'id:wt-1',
      { reuseLineStats: true },
      {
        remoteName: 'fork',
        branchName: 'feature/checks',
        remoteUrl: 'ssh://git.example/repo',
        remoteCreated: false
      },
      expect.any(Function)
    )
    expect(responses.map((response) => response.result)).toEqual([
      expect.objectContaining({ type: 'subscribed', incarnation: 7 }),
      {
        type: 'revision',
        event: { state: 'ready', generation: 2, revision: 11, incarnation: 7 }
      },
      { type: 'end' }
    ])
    expect(unsubscribeOwner).toHaveBeenCalledOnce()
  })

  it('rejects malformed push targets before registering a stream', async () => {
    const runtime = {
      getRuntimeId: () => 'runtime-1',
      subscribeRuntimeGitRepositorySnapshotRevision: vi.fn()
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({
      runtime,
      methods: GIT_REPOSITORY_SNAPSHOT_REVISION_METHODS
    })
    const responses: { ok?: boolean; error?: { code?: string } }[] = []

    await dispatcher.dispatchStreaming(
      request({ worktree: 'id:wt-1', pushTarget: { remoteName: 'origin' } }),
      (response) => responses.push(JSON.parse(response))
    )

    expect(responses).toEqual([
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'invalid_argument' })
      })
    ])
    expect(runtime.subscribeRuntimeGitRepositorySnapshotRevision).not.toHaveBeenCalled()
  })

  it('cleans a subscription whose transport closes before owner setup resolves', async () => {
    let resolveSetup:
      | ((value: { incarnation: number; unsubscribe: () => void }) => void)
      | undefined
    const unsubscribeOwner = vi.fn()
    const setup = new Promise<{ incarnation: number; unsubscribe: () => void }>((resolve) => {
      resolveSetup = resolve
    })
    const cleanups = new Map<string, () => void | Promise<void>>()
    const runtime = {
      getRuntimeId: () => 'runtime-1',
      subscribeRuntimeGitRepositorySnapshotRevision: vi.fn(() => setup),
      registerSubscriptionCleanup: vi.fn((id, cleanup) => cleanups.set(id, cleanup)),
      cleanupSubscription: vi.fn((id) => {
        void cleanups.get(id)?.()
      }),
      cleanupSubscriptionAndWait: vi.fn(async (id) => {
        await cleanups.get(id)?.()
      })
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({
      runtime,
      methods: GIT_REPOSITORY_SNAPSHOT_REVISION_METHODS
    })
    const controller = new AbortController()
    const responses: { result?: { type?: string } }[] = []

    const stream = dispatcher.dispatchStreaming(
      request({ worktree: 'id:wt-1' }),
      (response) => responses.push(JSON.parse(response)),
      { connectionId: 'client-1', signal: controller.signal }
    )
    await vi.waitFor(() => expect(cleanups.size).toBe(1))
    controller.abort()
    resolveSetup?.({ incarnation: 1, unsubscribe: unsubscribeOwner })
    await stream

    expect(unsubscribeOwner).toHaveBeenCalledOnce()
    expect(responses.map((response) => response.result?.type)).toEqual(['end'])
  })
})
