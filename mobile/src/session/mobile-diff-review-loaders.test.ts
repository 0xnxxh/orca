import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { loadMobileDiffReviewSnapshot } from './mobile-diff-review-loaders'

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
    conflicts: null,
    freshness: {
      repositoryIdentity: { ...freshness },
      status: { ...freshness },
      conflicts: { ...freshness }
    }
  }
}

function clientWith(
  snapshotResponse: RpcResponse | Error,
  statusResponse: RpcResponse = ok({
    entries: [{ path: 'fresh.ts', status: 'modified', area: 'unstaged' }],
    conflictOperation: 'unknown',
    branch: 'feature/mobile',
    head: 'fresh'
  })
) {
  const sendRequest = vi.fn(async (method: string): Promise<RpcResponse> => {
    if (method === 'git.repositorySnapshot') {
      if (snapshotResponse instanceof Error) {
        throw snapshotResponse
      }
      return snapshotResponse
    }
    if (method === 'git.status') {
      return statusResponse
    }
    if (method === 'repo.list') {
      return ok({ repos: [] })
    }
    if (method === 'repo.baseRefDefault') {
      return ok({ defaultBaseRef: null })
    }
    if (method === 'worktree.show') {
      return ok({
        worktree: { baseRef: null, diffComments: [], mobileDiffReview: null }
      })
    }
    throw new Error(`Unexpected method: ${method}`)
  })
  return { client: { sendRequest } as unknown as RpcClient, sendRequest }
}

describe('loadMobileDiffReviewSnapshot', () => {
  it('uses an admissible initial projection without fresh status work', async () => {
    const { client, sendRequest } = clientWith(ok(repositorySnapshot()))

    const result = await loadMobileDiffReviewSnapshot(client, 'repo::wt', {
      preferRepositorySnapshot: true
    })

    expect(result.kind).toBe('ready')
    expect(sendRequest).toHaveBeenCalledWith('git.repositorySnapshot', {
      worktree: 'id:repo::wt'
    })
    expect(sendRequest.mock.calls.filter(([method]) => method === 'git.status')).toHaveLength(0)
  })

  it.each([
    ['old runtime', failure('method_not_found', 'Unknown method')],
    ['failed query', new Error('disconnected')],
    ['missing projection', ok(null)],
    ['malformed projection', ok({ nope: true })]
  ])('falls back to fresh status for %s', async (_label, snapshotResponse) => {
    const { client, sendRequest } = clientWith(snapshotResponse)

    const result = await loadMobileDiffReviewSnapshot(client, 'repo::wt', {
      preferRepositorySnapshot: true
    })

    expect(result.kind).toBe('ready')
    expect(sendRequest.mock.calls.filter(([method]) => method === 'git.status')).toHaveLength(1)
  })

  it.each([
    [
      'stale projection',
      (value: ReturnType<typeof repositorySnapshot>) => {
        value.freshness.status.state = 'stale'
      }
    ],
    [
      'truncated projection',
      (value: ReturnType<typeof repositorySnapshot>) => {
        value.status.retentionTruncated = true
      }
    ],
    [
      'identity-mismatched projection',
      (value: ReturnType<typeof repositorySnapshot>) => {
        value.freshness.conflicts.identity = 'other-status'
      }
    ]
  ])('falls back to fresh status for a %s', async (_label, mutate) => {
    const snapshot = repositorySnapshot()
    mutate(snapshot)
    const { client, sendRequest } = clientWith(ok(snapshot))

    const result = await loadMobileDiffReviewSnapshot(client, 'repo::wt', {
      preferRepositorySnapshot: true
    })

    expect(result.kind).toBe('ready')
    expect(sendRequest.mock.calls.filter(([method]) => method === 'git.status')).toHaveLength(1)
  })

  it('keeps non-initial loads fresh and preserves unavailable status copy', async () => {
    const unavailable = failure('method_not_found', 'Unknown method')
    const { client, sendRequest } = clientWith(ok(repositorySnapshot()), unavailable)

    await expect(loadMobileDiffReviewSnapshot(client, 'repo::wt')).resolves.toEqual({
      kind: 'unavailable',
      message: 'Update Orca desktop to review changes on mobile.'
    })
    expect(sendRequest).not.toHaveBeenCalledWith('git.repositorySnapshot', expect.anything())
  })
})
