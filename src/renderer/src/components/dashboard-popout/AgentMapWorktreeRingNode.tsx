import { memo, useState, type MutableRefObject } from 'react'
import { AgentStateDot, agentStateLabel } from '@/components/AgentStateDot'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { translate } from '@/i18n/i18n'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent } from '@/lib/agent-status'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type {
  AgentMapAgentNode,
  AgentMapProjectRing,
  AgentMapWorktreeRing
} from './agent-map-layout'
import { shouldAggregateAgentMapWorktree } from './agent-map-layout'

type AgentMapWorktreeRingNodeProps = {
  project: AgentMapProjectRing
  worktree: AgentMapWorktreeRing
  zoom: number
  labelScale: number
  mapScale: number
  selectedPaneKey: string | null
  allowAggregation: boolean
  nodeRefs: MutableRefObject<Map<string, SVGGElement>>
  onSelectAgent: (card: DashboardCard, side: 'left' | 'right') => void
  onOpenWorkspaceContextMenu?: (
    event: React.MouseEvent<SVGCircleElement>,
    worktree: AgentMapWorktreeRing
  ) => void
  onAgentKeyDown: (event: React.KeyboardEvent<SVGGElement>, agent: AgentMapAgentNode) => void
}

function formatDuration(minutes: number): string {
  if (minutes < 1) {
    return translate('dashboardPopout.card.time.justNow', 'just now')
  }
  if (minutes < 60) {
    return translate('dashboardPopout.card.time.minutes', '{{count}}m', {
      count: Math.floor(minutes)
    })
  }
  return translate('dashboardPopout.card.time.hours', '{{count}}h', {
    count: Math.floor(minutes / 60)
  })
}

function lineagePath(parent: AgentMapAgentNode, child: AgentMapAgentNode): string {
  const startY = parent.y + parent.radius
  const endY = child.y - child.radius
  const branchY = (startY + endY) / 2
  return `M ${parent.x} ${startY} L ${parent.x} ${branchY} L ${child.x} ${branchY} L ${child.x} ${endY}`
}

function panelSideFor(element: Element): 'left' | 'right' {
  const bounds = element.getBoundingClientRect()
  return bounds.left + bounds.width / 2 <= window.innerWidth / 2 ? 'right' : 'left'
}

function agentName(card: DashboardCard): string {
  return card.conversationName ?? (card.task.trim() || card.agentType)
}

function WorktreeDetails({
  project,
  worktree,
  onSelectAgent,
  onDone
}: Pick<AgentMapWorktreeRingNodeProps, 'project' | 'worktree' | 'onSelectAgent'> & {
  onDone: () => void
}): React.JSX.Element {
  const activeCount =
    worktree.statusCounts.working + worktree.statusCounts.blocked + worktree.statusCounts.waiting
  return (
    <PopoverContent align="center" sideOffset={10} className="w-80 p-0">
      <header className="border-b border-border px-3 py-2.5">
        <span className="block truncate text-[11px] text-muted-foreground">{project.name}</span>
        <strong className="block truncate text-[13px]">{worktree.name}</strong>
        <span className="mt-1 block text-[11px] text-muted-foreground">
          {translate(
            'dashboardPopout.map.worktreeSummary',
            '{{total}} agents · {{active}} active · {{done}} done',
            {
              count: worktree.agents.length,
              defaultValue_one: '{{total}} agent · {{active}} active · {{done}} done',
              defaultValue_other: '{{total}} agents · {{active}} active · {{done}} done',
              total: worktree.agents.length,
              active: activeCount,
              done: worktree.statusCounts.done
            }
          )}
        </span>
      </header>
      <section className="px-2 py-2">
        <h3 className="mb-1 px-1 text-[11px] font-semibold text-muted-foreground">
          {translate('dashboardPopout.map.runningAgents', 'Agents')}
        </h3>
        <div className="scrollbar-sleek max-h-56 space-y-0.5 overflow-y-auto">
          {worktree.agents.map((agent) => (
            <button
              key={agent.card.paneKey}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={(event) => {
                onSelectAgent(agent.card, panelSideFor(event.currentTarget))
                onDone()
              }}
            >
              <AgentIcon agent={agentTypeToIconAgent(agent.card.agentType)} size={14} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium">
                  {agentName(agent.card)}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {agentStateLabel(agent.status)} · {formatDuration(agent.durationMinutes)}
                </span>
              </span>
              <AgentStateDot state={agent.status} size="md" />
            </button>
          ))}
        </div>
      </section>
    </PopoverContent>
  )
}

