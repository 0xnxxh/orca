import { Scan } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { AgentMapCounts, AgentMapState } from './agent-map-filter'

type AgentMapProjectOption = {
  id: string
  name: string
  count: number
}

type AgentMapFilterRailProps = {
  counts: AgentMapCounts
  enabledStates: ReadonlySet<AgentMapState>
  hiddenProjectIds: ReadonlySet<string>
  projects: AgentMapProjectOption[]
  totalCount: number
  visibleCount: number
  onFit: () => void
  onProjectToggle: (projectId: string) => void
  onShowAll: () => void
  onStateToggle: (state: AgentMapState) => void
}

const STATE_ROWS: {
  state: AgentMapState
  dotState: 'waiting' | 'working' | 'done' | 'idle'
}[] = [
  { state: 'attention', dotState: 'waiting' },
  { state: 'working', dotState: 'working' },
  { state: 'done', dotState: 'done' },
  { state: 'idle', dotState: 'idle' }
]

function stateLabel(state: AgentMapState): string {
  switch (state) {
    case 'attention':
      return translate('dashboardPopout.bucket.attention', 'Needs You')
    case 'working':
      return translate('dashboardPopout.bucket.working', 'Working')
    case 'done':
      return translate('dashboardPopout.bucket.done', 'Done')
    case 'idle':
      return translate('dashboardPopout.bucket.idle', 'Idle')
  }
}

export function AgentMapFilterRail({
  counts,
  enabledStates,
  hiddenProjectIds,
  projects,
  totalCount,
  visibleCount,
  onFit,
  onProjectToggle,
  onShowAll,
  onStateToggle
}: AgentMapFilterRailProps): React.JSX.Element {
  return (
    <aside className="scrollbar-sleek hidden min-h-0 w-56 shrink-0 overflow-y-auto border-r border-border bg-card/35 p-3 md:flex md:flex-col">
      <header className="border-b border-border px-1 pb-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          {translate('dashboardPopout.map.filters.title', 'Map filters')}
        </span>
        <strong className="mt-1 block text-xs">
          {translate('dashboardPopout.map.filters.control', 'Choose what stays visible')}
        </strong>
      </header>

      <section className="border-b border-border py-3">
        <span className="px-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          {translate('dashboardPopout.map.filters.showStates', 'Agent states')}
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
          {translate('dashboardPopout.map.filters.hidden', '{{count}} agents hidden', {
            count: totalCount - visibleCount
          })}
        </span>
      </div>

      <div className="mt-auto grid grid-cols-2 gap-1 pt-3">
        <Button type="button" variant="ghost" size="xs" onClick={onShowAll}>
          {translate('dashboardPopout.map.filters.showAll', 'Show all')}
        </Button>
        <Button type="button" variant="outline" size="xs" onClick={onFit}>
          <Scan className="size-3" />
          {translate('dashboardPopout.map.fit', 'Fit')}
        </Button>
      </div>
    </aside>
  )
}
