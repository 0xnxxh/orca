import type { GlobalSettings } from '../../../../shared/types'
import { isNativeChatSupportedAgent } from '../../../../shared/native-chat-agent-support'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { DashboardAgentRow } from './useDashboardData'

/** The inspector follows the user's existing Chat UI default-view setting —
 *  no separate dashboard opt-in, and no per-tab mode reads. */
export function dashboardNativeChatByDefault(
  settings:
    | Pick<GlobalSettings, 'experimentalNativeChat' | 'openAgentTabsInChatByDefault'>
    | null
    | undefined
): boolean {
  return (
    settings?.experimentalNativeChat === true && settings?.openAgentTabsInChatByDefault === true
  )
}

/** Chat-mode cards carry the transcript coordinates the inspector reads.
 *  hostKind comes from the map's workspace metadata, not from here. */
export function dashboardCardNativeChatMetadata(
  agentType: string,
  providerSession: DashboardAgentRow['entry']['providerSession']
): Pick<DashboardCard, 'viewMode' | 'sessionId' | 'transcriptPath'> {
  if (!isNativeChatSupportedAgent(agentType)) {
    return {}
  }
  return {
    viewMode: 'chat',
    ...(providerSession?.id ? { sessionId: providerSession.id } : {}),
    ...(providerSession?.transcriptPath ? { transcriptPath: providerSession.transcriptPath } : {})
  }
}
