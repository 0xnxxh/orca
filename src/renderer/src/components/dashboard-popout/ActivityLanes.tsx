import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent, formatAgentTypeLabel } from '@/lib/agent-status'
import { AgentStateDot, agentStateLabel } from '@/components/AgentStateDot'
import { AgentWorkingSpinner } from '@/components/AgentWorkingSpinner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import {
  activityDurationMs,
  activityTimelineBounds,
  buildActivityLanes,
  filterActivityLaneCards,
  type ActivityLane,
  type ActivityLaneRecentMinutes,
  type ActivityLaneStatusFilter
} from './activity-lane-model'
import './activity-lanes.css'

type ActivityLanesProps = {
  cards: DashboardCard[]
  now: number
  className?: string
  selectedPaneKey?: string | null
  onOpenTerminal: (card: DashboardCard, side: 'left' | 'right') => void
}

const LANE_ROW_HEIGHT = 38
const LANE_LINE_Y = 26

function agentName(card: DashboardCard): string {
  return card.conversationName ?? formatAgentTypeLabel(card.agentType)
}

function formatCompactDuration(durationMs: number): string {
  const minutes = Math.max(1, Math.round(durationMs / 60_000))
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours < 24) {
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`
  }
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function formatResponseAge(card: DashboardCard, now: number): string {
  if (!card.lastResponseAt || card.lastResponseAt <= 0) {
    return translate('dashboardPopout.lanes.responseUnknown', 'response time unavailable')
  }
  const seconds = Math.max(0, Math.floor((now - card.lastResponseAt) / 1_000))
  if (seconds < 60) {
    return translate('dashboardPopout.lanes.responseNow', 'response just now')
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return translate('dashboardPopout.lanes.responseMinutes', '{{count}}m since response', {
      count: minutes
    })
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return translate('dashboardPopout.lanes.responseHours', '{{count}}h since response', {
      count: hours
    })
  }
  return translate('dashboardPopout.lanes.responseDays', '{{count}}d since response', {
    count: Math.floor(hours / 24)
  })
}

function formatTick(
  timestamp: number,
  recentMinutes: ActivityLaneRecentMinutes,
  now: number
): string {
  if (timestamp === now) {
    return translate('dashboardPopout.lanes.now', 'Now')
  }
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    ...(recentMinutes <= 120 ? { minute: '2-digit' } : {})
  })
}

function LaneStateMarker({ card }: { card: DashboardCard }): React.JSX.Element {
  if (card.dotState === 'working') {
    return <AgentWorkingSpinner className="size-2.5" />
  }
  return <AgentStateDot state={card.dotState} />
}

function ActivityLaneRow({
  card,
  lane,
  now,
  recentMinutes,
  selected,
  onOpenTerminal
}: {
  card: DashboardCard
  lane: ActivityLane
  now: number
  recentMinutes: ActivityLaneRecentMinutes
  selected: boolean
  onOpenTerminal: (card: DashboardCard, side: 'left' | 'right') => void
}): React.JSX.Element {
  const bounds = activityTimelineBounds(card, now, recentMinutes)
  const labelLeft = bounds.startPercent > 70
  const isChild = Boolean(
    card.parentPaneKey && lane.cards.some((item) => item.paneKey === card.parentPaneKey)
  )
  const differentWorktree = card.worktreeName !== lane.worktreeName
  const responseTickVisible =
    bounds.responsePercent !== null &&
    bounds.responsePercent > bounds.lineStartPercent + 0.6 &&
    bounds.responsePercent < bounds.endPercent - 0.6
  const style = {
    '--lane-start': `${bounds.startPercent}%`,
    '--lane-end': `${bounds.endPercent}%`,
    '--lane-line-start': `${bounds.lineStartPercent}%`,
    '--lane-width': `${bounds.widthPercent}%`,
    '--lane-response': `${bounds.responsePercent ?? 0}%`
  } as React.CSSProperties

  return (
    <button
      type="button"
      className={cn(
        'activity-lane-agent',
        `fleet-status-${card.dotState}`,
        bounds.clippedStart && 'is-clipped-start',
        selected && 'is-selected'
      )}
      style={style}
      aria-label={`${agentName(card)}, ${formatCompactDuration(activityDurationMs(card, now))}, ${agentStateLabel(card.dotState)}`}
      aria-pressed={selected}
      onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect()
        const side = bounds.left + bounds.width / 2 <= window.innerWidth / 2 ? 'right' : 'left'
        onOpenTerminal(card, side)
      }}
    >
      <span className={cn('activity-lane-agent-label', labelLeft && 'is-left')}>
        <strong>{agentName(card)}</strong>
        <small>
          {formatCompactDuration(activityDurationMs(card, now))} · {formatResponseAge(card, now)}
          {isChild
            ? differentWorktree
              ? ` · ${card.worktreeName}`
              : ` · ${translate('dashboardPopout.lanes.child', 'child agent')}`
            : ''}
        </small>
      </span>
      <span className="activity-lane-segment" aria-hidden />
      {responseTickVisible ? <span className="activity-lane-response" aria-hidden /> : null}
      <span className="activity-lane-endpoint" aria-hidden>
        <LaneStateMarker card={card} />
      </span>
      <span className="activity-lane-agent-icon" aria-hidden>
        <AgentIcon agent={agentTypeToIconAgent(card.agentType)} size={13} />
      </span>
    </button>
  )
}

function LaneConnections({
  lane,
  now,
  recentMinutes
}: {
  lane: ActivityLane
  now: number
  recentMinutes: ActivityLaneRecentMinutes
}): React.JSX.Element | null {
  const rowByPaneKey = new Map(lane.cards.map((card, index) => [card.paneKey, index]))
  const paths = lane.cards.flatMap((card, index) => {
    const parentIndex = card.parentPaneKey ? rowByPaneKey.get(card.parentPaneKey) : undefined
    if (parentIndex === undefined) {
      return []
    }
    const x = activityTimelineBounds(card, now, recentMinutes).startPercent
    return [
      <path
        key={card.paneKey}
        d={`M ${x} ${parentIndex * LANE_ROW_HEIGHT + LANE_LINE_Y} V ${index * LANE_ROW_HEIGHT + LANE_LINE_Y}`}
      />
    ]
  })
  if (paths.length === 0) {
    return null
  }
  return (
    <svg
      className="activity-lane-lineage"
      viewBox={`0 0 100 ${lane.cards.length * LANE_ROW_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {paths}
    </svg>
  )
}

