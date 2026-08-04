import type { AppState } from '@/store/types'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { DashboardAgentRow } from './useDashboardData'
import { dashboardCardHostKind } from './dashboard-card-host-kind'

type DashboardCardNativeChatArgs = {
  repo: AppState['repos'][number]
  worktree: AppState['worktreesByRepo'][string][number]
  ptyId: string | null
  terminalInput: DashboardCard['terminalInput']
  clientPlatform: NodeJS.Platform
  providerSession: DashboardAgentRow['entry']['providerSession']
}

export function dashboardCardNativeChatMetadata({
  repo,
  worktree,
  ptyId,
  terminalInput,
  clientPlatform,
  providerSession
}: DashboardCardNativeChatArgs): Pick<
  DashboardCard,
  'hostKind' | 'viewMode' | 'sessionId' | 'transcriptPath'
> {
  return {
    hostKind: dashboardCardHostKind(repo, worktree, ptyId, terminalInput, clientPlatform),
    viewMode: 'chat',
    ...(providerSession?.id ? { sessionId: providerSession.id } : {}),
    ...(providerSession?.transcriptPath ? { transcriptPath: providerSession.transcriptPath } : {})
  }
}
