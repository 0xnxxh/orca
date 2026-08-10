import { classifyTitleActivity, isExplicitAgentStatusFresh } from '@/lib/pane-agent-evidence'
import { tabHasLivePty } from '@/lib/tab-has-live-pty'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusEntry,
  type MigrationUnsupportedPtyEntry
} from '../../../../shared/agent-status-types'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalTab } from '../../../../shared/types'

export type WorkspaceSpaceActivityCounts = {
  openEditorFileCount: number
  dirtyEditorBufferCount: number
  completedAgentCount: number
}

export function buildWorkspaceSpaceActivityCountsByWorktreeId(args: {
  openFiles: readonly { id: string; worktreeId: string; isDirty: boolean }[]
  editorDrafts: Readonly<Record<string, string>>
  retainedAgentsByPaneKey: Readonly<
    Record<string, { worktreeId: string; entry: Pick<AgentStatusEntry, 'state'> }>
  >
}): ReadonlyMap<string, WorkspaceSpaceActivityCounts> {
  const countsByWorktreeId = new Map<string, WorkspaceSpaceActivityCounts>()
  const getCounts = (worktreeId: string): WorkspaceSpaceActivityCounts => {
    const existing = countsByWorktreeId.get(worktreeId)
    if (existing) {
      return existing
    }
    const counts = { openEditorFileCount: 0, dirtyEditorBufferCount: 0, completedAgentCount: 0 }
    countsByWorktreeId.set(worktreeId, counts)
    return counts
  }
  for (const file of args.openFiles) {
    const counts = getCounts(file.worktreeId)
    counts.openEditorFileCount++
    if (file.isDirty || args.editorDrafts[file.id] !== undefined) {
      counts.dirtyEditorBufferCount++
    }
  }
  for (const retainedAgent of Object.values(args.retainedAgentsByPaneKey)) {
    if (retainedAgent.entry.state === 'done') {
      getCounts(retainedAgent.worktreeId).completedAgentCount++
    }
  }
  return countsByWorktreeId
}

export type WorkspaceSpaceAgentActivityInputs = {
  worktreeId: string
  tabs: readonly Pick<TerminalTab, 'id' | 'title'>[]
  agentStatusByPaneKey: Record<string, AgentStatusEntry>
  migrationUnsupportedByPtyId: Record<string, MigrationUnsupportedPtyEntry>
  runtimePaneTitlesByTabId: Record<string, Record<number, string>>
  ptyIdsByTabId: Record<string, string[]>
  now: number
}

function getPaneKeyTabId(paneKey: string): string | null {
  const parsed = parsePaneKey(paneKey)
  if (parsed) {
    return parsed.tabId
  }

  // Why: older hydrated snapshots can still carry `tabId:numericPaneId`.
  const separatorIndex = paneKey.indexOf(':')
  if (
    separatorIndex <= 0 ||
    separatorIndex !== paneKey.lastIndexOf(':') ||
    separatorIndex === paneKey.length - 1
  ) {
    return null
  }
  return paneKey.slice(0, separatorIndex)
}

function isActiveAgentState(entry: Pick<AgentStatusEntry, 'state'>): boolean {
  return entry.state === 'working' || entry.state === 'blocked' || entry.state === 'waiting'
}

function countTitleActiveAgentsForTab(
  tab: Pick<TerminalTab, 'id' | 'title'>,
  runtimePaneTitlesByTabId: Record<string, Record<number, string>>,
  ptyIdsByTabId: Record<string, string[]>
): number {
  if (!tabHasLivePty(ptyIdsByTabId, tab.id)) {
    return 0
  }

  const paneTitles = runtimePaneTitlesByTabId[tab.id]
  if (paneTitles && Object.keys(paneTitles).length > 0) {
    return Object.values(paneTitles).filter((title) => {
      const status = classifyTitleActivity(title)
      return status === 'working' || status === 'permission'
    }).length
  }

  const status = classifyTitleActivity(tab.title)
  return status === 'working' || status === 'permission' ? 1 : 0
}

export function countWorkspaceSpaceActiveAgents({
  worktreeId,
  tabs,
  agentStatusByPaneKey,
  migrationUnsupportedByPtyId,
  runtimePaneTitlesByTabId,
  ptyIdsByTabId,
  now
}: WorkspaceSpaceAgentActivityInputs): number {
  const tabIds = new Set(tabs.map((tab) => tab.id))
  const tabsWithActiveHook = new Set<string>()
  let count = 0

  for (const [paneKey, entry] of Object.entries(agentStatusByPaneKey)) {
    if (
      !isActiveAgentState(entry) ||
      !isExplicitAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS)
    ) {
      continue
    }
    const tabId = getPaneKeyTabId(entry.paneKey || paneKey)
    if (!tabId || !tabIds.has(tabId)) {
      continue
    }
    tabsWithActiveHook.add(tabId)
    count += 1
  }

  for (const entry of Object.values(migrationUnsupportedByPtyId)) {
    const tabId = entry.tabId ?? (entry.paneKey ? getPaneKeyTabId(entry.paneKey) : null)
    if (entry.worktreeId !== worktreeId && (!tabId || !tabIds.has(tabId))) {
      continue
    }
    if (tabId) {
      tabsWithActiveHook.add(tabId)
    }
    count += 1
  }

  for (const tab of tabs) {
    if (!tabsWithActiveHook.has(tab.id)) {
      count += countTitleActiveAgentsForTab(tab, runtimePaneTitlesByTabId, ptyIdsByTabId)
    }
  }
  return count
}

