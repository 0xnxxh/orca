import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getChecksPanelRepositorySnapshot } from './checks-panel-repository-snapshot-client'

const mocks = vi.hoisted(() => ({
  getDesktopGitRepositorySnapshot: vi.fn(),
  callRuntimeRpc: vi.fn()
}))

vi.mock('@/runtime/desktop-git-repository-snapshot-client', () => ({
  getDesktopGitRepositorySnapshot: mocks.getDesktopGitRepositorySnapshot
}))

vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: mocks.callRuntimeRpc,
  getActiveRuntimeTarget: (
    settings: { activeRuntimeEnvironmentId?: string | null } | null | undefined
  ) =>
    settings?.activeRuntimeEnvironmentId
      ? { kind: 'environment', environmentId: settings.activeRuntimeEnvironmentId }
      : { kind: 'local' }
}))

vi.mock('@/runtime/runtime-worktree-selector', () => ({
  toRuntimeWorktreeSelector: (worktreeId: string) => `id:${worktreeId}`
}))

describe('getChecksPanelRepositorySnapshot', () => {
  beforeEach(() => {
    mocks.getDesktopGitRepositorySnapshot.mockReset()
    mocks.callRuntimeRpc.mockReset()
  })

  it('keeps local and folder-workspace snapshot routing on the desktop host', async () => {
    const context = {
      settings: { activeRuntimeEnvironmentId: null },
      worktreeId: 'folder-repo::/repo::workspace:123e4567-e89b-12d3-a456-426614174000',
      worktreePath: '/repo::workspace:123e4567-e89b-12d3-a456-426614174000',
      connectionId: 'conn-1'
    }
    mocks.getDesktopGitRepositorySnapshot.mockResolvedValue(null)

    await expect(
      getChecksPanelRepositorySnapshot(context, { reuseLineStats: true })
    ).resolves.toBeNull()

    expect(mocks.getDesktopGitRepositorySnapshot).toHaveBeenCalledWith(context, {
      reuseLineStats: true
    })
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
  })

  it('queries an active runtime with exact selector, status identity, and push target', async () => {
    const context = {
      settings: { activeRuntimeEnvironmentId: 'env-1' },
      worktreeId: 'wt-1',
      worktreePath: '/runtime/repo',
      connectionId: 'desktop-connection-is-not-the-runtime-owner'
    }
    const pushTarget = {
      remoteName: 'fork',
      branchName: 'feature/checks',
      remoteUrl: 'ssh://git.example/repo',
      remoteCreated: false
    }
    mocks.callRuntimeRpc.mockResolvedValue(null)

    await expect(
      getChecksPanelRepositorySnapshot(context, {
        includeIgnored: true,
        bypassEffectiveUpstreamNegativeCache: true,
        reuseLineStats: true,
        pushTarget
      })
    ).resolves.toBeNull()

    expect(mocks.callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'env-1' },
      'git.repositorySnapshot',
      {
        worktree: 'id:wt-1',
        includeIgnored: true,
        bypassEffectiveUpstreamNegativeCache: true,
        reuseLineStats: true,
        pushTarget
      },
      { timeoutMs: 15_000 }
    )
    expect(mocks.getDesktopGitRepositorySnapshot).not.toHaveBeenCalled()
  })

  it.each(['method_not_found', 'disconnected', 'query_failed'])(
    'returns null for a %s runtime query so Checks can run its fresh fallback',
    async (message) => {
      mocks.callRuntimeRpc.mockRejectedValue(new Error(message))

      await expect(
        getChecksPanelRepositorySnapshot({
          settings: { activeRuntimeEnvironmentId: 'env-old' },
          worktreeId: 'wt-1',
          worktreePath: '/runtime/repo'
        })
      ).resolves.toBeNull()
    }
  )

  it('does not send false status options as a different owner identity', async () => {
    mocks.callRuntimeRpc.mockResolvedValue(null)

    await getChecksPanelRepositorySnapshot(
      {
        settings: { activeRuntimeEnvironmentId: 'env-1' },
        worktreeId: 'wt-1',
        worktreePath: '/runtime/repo'
      },
      {
        includeIgnored: false,
        bypassEffectiveUpstreamNegativeCache: false,
        reuseLineStats: false
      }
    )

    expect(mocks.callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'env-1' },
      'git.repositorySnapshot',
      { worktree: 'id:wt-1' },
      { timeoutMs: 15_000 }
    )
  })
})