function ActivityLaneSection({
  lane,
  now,
  recentMinutes,
  selectedPaneKey,
  onOpenTerminal
}: {
  lane: ActivityLane
  now: number
  recentMinutes: ActivityLaneRecentMinutes
  selectedPaneKey: string | null
  onOpenTerminal: (card: DashboardCard, side: 'left' | 'right') => void
}): React.JSX.Element {
  return (
    <section className="activity-lane">
      <header className="activity-lane-heading">
        <strong>{lane.worktreeName}</strong>
        <span>
          {lane.repoName} ·{' '}
          {translate('dashboardPopout.lanes.agentCount', '{{count}} agents', {
            count: lane.cards.length
          })}
        </span>
      </header>
      <div className="activity-lane-track">
        <LaneConnections lane={lane} now={now} recentMinutes={recentMinutes} />
        {lane.cards.map((card) => (
          <ActivityLaneRow
            key={card.paneKey}
            card={card}
            lane={lane}
            now={now}
            recentMinutes={recentMinutes}
            selected={selectedPaneKey === card.paneKey}
            onOpenTerminal={onOpenTerminal}
          />
        ))}
      </div>
    </section>
  )
}

function recentMinutesFromValue(value: string): ActivityLaneRecentMinutes {
  return value === '30' ? 30 : value === '120' ? 120 : 1_440
}

function statusFromValue(value: string): ActivityLaneStatusFilter {
  return value === 'attention' || value === 'working' || value === 'done' || value === 'idle'
    ? value
    : 'all'
}

