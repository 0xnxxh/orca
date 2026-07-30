import { describe, expect, it, vi } from 'vitest'
import {
  getRuntimeGitRepositorySnapshotRevisionTargetKey,
  subscribeRuntimeGitRepositorySnapshotRevision
} from './runtime-git-repository-snapshot-revision-client'
import { replaceRuntimeEnvironmentRevisions } from './runtime-environment-revision'

const context = {
  settings: { activeRuntimeEnvironmentId: 'env-1' },
  worktreeId: 'repo-1::/repo/worktree',
  worktreePath: '/repo/worktree',
  connectionId: 'ssh-1'
}

describe('runtime Git repository snapshot revision client', () => {
  it('pins pairing revision and decodes the exact stream identity', async () => {
    replaceRuntimeEnvironmentRevisions([{ id: 'env-1', createdAt: 1, pairingRevision: 8 }])
    let callbacks:
      | {
          onResponse: (response: unknown) => void
          onError: (error: unknown) => void
          onClose: () => void
        }
      | undefined
    const unsubscribe = vi.fn()
    const subscribe = vi.fn(async (_args, nextCallbacks) => {
      callbacks = nextCallbacks
      return { unsubscribe, sendBinary: vi.fn() }
    })
    vi.stubGlobal('window', { api: { runtimeEnvironments: { subscribe } } })
    const handlers = {
      onSubscribed: vi.fn(),
      onRevision: vi.fn(),
      onUnavailable: vi.fn(),
      onReplay: vi.fn(),
      onEnd: vi.fn()
    }

    const handle = await subscribeRuntimeGitRepositorySnapshotRevision(
      context,
      {
        reuseLineStats: true,
        pushTarget: {
          remoteName: 'fork',
          branchName: 'feature/checks',
          remoteUrl: 'ssh://git.example/repo',
          remoteCreated: false
        }
      },
      handlers
    )

    expect(getRuntimeGitRepositorySnapshotRevisionTargetKey(context)).toBe(
      'env-1\u00008\u0000id:repo-1::/repo/worktree'
    )
    replaceRuntimeEnvironmentRevisions([{ id: 'env-1', createdAt: 1, pairingRevision: 9 }])
    expect(getRuntimeGitRepositorySnapshotRevisionTargetKey(context)).toBe(
      'env-1\u00009\u0000id:repo-1::/repo/worktree'
    )
    expect(subscribe).toHaveBeenCalledWith(
      {
        selector: 'env-1',
        method: 'git.repositorySnapshotRevisions.subscribe',
        params: {
          worktree: 'id:repo-1::/repo/worktree',
          reuseLineStats: true,
          pushTarget: {
            remoteName: 'fork',
            branchName: 'feature/checks',
            remoteUrl: 'ssh://git.example/repo',
            remoteCreated: false
          }
        },
        timeoutMs: 15_000,
        expectedEnvironmentPairingRevision: 8
      },
      expect.objectContaining({
        onResponse: expect.any(Function),
        onError: handlers.onUnavailable,
        onClose: handlers.onEnd
      })
    )
    callbacks?.onResponse({
      ok: true,
      result: { type: 'subscribed', subscriptionId: 'sub-1', incarnation: 3 }
    })
    callbacks?.onResponse({
      ok: true,
      result: {
        type: 'revision',
        event: { state: 'ready', generation: 4, revision: 12, incarnation: 3 }
      }
    })
    callbacks?.onResponse({ ok: true, result: { type: 'end' } })

    expect(handlers.onSubscribed).toHaveBeenCalledWith(3)
    expect(handlers.onRevision).toHaveBeenCalledWith({
      state: 'ready',
      generation: 4,
      revision: 12,
      incarnation: 3
    })
    expect(handlers.onEnd).toHaveBeenCalledOnce()
    handle?.unsubscribe()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('fails open for replay, method errors, and malformed events', async () => {
    let onResponse: ((response: unknown) => void) | undefined
    const subscribe = vi.fn(async (_args, callbacks) => {
      onResponse = callbacks.onResponse
      return { unsubscribe: vi.fn(), sendBinary: vi.fn() }
    })
    vi.stubGlobal('window', { api: { runtimeEnvironments: { subscribe } } })
    const handlers = {
      onSubscribed: vi.fn(),
      onRevision: vi.fn(),
      onUnavailable: vi.fn(),
      onReplay: vi.fn(),
      onEnd: vi.fn()
    }
    await subscribeRuntimeGitRepositorySnapshotRevision(context, {}, handlers)

    onResponse?.({
      ok: true,
      result: { type: 'subscribed', subscriptionId: 'sub-2', incarnation: 4 },
      _replayedAfterReconnect: true
    })
    onResponse?.({ ok: false, error: { code: 'method_not_found', message: 'missing' } })
    onResponse?.({
      ok: true,
      result: {
        type: 'revision',
        event: { state: 'ready', generation: -1, revision: 1, incarnation: 4 }
      }
    })

    expect(handlers.onReplay).toHaveBeenCalledOnce()
    expect(handlers.onSubscribed).toHaveBeenCalledWith(4)
    expect(handlers.onUnavailable).toHaveBeenCalledWith({
      code: 'method_not_found',
      message: 'missing'
    })
    expect(handlers.onUnavailable).toHaveBeenCalledTimes(2)
    expect(handlers.onRevision).not.toHaveBeenCalled()
  })

  it('does not subscribe for direct desktop ownership', async () => {
    vi.stubGlobal('window', {
      api: { runtimeEnvironments: { subscribe: vi.fn() } }
    })
    const handlers = {
      onSubscribed: vi.fn(),
      onRevision: vi.fn(),
      onUnavailable: vi.fn(),
      onReplay: vi.fn(),
      onEnd: vi.fn()
    }

    await expect(
      subscribeRuntimeGitRepositorySnapshotRevision(
        { ...context, settings: { activeRuntimeEnvironmentId: null } },
        {},
        handlers
      )
    ).resolves.toBeNull()
  })
})
