import { describe, expect, it, vi } from 'vitest'
import { createTestStore, makeWorktree } from './store-test-helpers'
import {
  ephemeralVmCleanup,
  ephemeralVmListRuntimes,
  installReposRuntimeRoutingHarness,
  remoteRepo,
  runtimeEnvironmentCall
} from './repos-runtime-routing-fixture'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }
}))

installReposRuntimeRoutingHarness()

describe('provisioned-root project cleanup', () => {
  it('destroys the Orca-server runtime after removing its main checkout project', async () => {
    runtimeEnvironmentCall.mockResolvedValue({
      id: 'rpc-remove-provisioned-root',
      ok: true,
      result: { removed: true },
      _meta: { runtimeId: 'runtime-remote' }
    })
    const worktreeId = `${remoteRepo.id}::${remoteRepo.path}`
    ephemeralVmListRuntimes.mockResolvedValue([
      {
        id: 'recipe-runtime-1',
        recipeId: 'cloud-sandbox',
        workspaceId: worktreeId,
        status: 'running',
        cleanupStatus: 'not_started'
      }
    ])
    const store = createTestStore()
    store.setState({
      settings: { activeRuntimeEnvironmentId: 'env-1' } as never,
      repos: [remoteRepo],
      worktreesByRepo: {
        [remoteRepo.id]: [
          makeWorktree({
            id: worktreeId,
            repoId: remoteRepo.id,
            path: remoteRepo.path,
            isMainWorktree: true
          })
        ]
      }
    })

    await store.getState().removeProject(remoteRepo.id)

    expect(ephemeralVmCleanup).toHaveBeenCalledWith({ runtimeId: 'recipe-runtime-1' })
    expect(runtimeEnvironmentCall).toHaveBeenCalledWith({
      selector: 'env-1',
      method: 'repo.rm',
      params: { repo: remoteRepo.id },
      timeoutMs: 15_000
    })
    expect(runtimeEnvironmentCall.mock.invocationCallOrder[0]).toBeLessThan(
      ephemeralVmCleanup.mock.invocationCallOrder[0]!
    )
  })
})
