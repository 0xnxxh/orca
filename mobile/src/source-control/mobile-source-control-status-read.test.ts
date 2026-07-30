import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import {
  isMobileSourceControlStatusLoadContextCurrent,
  readMobileSourceControlStatus,
  type MobileSourceControlStatusLoadContext
} from './mobile-source-control-status-read'

function ok(result: unknown): RpcResponse {
  return { id: 'r', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function failure(code: string, message: string): RpcResponse {
  return { id: 'r', ok: false, error: { code, message }, _meta: { runtimeId: 'runtime-1' } }
}

function repositorySnapshot() {
  const freshness = {
    state: 'fresh',
    generation: 2,
    currentGeneration: 2,
    revision: 5,
    identity: 'default-status'
  }
  return {
    repositoryIdentity: { head: 'abc', branch: 'feature/mobile' },
    status: {
      entries: [{ path: 'app.ts', status: 'modified', area: 'unstaged' }],
      retentionTruncated: false
    },
    conflicts: 'unknown',
    upstream: { hasUpstream: true, upstreamName: 'origin/main', ahead: 1, behind: 0 },
    freshness: {
      repositoryIdentity: { ...freshness },
      status: { ...freshness },
      conflicts: { ...freshness },
      upstream: { ...freshness, identity: 'status:default-status' }
    }
  }
}

function clientWith(responses: RpcResponse[]) {
  const sendRequest = vi.fn(async (): Promise<RpcResponse> => {
    const response = responses.shift()
    if (!response) {
      throw new Error('Unexpected RPC')
    }
    return response
  })
  return { client: { sendRequest } as unknown as RpcClient, sendRequest }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('readMobileSourceControlStatus', () => {
  it('uses an admissible repository snapshot without status work', async () => {
    const { client, sendRequest } = clientWith([ok(repositorySnapshot())])

    const result = await readMobileSourceControlStatus({
      client,
      worktreeId: 'repo::wt',
      preferRepositorySnapshot: true,
      isCurrent: () => true
    })

    expect(result).toMatchObject({ kind: 'ready', status: { head: 'abc' } })
    expect(sendRequest).toHaveBeenCalledOnce()
    expect(sendRequest).toHaveBeenCalledWith('git.repositorySnapshot', {
      worktree: 'id:repo::wt'
    })
  })

  it.each([
    ['old runtime', failure('method_not_found', 'Unknown method')],
    ['missing snapshot', ok(null)],
    ['malformed snapshot', ok({ nope: true })],
    [
      'stale snapshot',
      (() => {
        const value = repositorySnapshot()
        value.freshness.upstream.state = 'stale'
        return ok(value)
      })()
    ],
    [
      'truncated snapshot',
      (() => {
        const value = repositorySnapshot()
        value.status.retentionTruncated = true
        return ok(value)
      })()
    ],
    [
      'status-identity mismatch',
      (() => {
        const value = repositorySnapshot()
        value.freshness.conflicts.identity = 'other-status'
        return ok(value)
      })()
    ]
  ])('falls back to fresh status for %s', async (_label, snapshotResponse) => {
    const { client, sendRequest } = clientWith([
      snapshotResponse,
      ok({
        entries: [],
        conflictOperation: 'unknown',
        upstreamStatus: { hasUpstream: false, ahead: 0, behind: 0 }
      })
    ])

    const result = await readMobileSourceControlStatus({
      client,
      worktreeId: 'repo::wt',
      preferRepositorySnapshot: true,
      isCurrent: () => true
    })

    expect(result.kind).toBe('ready')
    expect(sendRequest.mock.calls.map(([method]) => method)).toEqual([
      'git.repositorySnapshot',
      'git.status'
    ])
  })

  it('preserves selector retries on the fresh fallback', async () => {
    vi.useFakeTimers()
    const { client, sendRequest } = clientWith([
      ok(null),
      failure('selector_not_found', 'Not ready'),
      ok({
        entries: [],
        conflictOperation: 'unknown',
        upstreamStatus: { hasUpstream: false, ahead: 0, behind: 0 }
      })
    ])

    const pending = readMobileSourceControlStatus({
      client,
      worktreeId: 'repo::wt',
      preferRepositorySnapshot: true,
      isCurrent: () => true
    })
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toMatchObject({ kind: 'ready' })
    expect(sendRequest).toHaveBeenCalledTimes(3)
  })

  it('falls back when the best-effort snapshot query rejects', async () => {
    const sendRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error('disconnected'))
      .mockResolvedValueOnce(
        ok({
          entries: [],
          conflictOperation: 'unknown',
          upstreamStatus: { hasUpstream: false, ahead: 0, behind: 0 }
        })
      )

    await expect(
      readMobileSourceControlStatus({
        client: { sendRequest } as unknown as RpcClient,
        worktreeId: 'repo::wt',
        preferRepositorySnapshot: true,
        isCurrent: () => true
      })
    ).resolves.toMatchObject({ kind: 'ready' })
    expect(sendRequest.mock.calls.map(([method]) => method)).toEqual([
      'git.repositorySnapshot',
      'git.status'
    ])
  })

  it('preserves the fresh status unavailable result after a rejected snapshot', async () => {
    const { client } = clientWith([
      ok(null),
      failure('method_not_found', 'Update Orca desktop to use Source Control on mobile.')
    ])

    await expect(
      readMobileSourceControlStatus({
        client,
        worktreeId: 'repo::wt',
        preferRepositorySnapshot: true,
        isCurrent: () => true
      })
    ).resolves.toEqual({ kind: 'unavailable' })
  })

  it('does not launch fallback status after a late snapshot loses liveness', async () => {
    let resolveSnapshot!: (response: RpcResponse) => void
    let current = true
    const sendRequest = vi.fn(
      () =>
        new Promise<RpcResponse>((resolve) => {
          resolveSnapshot = resolve
        })
    )
    const pending = readMobileSourceControlStatus({
      client: { sendRequest } as unknown as RpcClient,
      worktreeId: 'repo::wt',
      preferRepositorySnapshot: true,
      isCurrent: () => current
    })

    current = false
    resolveSnapshot(ok(repositorySnapshot()))

    await expect(pending).resolves.toEqual({ kind: 'cancelled' })
    expect(sendRequest).toHaveBeenCalledOnce()
  })

  it.each([
    [
      'same-identity client replacement',
      (captured: MobileSourceControlStatusLoadContext) => ({
        ...captured,
        client: { sendRequest: vi.fn() } as unknown as RpcClient
      })
    ],
    [
      'disconnection',
      (captured: MobileSourceControlStatusLoadContext) => ({
        ...captured,
        connState: 'disconnected' as const
      })
    ]
  ])('suppresses a pending snapshot after render-current %s', async (_label, replaceContext) => {
    let resolveSnapshot!: (response: RpcResponse) => void
    const sendRequest = vi.fn(
      () =>
        new Promise<RpcResponse>((resolve) => {
          resolveSnapshot = resolve
        })
    )
    const captured: MobileSourceControlStatusLoadContext = {
      client: { sendRequest } as unknown as RpcClient,
      connState: 'connected',
      statusIdentityKey: 'host-1\0wt-1'
    }
    let current = captured
    const pending = readMobileSourceControlStatus({
      client: captured.client!,
      worktreeId: 'wt-1',
      preferRepositorySnapshot: true,
      isCurrent: () => isMobileSourceControlStatusLoadContextCurrent(captured, current)
    })

    current = replaceContext(captured)
    resolveSnapshot(ok(repositorySnapshot()))

    await expect(pending).resolves.toEqual({ kind: 'cancelled' })
    expect(sendRequest).toHaveBeenCalledOnce()
  })
})
