import { getAgentRowConversationName } from '../../../../shared/agent-row-conversation-name'
import { useAppStore } from '@/store'
import type { DashboardAgentRow } from './useDashboardData'

/** The row's conversation name, or null when the mode is off or nothing usable exists. */
export function useAgentRowConversationName(agent: DashboardAgentRow): string | null {
  const enabled = useAppStore((s) => s.settings?.agentRowsUseConversationName === true)
  const generatedTitlesEnabled = useAppStore((s) => s.settings?.tabAutoGenerateTitle === true)
  // Why: row data patches live entries in place and keeps the tab snapshot from
  // row creation, so renames/agent titles landing after that would never show.
  // Read the current tab from the store; retained rows fall back to the snapshot.
  const liveTab = useAppStore((s) =>
    s.tabsByWorktree[agent.tab.worktreeId]?.find((tab) => tab.id === agent.tab.id)
  )
  if (!enabled) {
    return null
  }
  // Why: subagent child rows describe the child, and their agentType carries the
  // child's name — the parent tab's conversation name would mislabel them.
  if (agent.rowSource === 'subagent') {
    return null
  }
  return getAgentRowConversationName(liveTab ?? agent.tab, agent.agentType, generatedTitlesEnabled)
}
