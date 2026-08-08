// Builds one worktree's tabs, browser pages and simulator tabs into the shapes
// the three Cmd+J engines search.

import type { Repo, Worktree } from '../../../../shared/types'
import { buildSearchableBrowserPages } from '@/lib/browser-palette-page-entries'
import type { SearchableBrowserPage } from '@/lib/browser-palette-search'
import {
  buildSearchableSimulatorTabs,
  type SearchableSimulatorTab
} from '@/lib/simulator-palette-search'
import {
  buildSearchableWorkspaceTabs,
  type SearchableWorkspaceTab
} from '@/lib/workspace-tab-palette-search'
import type { AppState } from '@/store/types'
import {
  getRepoExecutionHostId,
  getWorktreeExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  type ExecutionHostId
} from '../../../../shared/execution-host'

export type OpenTabSearchEntries = {
  workspaceTabs: readonly SearchableWorkspaceTab[]
  browserPages: readonly SearchableBrowserPage[]
  simulatorTabs: readonly SearchableSimulatorTab[]
}

export type OpenTabSearchEntryState = Pick<
  AppState,
  | 'activeBrowserTabId'
  | 'activeFileId'
  | 'activeFileIdByWorktree'
  | 'activeGroupIdByWorktree'
  | 'activeTabId'
  | 'activeTabIdByWorktree'
  | 'activeTabType'
  | 'activeTabTypeByWorktree'
  | 'activeWorktreeId'
  | 'browserPagesByWorkspace'
  | 'browserTabsByWorktree'
  | 'groupsByWorktree'
  | 'openFiles'
  | 'tabsByWorktree'
  | 'unifiedTabsByWorktree'
> & {
  executionHostId: ExecutionHostId
  generatedTitlesEnabled: boolean
  repo: Pick<Repo, 'connectionId' | 'displayName' | 'executionHostId' | 'id'> | null
  worktree: Worktree
}

export type OpenTabSearchAgentState = Pick<
  AppState,
  'agentStatusByPaneKey' | 'retainedAgentsByPaneKey' | 'sleepingAgentSessionsByPaneKey'
>

// No group id: every tab of the worktree is offered, including the one the
// column already shows, matching how Cmd+J lists the tab you are on.
export function selectOpenTabSearchEntryState(
  state: AppState,
  worktreeId: string
): OpenTabSearchEntryState | null {
  const preferredHostId =
    state.activeWorktreeId === worktreeId
      ? (state.activeWorkspaceExecutionHostId ?? LOCAL_EXECUTION_HOST_ID)
      : undefined
  // Why getKnownWorktreeById: folder workspaces are absent from worktreesByRepo.
  const worktree = state.getKnownWorktreeById(worktreeId, preferredHostId) ?? null
  if (!worktree) {
    return null
  }
  const repoCandidates = state.repos.filter((candidate) => candidate.id === worktree.repoId)
  const repo =
    (preferredHostId
      ? repoCandidates.find((candidate) => getRepoExecutionHostId(candidate) === preferredHostId)
      : undefined) ??
    repoCandidates[0] ??
    null
  const executionHostId = getWorktreeExecutionHostId(
    worktree,
    repo ?? undefined,
    preferredHostId ?? LOCAL_EXECUTION_HOST_ID
  )
  return {
    activeBrowserTabId: state.activeBrowserTabId,
    activeFileId: state.activeFileId,
    activeFileIdByWorktree: state.activeFileIdByWorktree,
    activeGroupIdByWorktree: state.activeGroupIdByWorktree,
    activeTabId: state.activeTabId,
    activeTabIdByWorktree: state.activeTabIdByWorktree,
    activeTabType: state.activeTabType,
    activeTabTypeByWorktree: state.activeTabTypeByWorktree,
    activeWorktreeId: state.activeWorktreeId,
    browserPagesByWorkspace: state.browserPagesByWorkspace,
    browserTabsByWorktree: state.browserTabsByWorktree,
    executionHostId,
    generatedTitlesEnabled: state.settings?.tabAutoGenerateTitle === true,
    groupsByWorktree: state.groupsByWorktree,
    openFiles: state.openFiles,
    repo,
    tabsByWorktree: state.tabsByWorktree,
    unifiedTabsByWorktree: state.unifiedTabsByWorktree,
    worktree
  }
}

export function selectOpenTabSearchAgentState(state: AppState): OpenTabSearchAgentState {
  return {
    agentStatusByPaneKey: state.agentStatusByPaneKey,
    retainedAgentsByPaneKey: state.retainedAgentsByPaneKey,
    sleepingAgentSessionsByPaneKey: state.sleepingAgentSessionsByPaneKey
  }
}

export function buildOpenTabSearchEntries(
  state: OpenTabSearchEntryState,
  agentState: OpenTabSearchAgentState
): OpenTabSearchEntries {
  const { repo, worktree } = state
  const scopedWorktree =
    worktree.hostId === state.executionHostId
      ? worktree
      : { ...worktree, hostId: state.executionHostId }
  const worktrees = [scopedWorktree]
  const scope = {
    worktrees,
    repoMap: new Map(repo ? [[repo.id, repo]] : []),
    worktreeOrder: new Map([[worktree.id, 0]])
  }

  return {
    workspaceTabs: buildSearchableWorkspaceTabs({
      ...scope,
      unifiedTabsByWorktree: state.unifiedTabsByWorktree,
      tabsByWorktree: state.tabsByWorktree,
      openFiles: state.openFiles,
      agentStatusByPaneKey: agentState.agentStatusByPaneKey,
      retainedAgentsByPaneKey: agentState.retainedAgentsByPaneKey,
      sleepingAgentSessionsByPaneKey: agentState.sleepingAgentSessionsByPaneKey,
      activeGroupIdByWorktree: state.activeGroupIdByWorktree,
      groupsByWorktree: state.groupsByWorktree,
      activeWorktreeId: state.activeWorktreeId,
      activeTabType: state.activeTabType,
      activeTabId: state.activeTabId,
      activeTabIdByWorktree: state.activeTabIdByWorktree,
      activeFileId: state.activeFileId,
      activeFileIdByWorktree: state.activeFileIdByWorktree,
      activeTabTypeByWorktree: state.activeTabTypeByWorktree,
      generatedTitlesEnabled: state.generatedTitlesEnabled
    }),
    browserPages: buildSearchableBrowserPages({
      ...scope,
      browserTabsByWorktree: state.browserTabsByWorktree,
      browserPagesByWorkspace: state.browserPagesByWorkspace,
      activeBrowserTabId: state.activeBrowserTabId,
      activeWorktreeId: state.activeWorktreeId,
      activeTabType: state.activeTabType
    }),
    simulatorTabs: buildSearchableSimulatorTabs({
      ...scope,
      unifiedTabsByWorktree: state.unifiedTabsByWorktree,
      activeGroupIdByWorktree: state.activeGroupIdByWorktree,
      groupsByWorktree: state.groupsByWorktree,
      activeWorktreeId: state.activeWorktreeId,
      activeTabType: state.activeTabType
    })
  }
}
