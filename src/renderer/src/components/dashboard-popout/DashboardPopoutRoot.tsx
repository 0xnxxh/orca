import { AgentKanbanBoard } from './AgentKanbanBoard'
import { resolveAgentDashboardView } from './agent-dashboard-view'
import { useDashboardSnapshot } from './useDashboardSnapshot'
import { AgentDashboardSettingsMenu } from '../dashboard/AgentDashboardSettingsMenu'

type DashboardPopoutRootProps = {
  /** The layout requested via popout.html?view=<name>. */
  view: string | null
}

/**
 * Root of the pop-out dashboard window. Subscribes to the live snapshot relayed
 * from the main window and renders the requested layout.
 */
export function DashboardPopoutRoot(_props: DashboardPopoutRootProps): React.JSX.Element {
  const snapshot = useDashboardSnapshot()
  const initialView = resolveAgentDashboardView(_props.view) ?? 'board'
  return (
    <AgentKanbanBoard
      snapshot={snapshot}
      initialView={initialView}
      headerActions={<AgentDashboardSettingsMenu showOpenMode={false} />}
    />
  )
}
