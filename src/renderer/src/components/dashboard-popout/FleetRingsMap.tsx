import type { MutableRefObject } from 'react'
import { AgentStateDot, agentStateLabel } from '@/components/AgentStateDot'
import { translate } from '@/i18n/i18n'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent } from '@/lib/agent-status'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { FleetAgentNode, FleetRingsLayout, FleetWorktreeRing } from './fleet-rings-layout'
import { shouldAggregateFleetWorktree } from './fleet-rings-layout'

type FleetRingsMapProps = {
  layout: FleetRingsLayout
  zoom: number
  labelScale: number
  mapScale: number
  selectedPaneKey: string | null
  allowAggregation: boolean
  nodeRefs: MutableRefObject<Map<string, SVGGElement>>
  onSelectAgent: (card: DashboardCard, side: 'left' | 'right') => void
  onFocusWorktree: (worktree: FleetWorktreeRing) => void
  onAgentKeyDown: (
    event: React.KeyboardEvent<SVGGElement>,
    agent: FleetAgentNode,
    worktree: FleetWorktreeRing
  ) => void
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

function lineagePath(parent: FleetAgentNode, child: FleetAgentNode): string {
  const startY = parent.y + parent.radius
  const endY = child.y - child.radius
  const branchY = (startY + endY) / 2
  return `M ${parent.x} ${startY} L ${parent.x} ${branchY} L ${child.x} ${branchY} L ${child.x} ${endY}`
}

export function FleetRingsMap({
  layout,
  zoom,
  labelScale,
  mapScale,
  selectedPaneKey,
  allowAggregation,
  nodeRefs,
  onSelectAgent,
  onFocusWorktree,
  onAgentKeyDown
}: FleetRingsMapProps): React.JSX.Element {
  return (
    <>
      {layout.projects.map((project) => (
        <g key={project.id}>
          <circle className="fleet-project-ring" cx={project.x} cy={project.y} r={project.radius} />
          <g
            transform={`translate(${project.x} ${project.y - project.radius}) scale(${labelScale})`}
          >
            <text className="fleet-project-label" y={18}>
              {project.name.toUpperCase()}
            </text>
            <text className="fleet-project-count" y={32}>
              {translate(
                'dashboardPopout.rings.projectCount',
                '{{agents}} agents · {{workspaces}} workspaces',
                {
                  agents: project.agentCount,
                  workspaces: project.worktrees.length
                }
              ).toUpperCase()}
            </text>
          </g>
          {project.worktrees.map((worktree) => {
            const aggregate = shouldAggregateFleetWorktree(worktree, zoom, allowAggregation)
            const selected = worktree.agents.some((agent) => agent.card.paneKey === selectedPaneKey)
            const agentsByPaneKey = new Map(
              worktree.agents.map((agent) => [agent.card.paneKey, agent])
            )
            const screenRadius = worktree.radius * mapScale
            const showLabel = !worktree.quiet || screenRadius >= 56
            const showCount = screenRadius >= 80
            return (
              <g key={worktree.id} className="fleet-worktree-group">
                <circle
                  className={`fleet-worktree-ring${selected ? ' is-selected' : ''}`}
                  cx={worktree.x}
                  cy={worktree.y}
                  r={worktree.radius}
                  onDoubleClick={() => onFocusWorktree(worktree)}
                />
                <g
                  className={`fleet-worktree-label-group${showLabel ? ' is-visible' : ''}${showCount ? ' is-count-visible' : ''}`}
                  transform={`translate(${worktree.x} ${worktree.y - worktree.radius}) scale(${labelScale})`}
                >
                  <text className="fleet-worktree-label" y={18}>
                    {worktree.name}
                  </text>
                  <text className="fleet-worktree-count" y={32}>
                    {translate('dashboardPopout.rings.agentCount', '{{count}} agents', {
                      count: worktree.agents.length
                    })}
                  </text>
                </g>
                {aggregate ? (
                  <g
                    className="fleet-aggregate-node"
                    transform={`translate(${worktree.x} ${worktree.y + 7})`}
                  >
                    <circle r={Math.min(26, 12 + Math.sqrt(worktree.agents.length) * 2)} />
                    <text y={3}>{worktree.agents.length}</text>
                  </g>
                ) : (
                  <>
                    <g className="fleet-agent-lineage-links" aria-hidden>
                      {worktree.agents.map((child) => {
                        const parent = child.card.parentPaneKey
                          ? agentsByPaneKey.get(child.card.parentPaneKey)
                          : undefined
                        if (!parent || child.y <= parent.y) {
                          return null
                        }
                        return (
                          <path
                            key={child.card.paneKey}
                            className="fleet-agent-lineage-link"
                            data-fleet-agent-lineage-link=""
                            data-parent-pane-key={parent.card.paneKey}
                            data-child-pane-key={child.card.paneKey}
                            d={lineagePath(parent, child)}
                          />
                        )
                      })}
                    </g>
                    {worktree.agents.map((agent) => {
                      const iconSize = Math.max(12, Math.min(22, agent.radius * 1.05))
                      const stateMarkerSize = 14
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
                          data-fleet-agent=""
                          data-agent-provider={agent.card.agentType}
                          role="button"
                          tabIndex={0}
                          aria-label={`${agent.card.conversationName ?? agent.card.agentType}, ${agentStateLabel(agent.status)}, ${formatDuration(agent.durationMinutes)}, ${worktree.name}, ${project.name}`}
                          className={`fleet-agent-node fleet-status-${agent.status}${selectedPaneKey === agent.card.paneKey ? ' is-selected' : ''}`}
                          transform={`translate(${agent.x} ${agent.y})`}
                          onClick={(event) => {
                            const bounds = event.currentTarget.getBoundingClientRect()
                            const side =
                              bounds.left + bounds.width / 2 <= window.innerWidth / 2
                                ? 'right'
                                : 'left'
                            onSelectAgent(agent.card, side)
                          }}
                          onKeyDown={(event) => onAgentKeyDown(event, agent, worktree)}
                        >
                          <circle className="fleet-agent-hit" r={Math.max(10, agent.radius + 3)} />
                          <circle className="fleet-agent-mark" r={agent.radius} />
                          <foreignObject
                            className="fleet-agent-icon"
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
                          <foreignObject
                            className="fleet-agent-state"
                            x={-agent.radius - 4}
                            y={-agent.radius - 4}
                            width={stateMarkerSize}
                            height={stateMarkerSize}
                            aria-hidden
                          >
                            <div>
                              <AgentStateDot state={agent.status} size="md" />
                            </div>
                          </foreignObject>
                        </g>
                      )
                    })}
                  </>
                )}
              </g>
            )
          })}
        </g>
      ))}
    </>
  )
}
