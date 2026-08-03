import { Check, Focus, Pin } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type {
  AgentMapFinishedScope,
  AgentMapFocusCounts,
  AgentMapFocusState
} from './agent-map-focus-filter'

type AgentMapProjectOption = {
  id: string
  name: string
  count: number
}

type AgentMapFocusRailProps = {
  counts: AgentMapFocusCounts
  enabledStates: ReadonlySet<AgentMapFocusState>
  finishedScope: AgentMapFinishedScope
  hiddenProjectIds: ReadonlySet<string>
  pinnedCount: number
  projects: AgentMapProjectOption[]
  reviewableVisibleCards: DashboardCard[]
  totalCount: number
  visibleCount: number
  onFinishedScopeChange: (scope: AgentMapFinishedScope) => void
  onFit: () => void
  onMarkReviewed: (cards: DashboardCard[]) => void
  onProjectToggle: (projectId: string) => void
  onShowAll: () => void
  onStateToggle: (state: AgentMapFocusState) => void
}

const STATE_ROWS: {
  state: AgentMapFocusState
  dotState: 'waiting' | 'working' | 'done'
}[] = [
  { state: 'attention', dotState: 'waiting' },
  { state: 'working', dotState: 'working' },
  { state: 'finished', dotState: 'done' }
]

const FINISHED_SCOPES: AgentMapFinishedScope[] = ['review', 'day', 'week', 'all']

function stateLabel(state: AgentMapFocusState): string {
  switch (state) {
    case 'attention':
      return translate('dashboardPopout.bucket.attention', 'Needs You')
    case 'working':
      return translate('dashboardPopout.bucket.working', 'Working')
    case 'finished':
      return translate('dashboardPopout.map.focus.finished', 'Finished')
  }
}

function finishedScopeLabel(scope: AgentMapFinishedScope): string {
  switch (scope) {
    case 'review':
      return translate('dashboardPopout.map.focus.toReview', 'To review')
    case 'day':
      return translate('dashboardPopout.map.focus.lastDay', 'Last 24 hours')
    case 'week':
      return translate('dashboardPopout.map.focus.lastWeek', 'Last 7 days')
    case 'all':
      return translate('dashboardPopout.map.focus.allFinished', 'All finished')
  }
}

export function AgentMapFocusRail({
  counts,
  enabledStates,
  finishedScope,
  hiddenProjectIds,
  pinnedCount,
  projects,
  reviewableVisibleCards,
  totalCount,
  visibleCount,
  onFinishedScopeChange,
  onFit,
  onMarkReviewed,
  onProjectToggle,
  onShowAll,
  onStateToggle
}: AgentMapFocusRailProps): React.JSX.Element {
  return (
    <aside className="scrollbar-sleek hidden min-h-0 w-56 shrink-0 overflow-y-auto border-r border-border bg-card/35 p-3 lg:flex lg:flex-col">
      <header className="border-b border-border px-1 pb-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          {translate('dashboardPopout.map.focus.title', 'Focus view')}
        </span>
        <strong className="mt-1 block text-xs">
          {translate('dashboardPopout.map.focus.control', 'You decide what stays visible')}
        </strong>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {translate(
            'dashboardPopout.map.focus.reviewCopy',
            'Opening a result marks it seen. Only Mark reviewed removes it from Focus.'
          )}
        </p>
      </header>

      <section className="border-b border-border py-3">
        <span className="px-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          {translate('dashboardPopout.map.focus.showStates', 'Show agent states')}
        </span>
        <div className="mt-1.5 space-y-0.5">
          {STATE_ROWS.map(({ state, dotState }) => {
            const active = enabledStates.has(state)
            return (
              <button
                key={state}
                type="button"
                aria-pressed={active}
                onClick={() => onStateToggle(state)}
                className={cn(
                  'grid h-8 w-full grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  active && 'bg-accent text-accent-foreground'
                )}
              >
                <span className="inline-flex" aria-hidden>
                  <AgentStateDot state={dotState} size="md" />
                </span>
                <span>{stateLabel(state)}</span>
                <strong className="text-[11px] font-medium tabular-nums">{counts[state]}</strong>
              </button>
            )
          })}
        </div>
      </section>

      <section className="border-b border-border py-3">
        <span className="px-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          {translate('dashboardPopout.map.focus.finishedResults', 'Finished results')}
        </span>
        <div className="mt-1.5 space-y-0.5">
          {FINISHED_SCOPES.map((scope) => (
            <button
              key={scope}
              type="button"
              disabled={!enabledStates.has('finished')}
              onClick={() => onFinishedScopeChange(scope)}
              className={cn(
                'flex h-7 w-full items-center rounded-md px-2 text-left text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40',
                finishedScope === scope && 'bg-accent text-accent-foreground'
              )}
            >
              <span>{finishedScopeLabel(scope)}</span>
              <strong className="ml-auto font-medium tabular-nums">{counts[scope]}</strong>
            </button>
          ))}
        </div>
        <p className="mt-2 flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
          <Pin className="size-3" aria-hidden />
          {translate('dashboardPopout.map.focus.pinnedVisible', 'Pinned results stay visible.')}
          {pinnedCount > 0 ? <strong className="ml-auto tabular-nums">{pinnedCount}</strong> : null}
        </p>
      </section>

      <section className="border-b border-border py-3">
        <span className="px-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          {translate('dashboardPopout.filters.project', 'Project')}
        </span>
        <div className="mt-1.5 space-y-0.5">
          {projects.map((project) => {
            const active = !hiddenProjectIds.has(project.id)
            return (
              <button
                key={project.id}
                type="button"
                aria-pressed={active}
                onClick={() => onProjectToggle(project.id)}
                className={cn(
                  'grid min-h-8 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  active && 'bg-accent text-accent-foreground'
                )}
              >
                <span className="truncate font-medium">{project.name}</span>
                <strong className="text-[11px] font-medium tabular-nums">{project.count}</strong>
              </button>
            )
          })}
        </div>
      </section>

      <div className="border-b border-border px-1 py-3">
        <strong className="block text-xs tabular-nums">
          {translate('dashboardPopout.search.results', '{{shown}} of {{total}} shown', {
            shown: visibleCount,
            total: totalCount
          })}
        </strong>
        <span className="text-[10px] text-muted-foreground">
          {translate('dashboardPopout.map.focus.hidden', '{{count}} agents hidden', {
            count: totalCount - visibleCount
          })}
        </span>
      </div>

      <Button
        type="button"
        variant="outline"
        size="xs"
        className="mt-3 justify-start"
        disabled={reviewableVisibleCards.length === 0}
        onClick={() => onMarkReviewed(reviewableVisibleCards)}
      >
        <Check className="size-3" />
        {translate('dashboardPopout.map.focus.reviewVisible', 'Mark visible results reviewed')}
      </Button>

      <div className="mt-auto grid grid-cols-2 gap-1 pt-3">
        <Button type="button" variant="ghost" size="xs" onClick={onShowAll}>
          {translate('dashboardPopout.map.focus.showAll', 'Show all')}
        </Button>
        <Button type="button" variant="outline" size="xs" onClick={onFit}>
          <Focus className="size-3" />
          {translate('dashboardPopout.map.fit', 'Fit')}
        </Button>
      </div>
    </aside>
  )
}
