import { GitBranch } from 'lucide-react'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { RepoIcon } from '../../../../shared/repo-icon'
import { translate } from '@/i18n/i18n'
import { AgentKanbanCard } from './AgentKanbanCard'
import type { AgentKanbanLineageNode } from './agent-kanban-lineage'

type AgentKanbanLineageProps = {
  nodes: AgentKanbanLineageNode[]
} & AgentKanbanLineageContext

type AgentKanbanLineageContext = {
  cardsByPaneKey: Map<string, DashboardCard>
  repoIconsByRepoId: Record<string, RepoIcon | null> | undefined
  now: number
  onOpenTerminal: (card: DashboardCard) => void
}

function cardHeading(card: DashboardCard): string {
  return card.conversationName ?? card.worktreeName
}

function LineageNode({
  node,
  cardsByPaneKey,
  repoIconsByRepoId,
  now,
  onOpenTerminal,
  depth
}: AgentKanbanLineageContext & {
  node: AgentKanbanLineageNode
  depth: number
}): React.JSX.Element {
  const parent = node.card.parentPaneKey ? cardsByPaneKey.get(node.card.parentPaneKey) : undefined
  const crossColumnParent = depth === 0 && parent?.bucket !== node.card.bucket ? parent : undefined

  return (
    <div className="relative flex min-w-0 flex-col gap-2" data-lineage-depth={depth}>
      {depth > 0 ? (
        <span className="absolute -left-3 top-5 w-3 border-t border-border" aria-hidden />
      ) : null}
      {crossColumnParent ? (
        <div className="flex min-w-0 items-center gap-1 px-1 text-[10px] text-muted-foreground">
          <GitBranch className="size-3 shrink-0" aria-hidden />
          <span className="truncate">
            {translate('dashboardPopout.card.spawnedBy', 'Spawned by {{name}}', {
              name: cardHeading(crossColumnParent)
            })}
          </span>
        </div>
      ) : null}
      <AgentKanbanCard
        card={node.card}
        repoIcon={repoIconsByRepoId?.[node.card.repoId] ?? null}
        now={now}
        onOpenTerminal={onOpenTerminal}
      />
      {node.children.length ? (
        <div className="ml-4 flex min-w-0 flex-col gap-2 border-l border-border pl-3">
          {node.children.map((child) => (
            <LineageNode
              key={child.card.paneKey}
              node={child}
              cardsByPaneKey={cardsByPaneKey}
              repoIconsByRepoId={repoIconsByRepoId}
              now={now}
              onOpenTerminal={onOpenTerminal}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function AgentKanbanLineage(props: AgentKanbanLineageProps): React.JSX.Element {
  return (
    <>
      {props.nodes.map((node) => (
        <LineageNode key={node.card.paneKey} {...props} node={node} depth={0} />
      ))}
    </>
  )
}