export function buildWorkspaceSpaceActiveAgentCountsByWorktreeId(args: {
  tabsByWorktree: Readonly<Record<string, readonly Pick<TerminalTab, 'id' | 'title'>[]>>
  agentStatusByPaneKey: Readonly<Record<string, AgentStatusEntry>>
  migrationUnsupportedByPtyId: Readonly<Record<string, MigrationUnsupportedPtyEntry>>
  runtimePaneTitlesByTabId: Readonly<Record<string, Record<number, string>>>
  ptyIdsByTabId: Record<string, string[]>
  now: number
}): ReadonlyMap<string, number> {
  const worktreeIdsByTabId = new Map<string, Set<string>>()
  for (const [worktreeId, tabs] of Object.entries(args.tabsByWorktree)) {
    for (const tab of tabs) {
      const owners = worktreeIdsByTabId.get(tab.id) ?? new Set<string>()
      owners.add(worktreeId)
      worktreeIdsByTabId.set(tab.id, owners)
    }
  }

  const hookCountByTabId = new Map<string, number>()
  for (const [paneKey, entry] of Object.entries(args.agentStatusByPaneKey)) {
    if (
      !isActiveAgentState(entry) ||
      !isExplicitAgentStatusFresh(entry, args.now, AGENT_STATUS_STALE_AFTER_MS)
    ) {
      continue
    }
    const tabId = getPaneKeyTabId(entry.paneKey || paneKey)
    if (tabId) {
      hookCountByTabId.set(tabId, (hookCountByTabId.get(tabId) ?? 0) + 1)
    }
  }

  const countsByWorktreeId = new Map<string, number>()
  const addCount = (worktreeId: string, count: number): void => {
    if (count > 0) {
      countsByWorktreeId.set(worktreeId, (countsByWorktreeId.get(worktreeId) ?? 0) + count)
    }
  }
  const migrationCountByTabId = new Map<string, number>()
  for (const entry of Object.values(args.migrationUnsupportedByPtyId)) {
    const tabId = entry.tabId ?? (entry.paneKey ? getPaneKeyTabId(entry.paneKey) : null)
    const tabOwners = tabId ? worktreeIdsByTabId.get(tabId) : undefined
    if (tabId) {
      migrationCountByTabId.set(tabId, (migrationCountByTabId.get(tabId) ?? 0) + 1)
    }
    if (entry.worktreeId !== undefined && !tabOwners?.has(entry.worktreeId)) {
      addCount(entry.worktreeId, 1)
    }
  }

  const paneTitleActivityByTabId = new Map<
    string,
    { hasPaneTitles: boolean; activeCount: number }
  >()
  const getPaneTitleActivity = (tabId: string): { hasPaneTitles: boolean; activeCount: number } => {
    const cached = paneTitleActivityByTabId.get(tabId)
    if (cached) {
      return cached
    }
    const titles = Object.values(args.runtimePaneTitlesByTabId[tabId] ?? {})
    const activity = {
      hasPaneTitles: titles.length > 0,
      activeCount: titles.filter((title) => {
        const status = classifyTitleActivity(title)
        return status === 'working' || status === 'permission'
      }).length
    }
    paneTitleActivityByTabId.set(tabId, activity)
    return activity
  }

  for (const [worktreeId, tabs] of Object.entries(args.tabsByWorktree)) {
    const countedEvidenceTabIds = new Set<string>()
    for (const tab of tabs) {
      const evidenceCount =
        (hookCountByTabId.get(tab.id) ?? 0) + (migrationCountByTabId.get(tab.id) ?? 0)
      if (evidenceCount > 0) {
        if (!countedEvidenceTabIds.has(tab.id)) {
          countedEvidenceTabIds.add(tab.id)
          addCount(worktreeId, evidenceCount)
        }
        continue
      }
      if (!tabHasLivePty(args.ptyIdsByTabId, tab.id)) {
        continue
      }
      const paneTitleActivity = getPaneTitleActivity(tab.id)
      if (paneTitleActivity.hasPaneTitles) {
        addCount(worktreeId, paneTitleActivity.activeCount)
      } else {
        const status = classifyTitleActivity(tab.title)
        addCount(worktreeId, status === 'working' || status === 'permission' ? 1 : 0)
      }
    }
  }
  return countsByWorktreeId
}
