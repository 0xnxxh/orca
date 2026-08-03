import { cn } from '@/lib/utils'
import type { DashboardCard, DashboardSpawnAgentArgs } from '../../../../shared/dashboard-snapshot'
import type { AgentDashboardAgentViewMode } from '../../../../shared/types'
import { ActivityLanes } from './ActivityLanes'
import { AgentCellMap } from './AgentCellMap'
import { AgentMap } from './AgentMap'
import { AgentTerminalPanel, type AgentRevealArgs } from './AgentTerminalDialog'
import type { AgentDashboardView } from './agent-dashboard-view'

/** Which surface the selected agent opens in. */
export type AgentDashboardPanelMode = AgentDashboardAgentViewMode

type AgentDashboardViewPaneProps = {
  view: Exclude<AgentDashboardView, 'board'>
  cards: DashboardCard[]
  now: number
  selectedCard: DashboardCard | null
  panelMode: AgentDashboardPanelMode
  panelSide: 'left' | 'right'
  pinnedPaneKeys: ReadonlySet<string>
  reviewedPaneKeys: ReadonlySet<string>
  launchableAgentsByWorktreeId: Record<string, DashboardSpawnAgentArgs['agent'][]>
  onMarkReviewed: (cards: DashboardCard[]) => void
  onTogglePinned: (card: DashboardCard) => void
  onOpenTerminal: (card: DashboardCard, side: 'left' | 'right') => void
  onSpawnAgent: (args: DashboardSpawnAgentArgs) => void
  onPanelOpenChange: (open: boolean) => void
  onRevealAgent: (args: AgentRevealArgs) => void
}

/** Width the fleet view collapses to while a side panel is open. Map and
 *  cells read as maps at any size; lanes need their timeline axis. */
function collapsedClassName(view: AgentDashboardViewPaneProps['view']): string {
  const width = view === 'lanes' ? 'w-[clamp(22rem,48vw,46rem)]' : 'w-[clamp(14rem,28vw,22rem)]'
  return `${width} flex-none transition-[width] duration-200 motion-reduce:transition-none`
}

/** The non-board fleet views and the side panel they open, sharing one flex row
 *  whose direction follows the click that opened the panel. */
export function AgentDashboardViewPane({
  view,
  cards,
  now,
  selectedCard,
  panelMode,
  panelSide,
  pinnedPaneKeys,
  reviewedPaneKeys,
  launchableAgentsByWorktreeId,
  onMarkReviewed,
  onTogglePinned,
  onOpenTerminal,
  onSpawnAgent,
  onPanelOpenChange,
  onRevealAgent
}: AgentDashboardViewPaneProps): React.JSX.Element {
  const terminalCard = panelMode === 'terminal' ? selectedCard : null
  const collapsed = terminalCard ? collapsedClassName(view) : undefined

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1',
        terminalCard && panelSide === 'left' && 'flex-row-reverse'
      )}
    >
      {view === 'map' ? (
        <AgentMap
          cards={cards}
          now={now}
          className={collapsed}
          compact={terminalCard !== null}
          selectedPaneKey={selectedCard?.paneKey}
          pinnedPaneKeys={pinnedPaneKeys}
          reviewedPaneKeys={reviewedPaneKeys}
          launchableAgentsByWorktreeId={launchableAgentsByWorktreeId}
          onMarkReviewed={onMarkReviewed}
          onOpenTerminal={onOpenTerminal}
          onSpawnAgent={onSpawnAgent}
        />
      ) : view === 'cells' ? (
        <AgentCellMap
          cards={cards}
          now={now}
          className={collapsed}
          selectedPaneKey={selectedCard?.paneKey}
          onOpenTerminal={onOpenTerminal}
        />
      ) : (
        <ActivityLanes
          cards={cards}
          now={now}
          className={collapsed}
          selectedPaneKey={selectedCard?.paneKey}
          onOpenTerminal={onOpenTerminal}
        />
      )}
      {terminalCard ? (
        <AgentTerminalPanel
          card={terminalCard}
          onOpenChange={onPanelOpenChange}
          onReveal={onRevealAgent}
          reviewed={reviewedPaneKeys.has(terminalCard.paneKey)}
          pinned={pinnedPaneKeys.has(terminalCard.paneKey)}
          onMarkReviewed={(card) => onMarkReviewed([card])}
          onTogglePinned={onTogglePinned}
          className={cn(
            panelSide === 'right' ? 'ml-0' : 'mr-0',
            'animate-in fade-in-0 duration-200 motion-reduce:animate-none',
            panelSide === 'right' ? 'slide-in-from-right-2' : 'slide-in-from-left-2'
          )}
        />
      ) : null}
    </div>
  )
}