export const AgentMapWorktreeRingNode = memo(function AgentMapWorktreeRingNode({
  project,
  worktree,
  zoom,
  labelScale,
  mapScale,
  selectedPaneKey,
  allowAggregation,
  nodeRefs,
  onSelectAgent,
  onOpenWorkspaceContextMenu,
  onAgentKeyDown
}: AgentMapWorktreeRingNodeProps): React.JSX.Element {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const selected = worktree.agents.some((agent) => agent.card.paneKey === selectedPaneKey)
  const aggregate = !selected && shouldAggregateAgentMapWorktree(worktree, zoom, allowAggregation)
  const agentsByPaneKey = new Map(worktree.agents.map((agent) => [agent.card.paneKey, agent]))
  const screenRadius = worktree.radius * mapScale
  const showLabel = !worktree.quiet || screenRadius >= 56
  const showCount = screenRadius >= 80

  return (
    <Popover open={detailsOpen} onOpenChange={setDetailsOpen}>
      <g className="agent-map-worktree-group">
        <PopoverTrigger asChild>
          <circle
            className={`agent-map-worktree-ring${selected ? ' is-selected' : ''}${detailsOpen ? ' is-open' : ''}`}
            cx={worktree.x}
            cy={worktree.y}
            r={worktree.radius}
            role="button"
            tabIndex={0}
            aria-label={
              worktree.workspaceKind === 'folder'
                ? translate(
                    'dashboardPopout.map.openFolderWorkspace',
                    'Open {{workspace}} folder workspace details',
                    { workspace: worktree.name }
                  )
                : translate(
                    'dashboardPopout.map.openWorktree',
                    'Open {{worktree}} worktree details',
                    { worktree: worktree.name }
                  )
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setDetailsOpen((open) => !open)
              }
            }}
            onContextMenu={
              onOpenWorkspaceContextMenu
                ? (event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setDetailsOpen(false)
                    onOpenWorkspaceContextMenu(event, worktree)
                  }
                : undefined
            }
          />
        </PopoverTrigger>
        <g
          className={`agent-map-worktree-label-group${showLabel ? ' is-visible' : ''}${showCount ? ' is-count-visible' : ''}`}
          transform={`translate(${worktree.x} ${worktree.y - worktree.radius}) scale(${labelScale})`}
        >
          <text className="agent-map-worktree-label" y={18}>
            {worktree.name}
          </text>
          <text className="agent-map-worktree-count" y={32}>
            {translate(
              'dashboardPopout.map.agentCount',
              worktree.agents.length === 1 ? '{{count}} agent' : '{{count}} agents',
              { count: worktree.agents.length }
            )}
          </text>
        </g>
        {aggregate ? (
          <g
            className="agent-map-aggregate-node"
            transform={`translate(${worktree.x} ${worktree.y + 7})`}
          >
            <circle r={Math.min(26, 12 + Math.sqrt(worktree.agents.length) * 2)} />
            <text y={3}>{worktree.agents.length}</text>
          </g>
        ) : (
          <>
            <g className="agent-map-lineage-links" aria-hidden>
              {worktree.agents.map((child) => {
                const parent = child.card.parentPaneKey
                  ? agentsByPaneKey.get(child.card.parentPaneKey)
                  : undefined
                return !parent || child.y <= parent.y ? null : (
                  <path
                    key={child.card.paneKey}
                    className="agent-map-lineage-link"
                    data-agent-map-lineage-link=""
                    data-parent-pane-key={parent.card.paneKey}
                    data-child-pane-key={child.card.paneKey}
                    d={lineagePath(parent, child)}
                  />
                )
              })}
            </g>
            {worktree.agents.map((agent) => {
              const iconSize = Math.max(12, Math.min(22, agent.radius * 1.05))
              return (
                <g
                  key={agent.card.paneKey}
                  ref={(node) => {
                    if (node) {
                      nodeRefs.current.set(agent.card.paneKey, node)
                    } else {
                      nodeRefs.current.delete(agent.card.paneKey)
                    }
                  }}
                  data-agent-map-agent=""
                  data-agent-provider={agent.card.agentType}
                  role="button"
                  tabIndex={0}
                  aria-label={`${agentName(agent.card)}, ${agentStateLabel(agent.status)}${agent.card.unseen ? ', unread' : ''}, ${formatDuration(agent.durationMinutes)}, ${worktree.name}, ${project.name}`}
                  className={`agent-map-agent-node fleet-status-${agent.status}${selectedPaneKey === agent.card.paneKey ? ' is-selected' : ''}`}
                  transform={`translate(${agent.x} ${agent.y})`}
                  onClick={(event) => onSelectAgent(agent.card, panelSideFor(event.currentTarget))}
                  onKeyDown={(event) => onAgentKeyDown(event, agent)}
                >
                  <circle className="agent-map-agent-hit" r={Math.max(10, agent.radius + 3)} />
                  <circle className="agent-map-agent-mark" r={agent.radius} />
                  <foreignObject
                    className="agent-map-agent-icon"
                    x={-iconSize / 2}
                    y={-iconSize / 2}
                    width={iconSize}
                    height={iconSize}
                  >
                    <div>
                      <AgentIcon
                        agent={agentTypeToIconAgent(agent.card.agentType)}
                        size={iconSize}
                      />
                    </div>
                  </foreignObject>
                  {agent.card.unseen ? (
                    <circle
                      className="agent-map-agent-unread-mark"
                      data-agent-unread-marker=""
                      cx={-agent.radius + 3}
                      cy={-agent.radius + 3}
                      r={4.5}
                      aria-hidden="true"
                    />
                  ) : null}
                </g>
              )
            })}
          </>
        )}
      </g>
      <WorktreeDetails
        project={project}
        worktree={worktree}
        onSelectAgent={onSelectAgent}
        onDone={() => setDetailsOpen(false)}
      />
    </Popover>
  )
})
