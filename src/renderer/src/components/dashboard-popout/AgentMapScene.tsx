import { memo, type MutableRefObject } from 'react'
import { RepoIconGlyph } from '@/components/repo/repo-icon'
import { translate } from '@/i18n/i18n'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { RepoIcon } from '../../../../shared/repo-icon'
import type {
  AgentMapAgentNode,
  AgentMapLayout,
  AgentMapProjectRing,
  AgentMapWorktreeRing
} from './agent-map-layout'
import { AgentMapWorktreeRingNode } from './AgentMapWorktreeRingNode'

type AgentMapSceneProps = {
  layout: AgentMapLayout
  repoIconsByRepoId?: Record<string, RepoIcon | null>
  zoom: number
  labelScale: number
  mapScale: number
  selectedPaneKey: string | null
  allowAggregation: boolean
  nodeRefs: MutableRefObject<Map<string, SVGGElement>>
  onSelectAgent: (card: DashboardCard, side: 'left' | 'right') => void
  onOpenProjectContextMenu?: (
    event: React.MouseEvent<SVGCircleElement>,
    project: AgentMapProjectRing
  ) => void
  onOpenWorkspaceContextMenu?: (
    event: React.MouseEvent<SVGCircleElement>,
    worktree: AgentMapWorktreeRing
  ) => void
  onAgentKeyDown: (event: React.KeyboardEvent<SVGGElement>, agent: AgentMapAgentNode) => void
}

function worktreeLineagePath(parent: AgentMapWorktreeRing, child: AgentMapWorktreeRing): string {
  const startY = parent.y + parent.radius
  const endY = child.y - child.radius
  const branchY = (startY + endY) / 2
  return `M ${parent.x} ${startY} C ${parent.x} ${branchY} ${child.x} ${branchY} ${child.x} ${endY}`
}

/** Memoization keeps pointer panning to one SVG viewBox write, not a map rerender. */
export const AgentMapScene = memo(function AgentMapScene({
  layout,
  repoIconsByRepoId,
  zoom,
  labelScale,
  mapScale,
  selectedPaneKey,
  allowAggregation,
  nodeRefs,
  onSelectAgent,
  onOpenProjectContextMenu,
  onOpenWorkspaceContextMenu,
  onAgentKeyDown
}: AgentMapSceneProps): React.JSX.Element {
  return (
    <>
      {layout.projects.map((project) => {
        const worktreesById = new Map(project.worktrees.map((worktree) => [worktree.id, worktree]))
        return (
          <g key={project.id}>
            <circle
              className="agent-map-project-ring"
              data-agent-map-project=""
              cx={project.x}
              cy={project.y}
              r={project.radius}
              onContextMenu={
                onOpenProjectContextMenu
                  ? (event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      onOpenProjectContextMenu(event, project)
                    }
                  : undefined
              }
            />
            <g
              transform={`translate(${project.x} ${project.y - project.radius}) scale(${labelScale})`}
            >
              <foreignObject
                className="agent-map-project-label-frame"
                x={-project.radius}
                y={3}
                width={project.radius * 2}
                height={18}
              >
                <div className="agent-map-project-label">
                  <RepoIconGlyph
                    repoIcon={repoIconsByRepoId?.[project.id] ?? null}
                    className="size-3 shrink-0"
                    iconClassName="size-3"
                  />
                  <span className="shrink-0">{project.name.toUpperCase()}</span>
                </div>
              </foreignObject>
              <text className="agent-map-project-count" y={32}>
                {translate(
                  'dashboardPopout.map.projectCount',
                  '{{agents}} agents · {{workspaces}} workspaces',
                  { agents: project.agentCount, workspaces: project.worktrees.length }
                ).toUpperCase()}
              </text>
            </g>
            <g className="agent-map-worktree-lineage-links" aria-hidden>
              {project.worktrees.map((child) => {
                const parent = child.parentId ? worktreesById.get(child.parentId) : undefined
                return !parent || child.y <= parent.y ? null : (
                  <path
                    key={child.id}
                    className="agent-map-worktree-lineage-link"
                    data-agent-map-worktree-lineage-link=""
                    data-parent-worktree-id={parent.worktreeId}
                    data-child-worktree-id={child.worktreeId}
                    d={worktreeLineagePath(parent, child)}
                  />
                )
              })}
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
        )
      })}
    </>
  )
})
