import type { AppState } from '@/store/types'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { ActiveDashboardWorkspace } from './dashboard-snapshot-workspaces'
import {
  dashboardCardMapWorkspaceMetadata,
  dashboardExecutionHostLabel
} from './dashboard-snapshot-workspaces'
import { boundedLabelOrUndefined } from './dashboard-card-labels'

type DashboardHostMetadataState = Partial<Pick<AppState, 'runtimeEnvironments' | 'sshTargetLabels'>>

export function resolveDashboardCardHostMetadata(
  state: DashboardHostMetadataState,
  workspace: ActiveDashboardWorkspace,
  ptyId: string | null,
  terminalInput: DashboardCard['terminalInput'],
  clientPlatform: NodeJS.Platform
): ReturnType<typeof dashboardCardMapWorkspaceMetadata> & { hostLabel?: string } {
  const metadata = dashboardCardMapWorkspaceMetadata(
    workspace,
    ptyId,
    terminalInput,
    clientPlatform
  )
  const hostLabel = boundedLabelOrUndefined(
    dashboardExecutionHostLabel(state, metadata.executionHostId)
  )
  return { ...metadata, ...(hostLabel ? { hostLabel } : {}) }
}
