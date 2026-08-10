import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import {
  getAllWorktreesFromState,
  getRepoMapFromState,
  getWorktreeMapFromState,
  selectRepoByIdForActiveWorkspace
} from '@/store/selectors'
import type { Worktree } from '../../../../shared/types'

const EMPTY_TABS_BY_WORKTREE: AppState['tabsByWorktree'] = {}
const EMPTY_PTY_IDS_BY_TAB_ID: AppState['ptyIdsByTabId'] = {}
const EMPTY_BROWSER_TABS_BY_WORKTREE: AppState['browserTabsByWorktree'] = {}
const EMPTY_DELETE_STATE_BY_WORKTREE_ID: AppState['deleteStateByWorktreeId'] = {}
const EMPTY_WORKTREE_LINEAGE_BY_ID: AppState['worktreeLineageById'] = {}
const EMPTY_WORKSPACE_LINEAGE_BY_CHILD_KEY: AppState['workspaceLineageByChildKey'] = {}

export function selectMenuScopedMap<T>(menuOpen: boolean, live: T, empty: T): T {
  return menuOpen ? live : empty
}

export function useWorktreeContextMenuStoreSelection(worktree: Worktree, menuOpen: boolean) {
  return useAppStore(
    useShallow((state) => ({
      updateWorktreeMeta: state.updateWorktreeMeta,
      setWorktreesPinnedAndReveal: state.setWorktreesPinnedAndReveal,
      workspaceStatuses: state.workspaceStatuses,
      openModal: state.openModal,
      projectGroups: state.projectGroups,
      createProjectGroup: state.createProjectGroup,
      moveProjectToGroup: state.moveProjectToGroup,
      deleteFolderWorkspace: state.deleteFolderWorkspace,
      setActiveWorktree: state.setActiveWorktree,
      repo: selectRepoByIdForActiveWorkspace(state, worktree.repoId),
      deleteState: state.deleteStateByWorktreeId[worktree.id],
      repoMap: getRepoMapFromState(state),
      worktreeMap: getWorktreeMapFromState(state),
      allWorktrees: getAllWorktreesFromState(state),
      worktreeLineageById: selectMenuScopedMap(
        menuOpen,
        state.worktreeLineageById,
        EMPTY_WORKTREE_LINEAGE_BY_ID
      ),
      workspaceLineageByChildKey: selectMenuScopedMap(
        menuOpen,
        state.workspaceLineageByChildKey,
        EMPTY_WORKSPACE_LINEAGE_BY_CHILD_KEY
      ),
      updateWorktreeLineage: state.updateWorktreeLineage,
      tabsByWorktree: selectMenuScopedMap(menuOpen, state.tabsByWorktree, EMPTY_TABS_BY_WORKTREE),
      ptyIdsByTabId: selectMenuScopedMap(menuOpen, state.ptyIdsByTabId, EMPTY_PTY_IDS_BY_TAB_ID),
      browserTabsByWorktree: selectMenuScopedMap(
        menuOpen,
        state.browserTabsByWorktree,
        EMPTY_BROWSER_TABS_BY_WORKTREE
      ),
      deleteStateByWorktreeId: selectMenuScopedMap(
        menuOpen,
        state.deleteStateByWorktreeId,
        EMPTY_DELETE_STATE_BY_WORKTREE_ID
      )
    }))
  )
}
