import { getAgentRowConversationName } from '../../../../shared/agent-row-conversation-name'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { DashboardAgentRow } from './useDashboardData'

type WorktreeTabs = NonNullable<AppState['tabsByWorktree'][string]>

const tabIndexByTabs = new WeakMap<WorktreeTabs, ReadonlyMap<string, WorktreeTabs[number]>>()

function getIndexedTab(
  tabs: WorktreeTabs | undefined,
  tabId: string
): WorktreeTabs[number] | undefined {
  if (!tabs) {
    return undefined
  }
  let tabIndex = tabIndexByTabs.get(tabs)
  if (!tabIndex) {
    tabIndex = new Map(tabs.map((tab) => [tab.id, tab]))
    tabIndexByTabs.set(tabs, tabIndex)
  }
  return tabIndex.get(tabId)
}

/** The row's conversation name, or null when the mode is off or nothing usable exists. */
export function useAgentRowConversationName(agent: DashboardAgentRow): string | null {
  const mode = useAppStore((s) => {
    if (agent.rowSource === 'subagent' || s.settings?.agentRowsUseConversationName !== true) {
      return 0
    }
    return s.settings?.tabAutoGenerateTitle === true ? 2 : 1
  })
  // Why: the opt-in gate keeps inactive rows off the hot tab map entirely.
  const liveTab = useAppStore((s) =>
    mode === 0 ? undefined : getIndexedTab(s.tabsByWorktree[agent.tab.worktreeId], agent.tab.id)
  )
  if (mode === 0) {
    return null
  }
  // Why: retained row snapshots need a fallback after their live tab disappears.
  return getAgentRowConversationName(liveTab ?? agent.tab, agent.agentType, mode === 2)
}
