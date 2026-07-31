import { useCallback, useEffect, useMemo, useRef } from 'react'
import { AgentStateDot, agentStateLabel } from '@/components/AgentStateDot'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent, formatAgentTypeLabel } from '@/lib/agent-status'
import { cn } from '@/lib/utils'
import type { DashboardBucket, DashboardCard } from '../../../../shared/dashboard-snapshot'
import './agent-cell-map.css'

type AgentCellMapProps = {
  cards: DashboardCard[]
  now: number
  className?: string
  selectedPaneKey?: string | null
  onOpenTerminal: (card: DashboardCard, side: 'left' | 'right') => void
}

type WorktreeCell = {
  id: string
  name: string
  cards: DashboardCard[]
  lastResponseAt: number
}

type ProjectCell = {
  id: string
  name: string
  worktrees: WorktreeCell[]
  agentCount: number
}

const BUCKET_PRIORITY: Record<DashboardBucket, number> = {
  attention: 0,
  working: 1,
  done: 2,
  idle: 3
}

function compareCards(a: DashboardCard, b: DashboardCard): number {
  return (
    BUCKET_PRIORITY[a.bucket] - BUCKET_PRIORITY[b.bucket] || b.stateChangedAt - a.stateChangedAt
  )
}

function responseTimestamp(card: DashboardCard): number {
  if (card.finishedAt && card.finishedAt > 0) {
    return card.finishedAt
  }
  return card.stateChangedAt > 0 ? card.stateChangedAt : card.startedAt
}

function formatResponseAge(timestamp: number, now: number): string {
  if (timestamp <= 0) {
    return '—'
  }
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 60) {
    return translate('dashboardPopout.card.time.justNow', 'just now')
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return translate('dashboardPopout.card.time.minutes', '{{count}}m', { count: minutes })
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return translate('dashboardPopout.card.time.hours', '{{count}}h', { count: hours })
  }
  return translate('dashboardPopout.card.time.days', '{{count}}d', {
    count: Math.floor(hours / 24)
  })
}

function buildProjectCells(cards: DashboardCard[]): ProjectCell[] {
  const projects = new Map<string, DashboardCard[]>()
  for (const card of cards) {
    projects.set(card.repoId, [...(projects.get(card.repoId) ?? []), card])
  }
  return [...projects.entries()]
    .map(([id, projectCards]) => {
      const worktrees = new Map<string, DashboardCard[]>()
      for (const card of projectCards) {
        worktrees.set(card.worktreeId, [...(worktrees.get(card.worktreeId) ?? []), card])
      }
      return {
        id,
        name: projectCards[0]?.repoName ?? id,
        agentCount: projectCards.length,
        worktrees: [...worktrees.entries()]
          .map(([worktreeId, worktreeCards]) => ({
            id: worktreeId,
            name: worktreeCards[0]?.worktreeName ?? worktreeId,
            cards: [...worktreeCards].sort(compareCards),
            lastResponseAt: Math.max(...worktreeCards.map(responseTimestamp))
          }))
          .sort(
            (a, b) =>
              compareCards(a.cards[0], b.cards[0]) ||
              b.cards.length - a.cards.length ||
              a.name.localeCompare(b.name)
          )
      }
    })
    .sort((a, b) => b.agentCount - a.agentCount || a.name.localeCompare(b.name))
}

function worktreeTone(cards: DashboardCard[]): string {
  if (cards.some((card) => card.bucket === 'attention')) {
    return 'has-attention'
  }
  if (cards.some((card) => card.bucket === 'working')) {
    return 'has-working'
  }
  return cards.every((card) => card.dotState === 'done') ? 'has-done' : ''
}

function worktreeSize(agentCount: number): string {
  if (agentCount >= 9) {
    return 'is-large'
  }
  return agentCount >= 5 ? 'is-medium' : ''
}

function agentName(card: DashboardCard): string {
  return card.conversationName ?? formatAgentTypeLabel(card.agentType)
}

