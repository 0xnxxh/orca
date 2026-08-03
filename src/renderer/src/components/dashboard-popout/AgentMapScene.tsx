import { memo, type MutableRefObject } from 'react'
import { translate } from '@/i18n/i18n'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { AgentMapAgentNode, AgentMapLayout, AgentMapWorktreeRing } from './agent-map-layout'
import { AgentMapWorktreeRingNode } from './AgentMapWorktreeRingNode'

type AgentMapSceneProps = {
  layout: AgentMapLayout
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

/** Memoization keeps pointer panning to one SVG viewBox write, not a map rerender. */
export const AgentMapScene = memo(function AgentMapScene({
  layout,
  zoom,
  labelScale,
  mapScale,
  selectedPaneKey,
  allowAggregation,
  nodeRefs,
  onSelectAgent,
  onOpenWorkspaceContextMenu,
  onAgentKeyDown
}: AgentMapSceneProps): React.JSX.Element {
  return (
    <>
      {layout.projects.map((project) => (
        <g key={project.id}>
          <circle
            className="agent-map-project-ring"
            cx={project.x}
            cy={project.y}
            r={project.radius}
          />
          <g
            transform={`translate(${project.x} ${project.y - project.radius}) scale(${labelScale})`}
          >
            <text className="agent-map-project-label" y={18}>
              {project.name.toUpperCase()}
            </text>
            <text className="agent-map-project-count" y={32}>
              {translate(
                'dashboardPopout.map.projectCount',
                '{{agents}} agents · {{workspaces}} workspaces',
                { agents: project.agentCount, workspaces: project.worktrees.length }
              ).toUpperCase()}
            </text>
          </g>
          {project.worktrees.map((worktree) => (
            <AgentMapWorktreeRingNode
              key={worktree.id}
              project={project}
              worktree={worktree}
              zoom={zoom}
              labelScale={labelScale}
              mapScale={mapScale}
              selectedPaneKey={selectedPaneKey}
              allowAggregation={allowAggregation}
              nodeRefs={nodeRefs}
              onSelectAgent={onSelectAgent}
              onOpenWorkspaceContextMenu={onOpenWorkspaceContextMenu}
              onAgentKeyDown={onAgentKeyDown}
            />
          ))}
        </g>
      ))}
    </>
  )
})
