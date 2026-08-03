import { useCallback, useEffect, useMemo, useRef } from 'react'
import { agentStateLabel } from '@/components/AgentStateDot'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { formatAgentTypeLabel } from '@/lib/agent-status'
import { cn } from '@/lib/utils'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { askLine, buildAgentCellSections, type AgentCellWorktree } from './agent-cell-model'
import './agent-cell-map.css'

type AgentCellMapProps = {
  cards: DashboardCard[]
  now: number
  className?: string
  selectedPaneKey?: string | null
  onOpenTerminal: (card: DashboardCard, side: 'left' | 'right') => void
}

/** Which half of the window the click landed in — the panel opens opposite it. */
function panelSideFor(element: HTMLElement): 'left' | 'right' {
  const bounds = element.getBoundingClientRect()
  return bounds.left + bounds.width / 2 <= window.innerWidth / 2 ? 'right' : 'left'
}

function agentName(card: DashboardCard): string {
  return card.conversationName ?? formatAgentTypeLabel(card.agentType)
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

/** An agent as light: the orb carries the state, the tooltip carries the words. */
function AgentCellOrb({
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
          className={cn(
            'agent-cell-orb',
            `fleet-status-${card.dotState}`,
            selected && 'is-selected'
          )}
          aria-label={`${agentName(card)}, ${agentStateLabel(card.dotState)}`}
          aria-pressed={selected}
          onClick={(event) => onOpenTerminal(card, panelSideFor(event.currentTarget))}
        />
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        <span className="font-medium">{agentName(card)}</span>
        <span className="ml-1.5 text-muted-foreground">{agentStateLabel(card.dotState)}</span>
      </TooltipContent>
    </Tooltip>
  )
}

function AgentCellAsk({
  card,
  text,
  now,
  onOpenTerminal
}: {
  card: DashboardCard
  text: string
  now: number
  onOpenTerminal: (card: DashboardCard, side: 'left' | 'right') => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="agent-cell-ask"
      aria-label={translate('dashboardPopout.cells.ask', 'Open the question from {{agent}}', {
        agent: agentName(card)
      })}
      onClick={(event) => onOpenTerminal(card, panelSideFor(event.currentTarget))}
    >
      <span
        className={cn('agent-cell-orb is-static', `fleet-status-${card.dotState}`)}
        aria-hidden
      />
      <span className="agent-cell-ask-text">{text}</span>
      <time className="agent-cell-ask-age">
        {formatResponseAge(card.stateChangedAt || card.startedAt, now)}
      </time>
    </button>
  )
}

function AgentCellWorktreeCard({
  worktree,
  now,
  selectedPaneKey,
  setNodeRef,
  onOpenTerminal
}: {
  worktree: AgentCellWorktree
  now: number
  selectedPaneKey: string | null
  setNodeRef: (paneKey: string, node: HTMLButtonElement | null) => void
  onOpenTerminal: (card: DashboardCard, side: 'left' | 'right') => void
}): React.JSX.Element {
  const asks = worktree.cards.flatMap((card) => {
    const text = askLine(card)
    return text ? [{ card, text }] : []
  })
  return (
    <article
      className="agent-cell-worktree"
      data-worst={worktree.worstDotState}
      data-testid="agent-cell-worktree"
    >
      <header className="agent-cell-worktree-head">
        <h3 title={worktree.name}>{worktree.name}</h3>
        <span
          className="agent-cell-worktree-count"
          aria-label={translate('dashboardPopout.cells.agentCount', '{{count}} agents', {
            count: worktree.cards.length
          })}
        >
          {worktree.cards.length}
        </span>
      </header>
      <div className="agent-cell-orbs">
        {worktree.cards.map((card) => (
          <AgentCellOrb
            key={card.paneKey}
            card={card}
            selected={card.paneKey === selectedPaneKey}
            setNodeRef={(node) => setNodeRef(card.paneKey, node)}
            onOpenTerminal={onOpenTerminal}
          />
        ))}
      </div>
      {asks.map(({ card, text }) => (
        <AgentCellAsk
          key={card.paneKey}
          card={card}
          text={text}
          now={now}
          onOpenTerminal={onOpenTerminal}
        />
      ))}
    </article>
  )
}

/**
 * The fleet as glass: one section per repo, one cell per worktree, agents as
 * orbs. Words appear only where an agent is waiting on the user.
 */
export function AgentCellMap({
  cards,
  now,
  className,
  selectedPaneKey = null,
  onOpenTerminal
}: AgentCellMapProps): React.JSX.Element {
  const sections = useMemo(() => buildAgentCellSections(cards), [cards])
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

  if (sections.length === 0) {
    return (
      <div
        className={cn(
          'grid min-h-0 flex-1 place-items-center text-xs text-muted-foreground',
          className
        )}
      >
        {translate('dashboardPopout.map.empty', 'No agents match the current filters.')}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'agent-cell-map scrollbar-sleek min-h-0 min-w-0 flex-1 overflow-auto',
        className
      )}
    >
      {sections.map((section) => (
        <section key={section.id} className="agent-cell-section" data-testid="agent-cell-project">
          <header className="agent-cell-section-head">
            <h2 title={section.name}>{section.name}</h2>
            <span>
              {translate(
                'dashboardPopout.cells.sectionMeta',
                '{{worktrees}} worktrees · {{agents}} agents',
                { worktrees: section.worktrees.length, agents: section.agentCount }
              )}
            </span>
          </header>
          <div className="agent-cell-grid">
            {section.worktrees.map((worktree) => (
              <AgentCellWorktreeCard
                key={worktree.id}
                worktree={worktree}
                now={now}
                selectedPaneKey={selectedPaneKey}
                setNodeRef={setNodeRef}
                onOpenTerminal={onOpenTerminal}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