function AgentCellNode({
  card,
  selected,
  setNodeRef,
  onOpenTerminal
}: {
  card: DashboardCard
  selected: boolean
  setNodeRef: (node: HTMLButtonElement | null) => void
  onOpenTerminal: (card: DashboardCard, side: 'left' | 'right') => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={setNodeRef}
          type="button"
          className={`agent-cell-node fleet-status-${card.dotState}`}
          aria-label={`${agentName(card)}, ${agentStateLabel(card.dotState)}`}
          aria-pressed={selected}
          data-selected={selected}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect()
            const side = bounds.left + bounds.width / 2 <= window.innerWidth / 2 ? 'right' : 'left'
            onOpenTerminal(card, side)
          }}
        >
          <AgentIcon agent={agentTypeToIconAgent(card.agentType)} size={18} />
          <span className="agent-cell-node-state">
            <AgentStateDot state={card.dotState} size="md" />
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        <span className="font-medium">{agentName(card)}</span>
        <span className="ml-1.5 text-muted-foreground">{agentStateLabel(card.dotState)}</span>
      </TooltipContent>
    </Tooltip>
  )
}

export function AgentCellMap({
  cards,
  now,
  className,
  selectedPaneKey = null,
  onOpenTerminal
}: AgentCellMapProps): React.JSX.Element {
  const projects = useMemo(() => buildProjectCells(cards), [cards])
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>())
  const setNodeRef = useCallback((paneKey: string, node: HTMLButtonElement | null) => {
    if (node) {
      nodeRefs.current.set(paneKey, node)
    } else {
      nodeRefs.current.delete(paneKey)
    }
  }, [])

  useEffect(() => {
    if (!selectedPaneKey) {
      return
    }
    const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth'
    nodeRefs.current
      .get(selectedPaneKey)
      ?.scrollIntoView?.({ behavior, block: 'center', inline: 'center' })
  }, [selectedPaneKey])

  if (projects.length === 0) {
    return (
      <div
        className={cn(
          'grid min-h-0 flex-1 place-items-center text-xs text-muted-foreground',
          className
        )}
      >
        {translate('dashboardPopout.rings.empty', 'No agents match the current filters.')}
      </div>
    )
  }

  return (
    <div
      className={cn('agent-cell-map scrollbar-sleek min-h-0 flex-1 overflow-auto p-3', className)}
    >
      <div className="agent-cell-projects">
        {projects.map((project) => (
          <section
            key={project.id}
            className="agent-cell-project"
            style={{ flexGrow: Math.sqrt(project.agentCount) }}
            data-testid="agent-cell-project"
          >
            <header className="flex items-baseline gap-2 border-b border-border px-3 py-2.5">
              <h2 className="truncate text-[13px] font-semibold">{project.name}</h2>
              <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {translate(
                  'dashboardPopout.rings.projectCount',
                  '{{agents}} agents · {{workspaces}} workspaces',
                  {
                    agents: project.agentCount,
                    workspaces: project.worktrees.length
                  }
                )}
              </span>
            </header>
            <div className="agent-cell-worktrees">
              {project.worktrees.map((worktree) => (
                <article
                  key={worktree.id}
                  className={cn(
                    'agent-cell-worktree',
                    worktreeTone(worktree.cards),
                    worktreeSize(worktree.cards.length),
                    worktree.cards.some((card) => card.paneKey === selectedPaneKey) && 'is-selected'
                  )}
                  data-testid="agent-cell-worktree"
                >
                  <header className="flex min-w-0 items-center gap-2">
                    <h3 className="truncate text-xs font-medium" title={worktree.name}>
                      {worktree.name}
                    </h3>
                    <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
                      {formatResponseAge(worktree.lastResponseAt, now)}
                    </span>
                  </header>
                  <div className="flex flex-wrap content-start gap-1.5">
                    {worktree.cards.map((card) => (
                      <AgentCellNode
                        key={card.paneKey}
                        card={card}
                        selected={card.paneKey === selectedPaneKey}
                        setNodeRef={(node) => setNodeRef(card.paneKey, node)}
                        onOpenTerminal={onOpenTerminal}
                      />
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
