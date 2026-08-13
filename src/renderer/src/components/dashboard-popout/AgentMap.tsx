import { useEffect, useMemo, useRef } from 'react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type {
  DashboardCard,
  DashboardCardHostKind,
  DashboardSleepWorkspaceArgs,
  DashboardSpawnAgentArgs,
  DashboardWorkspace
} from '../../../../shared/dashboard-snapshot'
import type { RepoIcon } from '../../../../shared/repo-icon'
import type { TuiAgent } from '../../../../shared/types'
import { AgentMapCanvas, type AgentMapCanvasHandle } from './AgentMapCanvas'
import { ALL_AGENT_MAP_HOSTS, filterAgentMapCards, type AgentMapState } from './agent-map-filter'
import { updateAgentMapLayout, type AgentMapLayoutCache } from './agent-map-layout'
import { selectAgentMapRecentFinishPaneKeys } from './agent-map-node-metadata'
import './agent-map.css'

type AgentMapProps = {
  cards: DashboardCard[]
  workspaces?: DashboardWorkspace[]
  repoIconsByRepoId?: Record<string, RepoIcon | null>
  now: number
  className?: string
  selectedPaneKey?: string | null
  /** Owned by the board so the shared toolbar filter can drive it. Defaults to
   *  every state, i.e. the map shows whatever it is handed. */
  enabledStates?: ReadonlySet<AgentMapState>
  /** Owned by the board's filter menu, same reason. Defaults to every host. */
  enabledHosts?: ReadonlySet<DashboardCardHostKind>
  /** Owned by the board's filter menu. Defaults to shown. */
  showOrchestrationLinks?: boolean
  launchableAgentsByWorktreeId?: Record<string, TuiAgent[]>
  workspaceContextMenusEnabled?: boolean
  onWorkspaceContextMenuOpenChange?: (open: boolean) => void
  onOpenTerminal: (card: DashboardCard) => void
  onSpawnAgent?: (args: DashboardSpawnAgentArgs) => void
  onSleepWorkspace?: (args: DashboardSleepWorkspaceArgs) => void
}

const ALL_AGENT_STATES: ReadonlySet<AgentMapState> = new Set<AgentMapState>([
  'attention',
  'working',
  'done',
  'idle'
])
const ALL_HOSTS: ReadonlySet<DashboardCardHostKind> = new Set(ALL_AGENT_MAP_HOSTS)
const EMPTY_WORKSPACES: DashboardWorkspace[] = []

export function AgentMap({
  cards,
  workspaces = EMPTY_WORKSPACES,
  repoIconsByRepoId,
  now,
  className,
  selectedPaneKey = null,
  enabledStates = ALL_AGENT_STATES,
  enabledHosts = ALL_HOSTS,
  showOrchestrationLinks = true,
  launchableAgentsByWorktreeId,
  workspaceContextMenusEnabled = false,
  onWorkspaceContextMenuOpenChange,
  onOpenTerminal,
  onSpawnAgent,
  onSleepWorkspace
}: AgentMapProps): React.JSX.Element {
  const canvasRef = useRef<AgentMapCanvasHandle>(null)
  const layoutCacheRef = useRef<AgentMapLayoutCache | null>(null)
  const visibleCards = useMemo(
    () =>
      filterAgentMapCards({
        cards,
        enabledStates,
        enabledHosts
      }),
    [cards, enabledStates, enabledHosts]
  )
  const visibleWorkspaces = useMemo(
    () => workspaces.filter((workspace) => enabledHosts.has(workspace.hostKind)),
    [enabledHosts, workspaces]
  )
  const layoutResult = useMemo(
    () => updateAgentMapLayout(layoutCacheRef.current, visibleCards, now, visibleWorkspaces),
    [visibleCards, visibleWorkspaces, now]
  )
  const recentFinishPaneKeys = useMemo(
    () => selectAgentMapRecentFinishPaneKeys(visibleCards),
    [visibleCards]
  )
  useEffect(() => {
    layoutCacheRef.current = layoutResult.cache
  }, [layoutResult.cache])
  const layout = layoutResult.layout

  return (
    <section className={cn('flex min-h-0 flex-1', className)}>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-12 shrink-0 items-center gap-3 border-b border-border px-3 py-2">
          <strong className="min-w-0 truncate text-xs">
            {translate(
              'dashboardPopout.map.filters.canvasSummary',
              '{{shown}} of {{total}} agents shown',
              {
                shown: visibleCards.length,
                total: cards.length
              }
            )}
          </strong>
        </header>
        <AgentMapCanvas
          ref={canvasRef}
          layout={layout}
          repoIconsByRepoId={repoIconsByRepoId}
          selectedPaneKey={selectedPaneKey}
          allowAggregation
          showOrchestrationLinks={showOrchestrationLinks}
          recentFinishPaneKeys={recentFinishPaneKeys}
          launchableAgentsByWorktreeId={launchableAgentsByWorktreeId}
          workspaceContextMenusEnabled={workspaceContextMenusEnabled}
          onWorkspaceContextMenuOpenChange={onWorkspaceContextMenuOpenChange}
          onSelectAgent={onOpenTerminal}
          onSpawnAgent={onSpawnAgent}
          onSleepWorkspace={onSleepWorkspace}
        />
      </div>
    </section>
  )
}
