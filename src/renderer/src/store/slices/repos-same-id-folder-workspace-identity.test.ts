import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FolderWorkspace, ProjectGroup } from '../../../../shared/types'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { createTestStore } from './store-test-helpers'

function makeGroup(overrides: Partial<ProjectGroup> = {}): ProjectGroup {
  return {
    id: overrides.id ?? 'same-group',
    name: overrides.name ?? 'Same Group',
    parentPath: overrides.parentPath ?? '/workspace',
    connectionId: overrides.connectionId ?? null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    ...(overrides.executionHostId ? { executionHostId: overrides.executionHostId } : {})
  }
}

function makeFolder(overrides: Partial<FolderWorkspace> = {}): FolderWorkspace {
  return {
    id: overrides.id ?? 'same-id',
    projectGroupId: overrides.projectGroupId ?? 'same-group',
    name: overrides.name ?? 'Workspace',
    folderPath: overrides.folderPath ?? '/workspace/folder',
    connectionId: overrides.connectionId ?? null,
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 1,
    lastActivityAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...(overrides.executionHostId ? { executionHostId: overrides.executionHostId } : {})
  }
}

describe('same-id cross-host folder workspace identity', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('deletes only the owner-qualified folder row and its session keys', async () => {
    const local = makeFolder({
      name: 'Local',
      folderPath: '/local/folder',
      connectionId: null,
      executionHostId: 'local'
    })
    const remote = makeFolder({
      name: 'Remote',
      folderPath: '/remote/folder',
      connectionId: null,
      executionHostId: 'runtime:env-1'
    })
    const store = createTestStore()
    const purgeWorktreeTerminalState = vi.fn()
    store.setState({
      projectGroups: [
        makeGroup({ executionHostId: 'local', parentPath: '/local' }),
        makeGroup({ executionHostId: 'runtime:env-1', parentPath: '/remote' })
      ],
      folderWorkspaces: [local, remote],
      folderWorkspacePathStatuses: {
        'local:folder-workspace:["local","same-id"]': {
          status: { path: '/local/folder', exists: true },
          checkedAt: 1,
          requestSnapshot: 'local'
        },
        'local:folder-workspace:["runtime:env-1","same-id"]': {
          status: { path: '/remote/folder', exists: true },
          checkedAt: 1,
          requestSnapshot: 'remote'
        }
      },
      purgeWorktreeTerminalState
    })

    const deleteFolderWorkspace = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('window', {
      api: {
        folderWorkspaces: {
          delete: deleteFolderWorkspace
        }
      }
    })

    await expect(
      store.getState().deleteFolderWorkspace('same-id', { ownerHostId: 'local' })
    ).resolves.toBe(true)

    const remaining = store.getState().folderWorkspaces
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.executionHostId).toBe('runtime:env-1')
    expect(deleteFolderWorkspace).toHaveBeenCalledWith({
      folderWorkspaceId: 'same-id',
      ownerHostId: 'local'
    })
    expect(purgeWorktreeTerminalState).not.toHaveBeenCalled()
    expect(Object.keys(store.getState().folderWorkspacePathStatuses)).toEqual([
      'local:folder-workspace:["runtime:env-1","same-id"]'
    ])
  })

  it('keeps path-status cache keys independent per owner for same folder id', () => {
    const store = createTestStore()
    const localKey = store
      .getState()
      .getFolderWorkspacePathStatusCacheKey(
        { scope: 'folder-workspace', folderWorkspaceId: 'same-id' },
        { ownerHostId: 'local' }
      )
    const remoteKey = store
      .getState()
      .getFolderWorkspacePathStatusCacheKey(
        { scope: 'folder-workspace', folderWorkspaceId: 'same-id' },
        { ownerHostId: 'runtime:env-1' }
      )
    expect(localKey).not.toBe(remoteKey)
    expect(localKey).toContain('["local","same-id"]')
    expect(remoteKey).toContain('["runtime:env-1","same-id"]')
  })

  it('keeps the legacy bare folder session identity on unambiguous activation', () => {
    const store = createTestStore()
    const bareKey = folderWorkspaceKey('folder-workspace-1')
    const folder = makeFolder({
      id: 'folder-workspace-1',
      projectGroupId: 'group-a',
      connectionId: null,
      executionHostId: 'local',
      folderPath: '/local/folder'
    })
    store.setState({
      projectGroups: [makeGroup({ id: 'group-a', executionHostId: 'local', parentPath: '/local' })],
      folderWorkspaces: [folder],
      // Why: reconnectable pty keeps the tab out of orphan cleanup during activation reconcile.
      tabsByWorktree: {
        [bareKey]: [
          {
            id: 'legacy-tab',
            ptyId: 'pty-legacy',
            worktreeId: bareKey,
            title: 'Legacy',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 1
          }
        ]
      },
      ptyIdsByTabId: { 'legacy-tab': ['pty-legacy'] },
      activeTabIdByWorktree: { [bareKey]: 'legacy-tab' }
    })

    store.getState().setActiveFolderWorkspace('folder-workspace-1', 'local')

    const state = store.getState()
    expect(state.activeWorkspaceKey).toBe(bareKey)
    expect(state.activeWorktreeId).toBe(bareKey)
    expect(state.tabsByWorktree[bareKey]?.[0]?.id).toBe('legacy-tab')
    expect(state.activeTabIdByWorktree[bareKey]).toBe('legacy-tab')
    expect(state.activeTabId).toBe('legacy-tab')
  })

  it('fails closed instead of owner-qualifying tabs for ambiguous folder ids', () => {
    const store = createTestStore()
    const bareKey = folderWorkspaceKey('same-id')
    store.setState({
      projectGroups: [
        makeGroup({ id: 'same-group', executionHostId: 'local', parentPath: '/local' }),
        makeGroup({ id: 'same-group', executionHostId: 'runtime:env-1', parentPath: '/remote' })
      ],
      folderWorkspaces: [
        makeFolder({
          id: 'same-id',
          name: 'Local',
          executionHostId: 'local',
          folderPath: '/local/folder'
        }),
        makeFolder({
          id: 'same-id',
          name: 'Remote',
          executionHostId: 'runtime:env-1',
          folderPath: '/remote/folder'
        })
      ],
      tabsByWorktree: {
        [bareKey]: [
          {
            id: 'legacy-tab',
            ptyId: 'pty-legacy',
            worktreeId: bareKey,
            title: 'Legacy',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 1
          }
        ]
      },
      ptyIdsByTabId: { 'legacy-tab': ['pty-legacy'] }
    })

    store.getState().setActiveFolderWorkspace('same-id', 'local')
    expect(store.getState().activeWorkspaceKey).toBeNull()
    expect(store.getState().activeWorktreeId).toBeNull()
    expect(store.getState().tabsByWorktree[bareKey]?.[0]?.id).toBe('legacy-tab')
  })

  it('forwards the selected folder owner through local update IPC', async () => {
    const local = makeFolder({ executionHostId: 'local' })
    const remote = makeFolder({ executionHostId: 'runtime:env-1' })
    const update = vi.fn().mockResolvedValue({ ...local, name: 'Updated' })
    const store = createTestStore()
    store.setState({
      projectGroups: [
        makeGroup({ executionHostId: 'local' }),
        makeGroup({ executionHostId: 'runtime:env-1' })
      ],
      folderWorkspaces: [local, remote]
    })
    vi.stubGlobal('window', { api: { folderWorkspaces: { update } } })

    await expect(
      store
        .getState()
        .updateFolderWorkspace('same-id', { name: 'Updated' }, { executionHostId: 'local' })
    ).resolves.toBe(true)
    expect(update).toHaveBeenCalledWith({
      folderWorkspaceId: 'same-id',
      ownerHostId: 'local',
      updates: { name: 'Updated' }
    })
  })

  it('reconciles a failed same-id update from the selected owner row', async () => {
    const local = makeFolder({ name: 'Local current', executionHostId: 'local' })
    const ssh = makeFolder({
      name: 'SSH current',
      folderPath: '/remote/folder',
      connectionId: 'builder'
    })
    const list = vi.fn().mockResolvedValue([
      { ...local, name: 'Local persisted' },
      { ...ssh, name: 'SSH persisted' }
    ])
    const update = vi.fn().mockResolvedValue(null)
    const store = createTestStore()
    store.setState({
      projectGroups: [
        makeGroup({ executionHostId: 'local' }),
        makeGroup({ connectionId: 'builder', parentPath: '/remote' })
      ],
      folderWorkspaces: [local, ssh]
    })
    vi.stubGlobal('window', { api: { folderWorkspaces: { list, update } } })

    await expect(
      store
        .getState()
        .updateFolderWorkspace('same-id', { name: 'Rejected' }, { executionHostId: 'ssh:builder' })
    ).resolves.toBe(false)

    expect(store.getState().folderWorkspaces.map((workspace) => workspace.name)).toEqual([
      'Local current',
      'SSH persisted'
    ])
  })
})
