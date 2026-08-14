import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { WORKTREE_METHODS } from './worktree'

function makeRuntime(): OrcaRuntimeService {
  return {
    getRuntimeId: () => 'test-runtime',
    removeManagedWorktree: vi.fn().mockResolvedValue({})
  } as unknown as OrcaRuntimeService
}

function makeRequest(params: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method: 'worktree.rm', params }
}

describe('worktree.rm host qualification', () => {
  it('routes an explicitly qualified removal to that host', async () => {
    const runtime = makeRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKTREE_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest({ worktree: 'id:wt-1', hostId: 'local', force: true, runHooks: false })
    )

    expect(runtime.removeManagedWorktree).toHaveBeenCalledWith(
      'id:wt-1',
      true,
      false,
      false,
      'local'
    )
    expect(response).toMatchObject({ ok: true, result: { removed: true } })
  })

  it('rejects an old-client removal with no host qualifier', async () => {
    const runtime = makeRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKTREE_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest({ worktree: 'id:wt-1', force: true, runHooks: false })
    )

    expect(response).toMatchObject({
      ok: false,
      error: { message: 'worktree.rm requires an explicit hostId' }
    })
    expect(runtime.removeManagedWorktree).not.toHaveBeenCalled()
  })
})
