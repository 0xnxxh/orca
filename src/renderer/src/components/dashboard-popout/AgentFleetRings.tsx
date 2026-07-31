import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { DashboardCard, DashboardCardHostKind } from '../../../../shared/dashboard-snapshot'
import { FleetRingsCanvas, type FleetRingsCanvasHandle } from './FleetRingsCanvas'
import { FleetRingsFocusRail } from './FleetRingsFocusRail'
import {
  countFleetFocusCards,
  filterFleetFocusCards,
  type FleetFinishedScope,
  type FleetFocusState,
  type FleetHostFilter
} from './fleet-rings-focus-filter'
import { updateFleetRingsLayout, type FleetRingsLayoutCache } from './fleet-rings-layout'
import './fleet-rings.css'

type AgentFleetRingsProps = {
  cards: DashboardCard[]
  now: number
  className?: string
  compact?: boolean
  selectedPaneKey?: string | null
  pinnedPaneKeys: ReadonlySet<string>
  reviewedPaneKeys: ReadonlySet<string>
  onMarkReviewed: (cards: DashboardCard[]) => void
  onOpenTerminal: (card: DashboardCard, side: 'left' | 'right') => void
}

const HOST_FILTERS: FleetHostFilter[] = ['all', 'local', 'ssh', 'wsl', 'remote']
const DEFAULT_STATES: FleetFocusState[] = ['attention', 'working', 'finished']

function hostFilterLabel(filter: FleetHostFilter): string {
  switch (filter) {
    case 'all':
      return translate('dashboardPopout.rings.host.all', 'All hosts')
    case 'local':
      return translate('dashboardPopout.rings.host.local', 'Local')
    case 'ssh':
      return translate('dashboardPopout.rings.host.ssh', 'SSH')
    case 'wsl':
      return translate('dashboardPopout.rings.host.wsl', 'WSL')
    case 'remote':
      return translate('dashboardPopout.rings.host.remote', 'Remote')
  }
}

export function AgentFleetRings({
  cards,
  now,
  className,
  compact = false,
  selectedPaneKey = null,
  pinnedPaneKeys,
  reviewedPaneKeys,
  onMarkReviewed,
  onOpenTerminal
}: AgentFleetRingsProps): React.JSX.Element {
  const canvasRef = useRef<FleetRingsCanvasHandle>(null)
  const layoutCacheRef = useRef<FleetRingsLayoutCache | null>(null)
  const [hostFilter, setHostFilter] = useState<FleetHostFilter>('all')
  const [enabledStates, setEnabledStates] = useState<Set<FleetFocusState>>(
    () => new Set(DEFAULT_STATES)
  )
  const [finishedScope, setFinishedScope] = useState<FleetFinishedScope>('review')
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
  const counts = useMemo(
    () => countFleetFocusCards(cards, now, reviewedPaneKeys),
    [cards, now, reviewedPaneKeys]
  )
  const visibleCards = useMemo(
    () =>
      filterFleetFocusCards({
        cards,
        enabledStates,
        finishedScope,
        hostFilter,
        hiddenProjectIds,
        pinnedPaneKeys,
        reviewedPaneKeys,
        now
      }),
    [
      cards,
      enabledStates,
      finishedScope,
      hiddenProjectIds,
      hostFilter,
      now,
      pinnedPaneKeys,
      reviewedPaneKeys
    ]
  )
  const reviewableVisibleCards = useMemo(
    () =>
      visibleCards.filter(
        (card) => card.dotState === 'done' && !reviewedPaneKeys.has(card.paneKey)
      ),
    [reviewedPaneKeys, visibleCards]
  )
  const pinnedCount = useMemo(
    () => cards.filter((card) => pinnedPaneKeys.has(card.paneKey)).length,
    [cards, pinnedPaneKeys]
  )
  const layout = useMemo(() => {
    const next = updateFleetRingsLayout(layoutCacheRef.current, visibleCards, now)
    layoutCacheRef.current = next.cache
    return next.layout
  }, [visibleCards, now])

  const toggleState = (state: FleetFocusState): void => {
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
    setFinishedScope('all')
    setHiddenProjectIds(new Set())
    setHostFilter('all')
  }

  return (
    <section className={cn('flex min-h-0 flex-1', className)}>
      {!compact ? (
        <FleetRingsFocusRail
          counts={counts}
          enabledStates={enabledStates}
          finishedScope={finishedScope}
          hiddenProjectIds={hiddenProjectIds}
          pinnedCount={pinnedCount}
          projects={projects}
          reviewableVisibleCards={reviewableVisibleCards}
          totalCount={cards.length}
          visibleCount={visibleCards.length}
          onFinishedScopeChange={setFinishedScope}
          onFit={() => canvasRef.current?.fit()}
          onMarkReviewed={onMarkReviewed}
          onProjectToggle={toggleProject}
          onShowAll={showAll}
          onStateToggle={toggleState}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-12 shrink-0 items-center gap-3 border-b border-border px-3 py-2">
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              {translate('dashboardPopout.rings.liveContainmentMap', 'Live containment map')}
            </span>
            <strong className="block truncate text-xs">
              {translate(
                'dashboardPopout.rings.focus.canvasSummary',
                'Focus · {{shown}} of {{total}} agents',
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
              aria-label={translate('dashboardPopout.rings.hostFilter', 'Host filter')}
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
        <FleetRingsCanvas
          key={layout.projects.length === 0 ? 'empty' : 'fleet'}
          ref={canvasRef}
          layout={layout}
          selectedPaneKey={selectedPaneKey}
          allowAggregation={finishedScope !== 'review'}
          onSelectAgent={onOpenTerminal}
        />
      </div>
    </section>
  )
}
