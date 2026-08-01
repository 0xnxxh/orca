import { describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import { makePaneKey } from '../../shared/stable-pane-id'
import type { FolderWorkspace, ProjectGroup, WorkspaceSessionState } from '../../shared/types'
import { OrcaRuntimeService } from './orca-runtime'

const electronMocks = vi.hoisted(() => {
  const ipcMain = {
    on: vi.fn(() => ipcMain),
    removeListener: vi.fn(() => ipcMain),
    emit: vi.fn(() => true)
  }
  return {
    app: { getPath: vi.fn(() => '/tmp'), isPackaged: false },
    BrowserWindow: { fromId: vi.fn(() => ({ isDestroyed: () => false })) },
    ipcMain,
    Notification: vi.fn(),
    webContents: { fromId: vi.fn(() => null) }
  }
})

vi.mock('electron', () => electronMocks)

const TAB_ID = '11111111-1111-4111-8111-111111111111'
const LEAF_ID = '22222222-2222-4222-8222-222222222222'

function makeSession(worktreeId: string): WorkspaceSessionState {
  const ptyId = `${worktreeId}@@race-pty`
  return {
    ...getDefaultWorkspaceSession(),
    activeWorktreeId: worktreeId,
    activeTabId: TAB_ID,
    activeTabIdByWorktree: { [worktreeId]: TAB_ID },
    tabsByWorktree: {
      [worktreeId]: [
        {
          id: TAB_ID,
          ptyId,
          worktreeId,
          title: 'Persisted terminal',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1
        }
      ]
    },
    terminalLayoutsByTabId: {
      [TAB_ID]: {
        root: { type: 'leaf', leafId: LEAF_ID },
        activeLeafId: LEAF_ID,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF_ID]: ptyId }
      }
    },
    terminalPtyIncarnationsByPaneKey: {
      [makePaneKey(TAB_ID, LEAF_ID)]: '33333333-3333-4333-8333-333333333333'
    }
  }
}

function createRuntime(folders: FolderWorkspace[], group: ProjectGroup): OrcaRuntimeService {
  const session = makeSession(`folder:${folders[0]!.id}`)
  return new OrcaRuntimeService({
    getRepo: () => undefined,
    getRepos: () => [],
    getFolderWorkspaces: () => folders,
    getProjectGroups: () => [group],
    getWorkspaceSession: () => session,
    getWorkspaceSessionHostIds: () => ['local'],
    addRepo: () => {},
    updateRepo: () => undefined as never,
    getAllWorktreeMeta: () => ({}),
    getWorktreeMeta: () => undefined,
    getGitHubCache: () => ({ pr: {}, issue: {} }),
    setWorktreeMeta: () => undefined as never,
    removeWorktreeMeta: () => {},
    getSettings: () => ({
      workspaceDir: '/workspace',
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      branchPrefix: 'none',
      branchPrefixCustom: ''
    })
  } as never)
}

describe('mobile folder session mutation races', () => {
  it.each(['activate', 'close'] as const)(
    'rejects a folder tab %s when deletion races PTY inventory',
    async (operation) => {
      const folder: FolderWorkspace = {
        id: `${operation}-race-folder`,
        projectGroupId: `${operation}-race-group`,
        name: `${operation} race`,
        folderPath: `/workspace/${operation}-race`,
        connectionId: null,
        linkedTask: null,
        comment: '',
        isArchived: false,
        isUnread: false,
        isPinned: false,
        sortOrder: 0,
        lastActivityAt: 1,
        createdAt: 1,
        updatedAt: 1
      }
      const group: ProjectGroup = {
        id: folder.projectGroupId,
        name: folder.projectGroupId,
        parentPath: folder.folderPath,
        connectionId: null,
        parentGroupId: null,
        createdFrom: 'manual',
        tabOrder: 0,
        isCollapsed: false,
        color: null,
        createdAt: 1,
        updatedAt: 1
      }
      const folderKey = `folder:${folder.id}`
      const folders = [folder]
      const runtime = createRuntime(folders, group)
      await runtime.listMobileSessionTabs(`id:${folderKey}`)
      let releaseInventory!: (value: []) => void
      const inventory = new Promise<[]>((resolve) => {
        releaseInventory = resolve
      })
      const listProcesses = vi.fn(() => inventory)
      runtime.setPtyController({
        write: () => true,
        kill: () => true,
        getForegroundProcess: async () => null,
        listProcesses
      })

      const mutation =
        operation === 'activate'
          ? runtime.activateMobileSessionTab(`id:${folderKey}`, TAB_ID)
          : runtime.closeMobileSessionTab(`id:${folderKey}`, TAB_ID)
      await vi.waitFor(() => expect(listProcesses).toHaveBeenCalledOnce())
      folders.length = 0
      releaseInventory([])

      await expect(mutation).rejects.toThrow('tab_not_found')
      await expect(runtime.listMobileSessionTabs(`id:${folderKey}`)).resolves.toMatchObject({
        worktree: folderKey,
        removed: true,
        tabs: []
      })
    }
  )
})
