import { AgentKanbanBoard, type AgentDashboardView } from './AgentKanbanBoard'
import { useDashboardSnapshot } from './useDashboardSnapshot'

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
  const initialView: AgentDashboardView = _props.view === 'cells' ? 'cells' : 'board'
  return <AgentKanbanBoard snapshot={snapshot} initialView={initialView} />
}
