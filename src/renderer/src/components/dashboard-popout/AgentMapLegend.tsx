import { Focus, Layers3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { DashboardCardDotState } from '../../../../shared/dashboard-snapshot'
import type { AgentMapProjectRing, AgentMapLayout } from './agent-map-layout'

type AgentMapLegendProps = {
  layout: AgentMapLayout
  onFocusProject: (project: AgentMapProjectRing) => void
  onFit: () => void
}

const STATUS_ROWS: DashboardCardDotState[] = ['waiting', 'blocked', 'working', 'done', 'idle']

function stateLabel(state: DashboardCardDotState): string {
  switch (state) {
    case 'waiting':
      return translate('dashboardPopout.map.state.waiting', 'Waiting for input')
    case 'blocked':
      return translate('dashboardPopout.map.state.blocked', 'Blocked')
    case 'working':
      return translate('dashboardPopout.map.state.working', 'Working')
    case 'done':
      return translate('dashboardPopout.map.state.done', 'Done')
    case 'idle':
      return translate('dashboardPopout.map.state.idle', 'Idle')
  }
}

export function AgentMapLegend({
  layout,
  onFocusProject,
  onFit
}: AgentMapLegendProps): React.JSX.Element {
  const counts = { working: 0, blocked: 0, waiting: 0, done: 0, idle: 0 }
  for (const project of layout.projects) {
    for (const worktree of project.worktrees) {
      for (const state of Object.keys(counts) as DashboardCardDotState[]) {
        counts[state] += worktree.statusCounts[state]
      }
    }
  }

  return (
    <aside className="scrollbar-sleek hidden min-h-0 w-52 shrink-0 overflow-y-auto border-r border-border bg-card/35 p-3 lg:flex lg:flex-col">
      <header className="border-b border-border px-1 pb-3">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          <Layers3 className="size-3" aria-hidden />
          {translate('dashboardPopout.map.canvasLayers', 'Canvas layers')}
        </span>
        <strong className="mt-1 block text-xs">
          {translate('dashboardPopout.map.hierarchy', 'Project → workspace → agent')}
        </strong>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {translate(
            'dashboardPopout.map.hierarchyCopy',
            'Every agent keeps a stable place in its ownership tree.'
          )}
        </p>
      </header>

      <section className="border-b border-border py-3">
        <span className="px-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          {translate('dashboardPopout.filters.project', 'Project')}
        </span>
        <div className="mt-1.5 space-y-1">
          {layout.projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => onFocusProject(project)}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="min-w-0">
                <strong className="block truncate text-xs">{project.name}</strong>
                <span className="block text-[10px] text-muted-foreground">
                  {translate('dashboardPopout.map.workspaceCount', '{{count}} workspaces', {
                    count: project.worktrees.length
                  })}
                </span>
              </span>
              <span className="self-center text-xs font-semibold tabular-nums">
                {project.agentCount}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="border-b border-border py-3">
        <span className="px-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          {translate('dashboardPopout.map.agentState', 'Agent state')}
        </span>
        <div className="mt-2 space-y-2">
          {STATUS_ROWS.map((state) => (
            <div
              key={state}
              className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-1.5 px-1 text-[11px] text-muted-foreground"
            >
              <span className={`agent-map-legend-dot fleet-status-${state}`} aria-hidden />
              <span>{stateLabel(state)}</span>
              <span className="text-foreground tabular-nums">{counts[state]}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="border-b border-border py-3">
        <span className="px-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          {translate('dashboardPopout.map.agentSize', 'Agent size')}
        </span>
        <div className="mt-2 flex h-10 items-center justify-around rounded-md bg-muted">
          {[4, 6.5, 9, 12].map((radius) => (
            <span
              key={radius}
              className="rounded-full border border-muted-foreground"
              style={{ width: radius * 2, height: radius * 2 }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{translate('dashboardPopout.map.justStarted', 'Just started')}</span>
          <span>{translate('dashboardPopout.map.workingLonger', 'Working longer')}</span>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {translate('dashboardPopout.map.sizeScale', 'Logarithmic scale · capped after 60m')}
        </p>
      </section>

      <section className="space-y-2 px-1 py-3 text-[10px]">
        <p className="flex justify-between">
          <strong>{translate('dashboardPopout.map.hover', 'Hover')}</strong>
          <span className="text-muted-foreground">
            {translate('dashboardPopout.map.previewTerminal', 'Preview terminal')}
          </span>
        </p>
        <p className="flex justify-between">
          <strong>{translate('dashboardPopout.map.click', 'Click')}</strong>
          <span className="text-muted-foreground">
            {translate('dashboardPopout.map.pinAgent', 'Pin agent')}
          </span>
        </p>
        <p className="flex justify-between">
          <strong>{translate('dashboardPopout.map.doubleClick', 'Double-click')}</strong>
          <span className="text-muted-foreground">
            {translate('dashboardPopout.map.zoomWorkspace', 'Zoom workspace')}
          </span>
        </p>
      </section>

      <Button type="button" variant="outline" size="xs" className="mt-auto" onClick={onFit}>
        <Focus className="size-3" />
        {translate('dashboardPopout.map.fitMap', 'Fit map')}
      </Button>
    </aside>
  )
}
