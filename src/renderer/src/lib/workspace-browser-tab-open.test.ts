import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toRuntimeExecutionHostId, toSshExecutionHostId } from '../../../shared/execution-host'
import { openWorkspaceBrowserTab } from './workspace-browser-tab-open'

const mocks = vi.hoisted(() => ({
  createRemote: vi.fn(),
  getState: vi.fn(),
  state: {} as Record<string, unknown>
}))

vi.mock('@/store', () => ({
  useAppStore: { getState: () => mocks.getState() }
}))

vi.mock('@/runtime/web-runtime-session', () => ({
  createWebRuntimeSessionBrowserTab: (...args: unknown[]) => mocks.createRemote(...args)
}))

const WORKSPACE_ID = 'repo-1::/repo/worktree'

function ownerState(hostId?: string, runtimeOwnerEnvironmentId?: string): Record<string, unknown> {
  return {
    worktreesByRepo: {
      'repo-1': [
        {
          id: WORKSPACE_ID,
          repoId: 'repo-1',
          ...(hostId ? { hostId } : {}),
          ...(runtimeOwnerEnvironmentId ? { runtimeOwnerEnvironmentId } : {})
        }
      ]
    }
  }
}

beforeEach(() => {
  mocks.createRemote.mockReset().mockResolvedValue(true)
  mocks.getState.mockReset().mockImplementation(() => mocks.state)
  mocks.state = {}
})

describe('openWorkspaceBrowserTab', () => {
  it('opens client-owned searches with a safe title and host-specific profile', async () => {
    const createBrowserTab = vi.fn()
    const sshHost = toSshExecutionHostId('ssh-target')
    mocks.state = {
      ...ownerState(sshHost),
      createBrowserTab,
      defaultBrowserSessionProfileId: 'focused-profile',
      defaultBrowserSessionProfileIdByHostId: { [sshHost]: 'ssh-profile' }
    }

    await openWorkspaceBrowserTab({
      workspaceId: WORKSPACE_ID,
      targetGroupId: 'group-1',
      url: 'https://www.google.com/search?q=private%20query',
      intent: { kind: 'search', engine: 'google' }
    })

    expect(createBrowserTab).toHaveBeenCalledWith(
      WORKSPACE_ID,
      'https://www.google.com/search?q=private%20query',
      {
        activate: true,
        browserRuntimeEnvironmentId: null,
        focusAddressBar: false,
        sessionProfileId: 'ssh-profile',
        targetGroupId: 'group-1',
        title: 'Search Google'
      }
    )
    expect(mocks.createRemote).not.toHaveBeenCalled()
  })

  it('opens runtime-owned URLs without local fallback or workspace selection', async () => {
    const createBrowserTab = vi.fn()
    mocks.state = {
      ...ownerState(toRuntimeExecutionHostId('hub-a')),
      createBrowserTab,
      defaultBrowserSessionProfileId: 'client-profile',
      defaultBrowserSessionProfileIdByHostId: {}
    }

    await openWorkspaceBrowserTab({
      workspaceId: WORKSPACE_ID,
      url: 'https://example.com/',
      intent: { kind: 'url' }
    })

    expect(mocks.createRemote).toHaveBeenCalledWith({
      worktreeId: WORKSPACE_ID,
      environmentId: 'hub-a',
      url: 'https://example.com/',
      targetGroupId: undefined,
      selectWorktree: false,
      stagedTitle: 'Open URL',
      stagedFocusAddressBar: false,
      failureLogMode: 'operation-only'
    })
    expect(createBrowserTab).not.toHaveBeenCalled()
  })

  it('fails closed for invalid targets and unresolved owners, then falls back locally', async () => {
    const secretUrl = 'https://example.com/?q=secret-value'
    const request = {
      workspaceId: WORKSPACE_ID,
      url: secretUrl,
      intent: { kind: 'search' as const, engine: 'kagi' as const }
    }
    mocks.state = {}
    await expect(
      openWorkspaceBrowserTab({
        workspaceId: WORKSPACE_ID,
        url: 'file:///secret',
        intent: { kind: 'url' }
      })
    ).rejects.toThrow('Unable to open URL.')
    expect(mocks.getState).not.toHaveBeenCalled()

    await expect(openWorkspaceBrowserTab(request)).rejects.toThrow('Unable to search with Kagi.')
    expect(mocks.createRemote).not.toHaveBeenCalled()

    for (const state of [
      ownerState('not-a-host', 'hub-a'),
      ownerState(toRuntimeExecutionHostId('hub-b'), 'hub-a')
    ]) {
      mocks.state = state
      await expect(openWorkspaceBrowserTab(request)).rejects.toThrow('Unable to search with Kagi.')
    }

    mocks.state = {
      ...ownerState(toRuntimeExecutionHostId('hub-a')),
      createBrowserTab: vi.fn(),
      defaultBrowserSessionProfileId: 'focused-profile',
      defaultBrowserSessionProfileIdByHostId: { local: 'local-profile' }
    }
    mocks.createRemote.mockResolvedValue(false)
    await openWorkspaceBrowserTab(request)
    expect(mocks.state.createBrowserTab).toHaveBeenCalledWith(WORKSPACE_ID, secretUrl, {
      activate: true,
      browserRuntimeEnvironmentId: null,
      focusAddressBar: false,
      sessionProfileId: 'local-profile',
      targetGroupId: undefined,
      title: 'Search Kagi'
    })
  })
})
