import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { DashboardAgentRow } from './useDashboardData'

/** Chat-mode tabs carry the transcript coordinates the inspector reads.
 *  hostKind comes from the map's workspace metadata, not from here. */
export function dashboardCardNativeChatMetadata(
  providerSession: DashboardAgentRow['entry']['providerSession']
): Pick<DashboardCard, 'viewMode' | 'sessionId' | 'transcriptPath'> {
  return {
    viewMode: 'chat',
    ...(providerSession?.id ? { sessionId: providerSession.id } : {}),
    ...(providerSession?.transcriptPath ? { transcriptPath: providerSession.transcriptPath } : {})
  }
}