export function ActivityLanes({
  cards,
  now,
  className,
  selectedPaneKey = null,
  onOpenTerminal
}: ActivityLanesProps): React.JSX.Element {
  const [recentMinutes, setRecentMinutes] = useState<ActivityLaneRecentMinutes>(1_440)
  const [status, setStatus] = useState<ActivityLaneStatusFilter>('all')
  const [showOlder, setShowOlder] = useState(false)
  const visibleCards = useMemo(
    () => filterActivityLaneCards(cards, { now, recentMinutes, status, showOlder }),
    [cards, now, recentMinutes, showOlder, status]
  )
  const withOlder = useMemo(
    () => filterActivityLaneCards(cards, { now, recentMinutes, status, showOlder: true }),
    [cards, now, recentMinutes, status]
  )
  const lanes = useMemo(() => buildActivityLanes(visibleCards), [visibleCards])
  const hiddenOlderCount = Math.max(0, withOlder.length - visibleCards.length)
  const rangeStart = now - recentMinutes * 60_000
  const ticks = Array.from(
    { length: 5 },
    (_, index) => rangeStart + ((now - rangeStart) * index) / 4
  )

  return (
    <div
      className={cn(
        'activity-lanes-shell scrollbar-sleek min-h-0 min-w-0 flex-1 overflow-auto',
        className
      )}
    >
      <div className="activity-lanes">
        <div className="activity-lanes-controls">
          <span className="activity-lanes-result">
            {translate('dashboardPopout.lanes.shown', '{{count}} shown', {
              count: visibleCards.length
            })}
            {!showOlder && hiddenOlderCount > 0
              ? ` · ${translate('dashboardPopout.lanes.olderHidden', '{{count}} older hidden', { count: hiddenOlderCount })}`
              : ''}
          </span>
          <label className="activity-lanes-filter">
            <span>{translate('dashboardPopout.lanes.status', 'Status')}</span>
            <Select value={status} onValueChange={(value) => setStatus(statusFromValue(value))}>
              <SelectTrigger size="sm" className="h-6 min-w-24 px-2 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {translate('dashboardPopout.lanes.anyStatus', 'Any status')}
                </SelectItem>
                <SelectItem value="attention">
                  {translate('dashboardPopout.bucket.attention', 'Needs You')}
                </SelectItem>
                <SelectItem value="working">
                  {translate('dashboardPopout.bucket.working', 'Working')}
                </SelectItem>
                <SelectItem value="done">
                  {translate('dashboardPopout.bucket.done', 'Done')}
                </SelectItem>
                <SelectItem value="idle">
                  {translate('dashboardPopout.bucket.idle', 'Idle')}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="activity-lanes-filter">
            <span>{translate('dashboardPopout.lanes.recent', 'Recent')}</span>
            <Select
              value={String(recentMinutes)}
              onValueChange={(value) => setRecentMinutes(recentMinutesFromValue(value))}
            >
              <SelectTrigger size="sm" className="h-6 min-w-28 px-2 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">
                  {translate('dashboardPopout.lanes.last30Minutes', 'Last 30 minutes')}
                </SelectItem>
                <SelectItem value="120">
                  {translate('dashboardPopout.lanes.last2Hours', 'Last 2 hours')}
                </SelectItem>
                <SelectItem value="1440">
                  {translate('dashboardPopout.lanes.last24Hours', 'Last 24 hours')}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="h-6"
            aria-pressed={showOlder}
            disabled={!showOlder && hiddenOlderCount === 0}
            onClick={() => setShowOlder((visible) => !visible)}
          >
            {showOlder
              ? translate('dashboardPopout.lanes.hideOlder', 'Hide older')
              : translate('dashboardPopout.lanes.showOlder', 'Show older')}
          </Button>
        </div>
        <header className="activity-lanes-axis">
          <span>{translate('dashboardPopout.lanes.axis', 'Worktree · session duration')}</span>
          <div>
            {ticks.map((tick) => (
              <time key={tick}>{formatTick(tick, recentMinutes, now)}</time>
            ))}
          </div>
        </header>
        {lanes.length > 0 ? (
          lanes.map((lane) => (
            <ActivityLaneSection
              key={lane.id}
              lane={lane}
              now={now}
              recentMinutes={recentMinutes}
              selectedPaneKey={selectedPaneKey}
              onOpenTerminal={onOpenTerminal}
            />
          ))
        ) : (
          <div className="activity-lanes-empty">
            <Search className="size-5" />
            <strong>{translate('dashboardPopout.lanes.empty', 'No matching agents')}</strong>
            <span>
              {translate(
                'dashboardPopout.lanes.emptyHint',
                'Broaden a search or filter, or show older completed sessions.'
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
