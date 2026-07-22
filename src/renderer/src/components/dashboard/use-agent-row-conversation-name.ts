import { getAgentRowConversationName } from '../../../../shared/agent-row-conversation-name'
import { useAppStore } from '@/store'
import type { DashboardAgentRow } from './useDashboardData'

/** The row's conversation name, or null when the mode is off or nothing usable exists. */
export function useAgentRowConversationName(agent: DashboardAgentRow): string | null {
  const enabled = useAppStore((s) => s.settings?.agentRowsUseConversationName === true)
  const generatedTitlesEnabled = useAppStore((s) => s.settings?.tabAutoGenerateTitle === true)
  if (!enabled) {
    return null
  }
  // Why: subagent child rows describe the child, and their agentType carries the
  // child's name — the parent tab's conversation name would mislabel them.
  if (agent.rowSource === 'subagent') {
    return null
  }
  return getAgentRowConversationName(agent.tab, agent.agentType, generatedTitlesEnabled)
}
