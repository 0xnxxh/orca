import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { DashboardCard, DashboardCardHostKind } from '../../../../shared/dashboard-snapshot'
import { AgentMapCanvas, type AgentMapCanvasHandle } from './AgentMapCanvas'
import { AgentMapFilterRail } from './AgentMapFilterRail'
import {
  countAgentMapCards,
  filterAgentMapCards,
  type AgentMapState,
  type AgentMapHostFilter
} from './agent-map-filter'
import { updateAgentMapLayout, type AgentMapLayoutCache } from './agent-map-layout'
import './agent-map.css'

type AgentMapProps = {
  cards: DashboardCard[]
  now: number
  className?: string
  compact?: boolean
  selectedPaneKey?: string | null
  workspaceContextMenusEnabled?: boolean
  onWorkspaceContextMenuOpenChange?: (open: boolean) => void
  onOpenTerminal: (card: DashboardCard, side: 'left' | 'right') => void
}

const HOST_FILTERS: AgentMapHostFilter[] = ['all', 'local', 'ssh', 'wsl', 'remote']
const DEFAULT_STATES: AgentMapState[] = ['attention', 'working', 'done', 'idle']

function hostFilterLabel(filter: AgentMapHostFilter): string {
  switch (filter) {
    case 'all':
      return translate('dashboardPopout.map.host.all', 'All hosts')
    case 'local':
      return translate('dashboardPopout.map.host.local', 'Local')
    case 'ssh':
      return translate('dashboardPopout.map.host.ssh', 'SSH')
    case 'wsl':
      return translate('dashboardPopout.map.host.wsl', 'WSL')
    case 'remote':
      return translate('dashboardPopout.map.host.remote', 'Remote')
  }
}

export function AgentMap({
  cards,
  now,
  className,
  compact = false,
  selectedPaneKey = null,
  workspaceContextMenusEnabled = false,
  onWorkspaceContextMenuOpenChange,
  onOpenTerminal
}: AgentMapProps): React.JSX.Element {
  const canvasRef = useRef<AgentMapCanvasHandle>(null)
  const layoutCacheRef = useRef<AgentMapLayoutCache | null>(null)
  const [hostFilter, setHostFilter] = useState<AgentMapHostFilter>('all')
  const [enabledStates, setEnabledStates] = useState<Set<AgentMapState>>(
    () => new Set(DEFAULT_STATES)
  )
  const [hiddenProjectIds, setHiddenProjectIds] = useState<Set<string>>(() => new Set())
  const hostCounts = useMemo(() => {
    const counts: Record<DashboardCardHostKind, number> = {
      local: 0,
      ssh: 0,
      wsl: 0,
      remote: 0
    }
    for (const card of cards) {
      counts[card.hostKind ?? 'local'] += 1
    }
    return counts
  }, [cards])
  const projects = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; count: number }>()
    for (const card of cards) {
      const current = byId.get(card.repoId)
      if (current) {
        current.count += 1
      } else {
        byId.set(card.repoId, { id: card.repoId, name: card.repoName, count: 1 })
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [cards])
  const counts = useMemo(() => countAgentMapCards(cards), [cards])
  const visibleCards = useMemo(
    () =>
      filterAgentMapCards({
        cards,
        enabledStates,
        hostFilter,
        hiddenProjectIds
      }),
    [cards, enabledStates, hiddenProjectIds, hostFilter]
  )
  const layoutResult = useMemo(
    () => updateAgentMapLayout(layoutCacheRef.current, visibleCards, now),
    [visibleCards, now]
  )
  useEffect(() => {
    layoutCacheRef.current = layoutResult.cache
  }, [layoutResult.cache])
  const layout = layoutResult.layout

  const toggleState = (state: AgentMapState): void => {
    setEnabledStates((current) => {
      const next = new Set(current)
      if (next.has(state)) {
        next.delete(state)
      } else {
        next.add(state)
      }
      return next
    })
  }
  const toggleProject = (projectId: string): void => {
    setHiddenProjectIds((current) => {
      const next = new Set(current)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }
  const showAll = (): void => {
    setEnabledStates(new Set(DEFAULT_STATES))
    setHiddenProjectIds(new Set())
    setHostFilter('all')
  }

  return (
    <section className={cn('flex min-h-0 flex-1', className)}>
      {!compact ? (
        <AgentMapFilterRail
          counts={counts}
          enabledStates={enabledStates}
          hiddenProjectIds={hiddenProjectIds}
          projects={projects}
          totalCount={cards.length}
          visibleCount={visibleCards.length}
          onFit={() => canvasRef.current?.fit()}
          onProjectToggle={toggleProject}
          onShowAll={showAll}
          onStateToggle={toggleState}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-12 shrink-0 items-center gap-3 border-b border-border px-3 py-2">
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              {translate('dashboardPopout.map.liveContainmentMap', 'Live containment map')}
            </span>
            <strong className="block truncate text-xs">
              {translate(
                'dashboardPopout.map.filters.canvasSummary',
                '{{shown}} of {{total}} agents shown',
                {
                  shown: visibleCards.length,
                  total: cards.length
                }
              )}
            </strong>
          </span>
          {!compact ? (
            <div
              className="ml-auto flex items-center gap-0.5 rounded-md border border-border p-0.5"
              role="group"
              aria-label={translate('dashboardPopout.map.hostFilter', 'Host filter')}
            >
              {HOST_FILTERS.filter((option) => option === 'all' || hostCounts[option] > 0).map(
                (option) => (
                  <Button
                    key={option}
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-pressed={hostFilter === option}
                    onClick={() => setHostFilter(option)}
                    className={cn(
                      'h-6 px-2 text-[10px]',
                      hostFilter === option && 'bg-accent text-accent-foreground'
                    )}
                  >
                    {hostFilterLabel(option)}
                  </Button>
                )
              )}
            </div>
          ) : null}
        </header>
        <AgentMapCanvas
          key={layout.projects.length === 0 ? 'empty' : 'map'}
          ref={canvasRef}
          layout={layout}
          selectedPaneKey={selectedPaneKey}
          allowAggregation
          workspaceContextMenusEnabled={workspaceContextMenusEnabled}
          onWorkspaceContextMenuOpenChange={onWorkspaceContextMenuOpenChange}
          onSelectAgent={onOpenTerminal}
        />
      </div>
    </section>
  )
}
