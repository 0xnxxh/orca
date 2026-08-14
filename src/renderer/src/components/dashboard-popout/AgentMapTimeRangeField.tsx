import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useRef, useState } from 'react'
import {
  AGENT_MAP_TIME_MAX_INDEX,
  agentMapTimeStopLabel,
  isFullAgentMapTimeRange,
  type AgentMapTimeRange
} from './agent-map-time-filter'

type AgentMapTimeRangeFieldProps = {
  label: string
  range: AgentMapTimeRange
  onChange: (range: AgentMapTimeRange) => void
}

/** Ticks are sparse on purpose — the scale is non-linear, so labelling every
 *  stop would read as evenly spaced time when it is not. */
const TICKS = [0, 5, 9, 12, AGENT_MAP_TIME_MAX_INDEX]
const SLIDER_KEYBOARD_COMMIT_KEYS = [
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp'
]

export function AgentMapTimeRangeField({
  label,
  range,
  onChange
}: AgentMapTimeRangeFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState<{
    source: AgentMapTimeRange
    value: AgentMapTimeRange
  } | null>(null)
  const interactionSource = useRef<AgentMapTimeRange | null>(null)
  // New external range objects invalidate stale drafts from resets and quick views.
  const displayedRange = draft?.source === range ? draft.value : range
  const isFull = isFullAgentMapTimeRange(displayedRange)
  return (
    <div className="px-1.5 pt-1 pb-2">
      <div className="flex items-baseline gap-2 text-xs">
        <span>{label}</span>
        <span
          className={cn(
            'ml-auto text-[11px] tabular-nums',
            isFull ? 'text-muted-foreground' : 'text-foreground'
          )}
        >
          {isFull
            ? translate('dashboardPopout.map.filters.timeAny', 'any')
            : `${agentMapTimeStopLabel(displayedRange.min)} – ${agentMapTimeStopLabel(displayedRange.max)}`}
        </span>
      </div>
      <Slider
        className="mt-2"
        aria-label={label}
        min={0}
        max={AGENT_MAP_TIME_MAX_INDEX}
        step={1}
        minStepsBetweenThumbs={0}
        value={[displayedRange.min, displayedRange.max]}
        thumbLabels={[
          translate('dashboardPopout.map.filters.timeMinimum', '{{label}} minimum', { label }),
          translate('dashboardPopout.map.filters.timeMaximum', '{{label}} maximum', { label })
        ]}
        thumbValueLabels={[
          agentMapTimeStopLabel(displayedRange.min),
          agentMapTimeStopLabel(displayedRange.max)
        ]}
        onKeyDown={(event) => {
          if (SLIDER_KEYBOARD_COMMIT_KEYS.includes(event.key)) {
            interactionSource.current = range
          }
        }}
        onPointerDown={() => {
          interactionSource.current = range
        }}
        onPointerCancel={() => {
          interactionSource.current = null
          setDraft(null)
        }}
        onValueChange={([min, max]) => {
          const source = interactionSource.current ?? range
          interactionSource.current = source
          setDraft({ source, value: { min, max } })
        }}
        onValueCommit={([min, max]) => {
          const source = interactionSource.current
          interactionSource.current = null
          setDraft(null)
          if (source === range) {
            onChange({ min, max })
          }
        }}
      />
      <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
        {TICKS.map((tick) => (
          <span key={tick}>{agentMapTimeStopLabel(tick)}</span>
        ))}
      </div>
    </div>
  )
}
