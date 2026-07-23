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

/** The row's conversation name, or null when nothing usable exists. */
export function useAgentRowConversationName(agent: DashboardAgentRow): string | null {
  const isSubagent = agent.rowSource === 'subagent'
  const generatedTitlesEnabled = useAppStore(
    (s) => !isSubagent && s.settings?.tabAutoGenerateTitle === true
  )
  // Why: child rows describe the child, so the parent tab would mislabel them.
  const liveTab = useAppStore((s) =>
    isSubagent ? undefined : getIndexedTab(s.tabsByWorktree[agent.tab.worktreeId], agent.tab.id)
  )
  if (isSubagent) {
    return null
  }
  // Why: retained row snapshots need a fallback after their live tab disappears.
  return getAgentRowConversationName(liveTab ?? agent.tab, agent.agentType, generatedTitlesEnabled)
}
