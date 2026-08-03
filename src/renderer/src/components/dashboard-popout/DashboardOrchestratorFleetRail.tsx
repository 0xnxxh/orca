import { Search } from 'lucide-react'
import { useState } from 'react'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent, formatAgentTypeLabel } from '@/lib/agent-status'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { DashboardCardDotState } from '../../../../shared/dashboard-snapshot'
import {
  dashboardAgentContext,
  DASHBOARD_ORCHESTRATOR_CONTEXT_MIME,
  type DashboardOrchestratorContext,
  type DashboardOrchestratorProject
} from './dashboard-orchestrator-context'

type DashboardOrchestratorFleetRailProps = {
  projects: DashboardOrchestratorProject[]
  selectedContextIds: Set<string>
  onToggleContext: (context: DashboardOrchestratorContext) => void
}

function statusDotClass(status: DashboardCardDotState): string {
  if (status === 'blocked') {
    return 'bg-destructive'
  }
  if (status === 'waiting') {
    return 'bg-amber-500'
  }
  if (status === 'done') {
    return 'bg-status-success'
  }
  if (status === 'idle') {
    return 'bg-muted-foreground/45'
  }
  return 'border border-foreground bg-background'
}

function startContextDrag(event: React.DragEvent, context: DashboardOrchestratorContext): void {
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData(DASHBOARD_ORCHESTRATOR_CONTEXT_MIME, context.id)
}

function contextButtonClass(selected: boolean): string {
  return cn(
    'border border-border bg-background shadow-xs transition-colors hover:bg-accent',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    selected && 'border-ring bg-accent ring-1 ring-ring/45'
  )
}

function matchesFleetQuery(project: DashboardOrchestratorProject, query: string): boolean {
  if (!query) {
    return true
  }
  return (
    project.name.toLowerCase().includes(query) ||
    project.workspaces.some(
      (workspace) =>
        workspace.name.toLowerCase().includes(query) ||
        workspace.cards.some((card) =>
          (card.conversationName ?? formatAgentTypeLabel(card.agentType))
            .toLowerCase()
            .includes(query)
        )
    )
  )
}

export function DashboardOrchestratorFleetRail({
  projects,
  selectedContextIds,
  onToggleContext
}: DashboardOrchestratorFleetRailProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const visibleProjects = projects.filter((project) => matchesFleetQuery(project, normalizedQuery))

  return (
    <aside className="flex min-h-0 flex-col border-r border-border bg-muted/20">
      <div className="shrink-0 border-b border-border p-3">
        <div className="flex items-baseline justify-between gap-2">
          <strong className="text-xs">
            {translate('dashboardPopout.orchestrator.fleetContext', 'Fleet context')}
          </strong>
          <span className="text-[10px] text-muted-foreground">
            {translate('dashboardPopout.orchestrator.dragHint', 'Drag into chat')}
          </span>
        </div>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={translate(
              'dashboardPopout.orchestrator.filterFleet',
              'Filter fleet context'
            )}
            placeholder={translate('dashboardPopout.orchestrator.filterPlaceholder', 'Find…')}
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {visibleProjects.map((project) => (
            <section key={project.id} className="space-y-1.5">
              <button
                type="button"
                draggable
                aria-pressed={selectedContextIds.has(project.context.id)}
                className={cn(
                  contextButtonClass(selectedContextIds.has(project.context.id)),
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left'
                )}
                onDragStart={(event) => startContextDrag(event, project.context)}
                onClick={() => onToggleContext(project.context)}
              >
                <span className="size-2.5 rounded-full border border-ring/60 bg-card ring-2 ring-muted" />
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">
                  {project.name}
                </span>
                <span className="text-[10px] text-muted-foreground">{project.agentCount}</span>
              </button>
              <div className="ml-2 space-y-1.5 border-l border-border pl-2">
                {project.workspaces.map((workspace) => (
                  <div
                    key={workspace.id}
                    className="rounded-lg border border-border bg-card/65 p-2"
                  >
                    <button
                      type="button"
                      draggable
                      aria-pressed={selectedContextIds.has(workspace.context.id)}
                      className={cn(
                        contextButtonClass(selectedContextIds.has(workspace.context.id)),
                        'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left'
                      )}
                      onDragStart={(event) => startContextDrag(event, workspace.context)}
                      onClick={() => onToggleContext(workspace.context)}
                    >
                      <span className="size-1.5 rounded-full bg-muted-foreground/55" />
                      <span className="min-w-0 flex-1 truncate text-[10px] font-medium">
                        {workspace.name}
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        {workspace.cards.length}
                      </span>
                    </button>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {workspace.cards.map((card) => {
                        const context = dashboardAgentContext(card, project.name, workspace.name)
                        const selected = selectedContextIds.has(context.id)
                        const name = card.conversationName ?? formatAgentTypeLabel(card.agentType)
                        return (
                          <button
                            key={card.paneKey}
                            type="button"
                            draggable
                            aria-label={translate(
                              'dashboardPopout.orchestrator.addAgentContext',
                              'Add {{agent}} to orchestration context',
                              { agent: name }
                            )}
                            aria-pressed={selected}
                            title={name}
                            className={cn(
                              contextButtonClass(selected),
                              'relative grid size-7 place-items-center rounded-full'
                            )}
                            onDragStart={(event) => startContextDrag(event, context)}
                            onClick={() => onToggleContext(context)}
                          >
                            <AgentIcon agent={agentTypeToIconAgent(card.agentType)} size={12} />
                            <span
                              className={cn(
                                'absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-card',
                                statusDotClass(card.dotState)
                              )}
                            />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {visibleProjects.length === 0 ? (
            <p className="py-6 text-center text-[11px] text-muted-foreground">
              {translate('dashboardPopout.orchestrator.noFleetMatches', 'No matches')}
            </p>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  )
}
