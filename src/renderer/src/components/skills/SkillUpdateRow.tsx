import { CheckCircle2, ChevronDown, Circle, XCircle } from 'lucide-react'
import type { SkillFreshnessGroupModel } from './skill-freshness-grouping'
import { translate } from '@/i18n/i18n'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { chipLabel, chipTooltip } from './skill-location-chip-copy'
import { skippedReason } from './skill-freshness-skipped-reason'

export type SkillRowState = 'available' | 'blocked' | 'pending' | 'done' | 'failed'

/**
 * The single status slot, sitting between the name and the location count.
 *
 * Why one slot rather than a leading icon column: a leading icon has nothing to
 * show in the resting state, and reserving the box for it just indents every
 * name past an empty gap. Swapping badge for icon in place keeps the name
 * flush-left and the row's right edge fixed in every state.
 */
function StateSlot({ state }: { state: SkillRowState }): React.JSX.Element {
  switch (state) {
    case 'done':
      return <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
    case 'failed':
      return <XCircle className="size-4 shrink-0 text-destructive" />
    case 'pending':
      return <Circle className="size-4 shrink-0 text-muted-foreground" />
    case 'blocked':
      return (
        <Badge
          variant="outline"
          className="shrink-0 border-amber-600/50 text-amber-700 dark:border-amber-400/40 dark:text-amber-400"
        >
          {translate('auto.components.skills.SkillFreshnessRow.statusCantUpdate', 'Skipped')}
        </Badge>
      )
    case 'available':
      return (
        <Badge variant="secondary" className="shrink-0">
          {translate(
            'auto.components.skills.SkillFreshnessRow.statusUpdateAvailable',
            'Update available'
          )}
        </Badge>
      )
  }
}

/**
 * One skill in the update dialog, used unchanged in every state.
 *
 * The header keeps identical geometry from "update available" through running to
 * the result — only the status slot's contents change — so pressing Update
 * doesn't replace the dialog's layout with a different one. Locations live
 * behind a per-skill disclosure instead of being dumped inline, because a skill
 * with several plugin-cache copies otherwise buries the actions.
 */
export function SkillUpdateRow({
  group,
  state
}: {
  group: SkillFreshnessGroupModel
  state: SkillRowState
}): React.JSX.Element {
  const locationCount = group.locations.length
  return (
    <Collapsible
      data-skill-row={group.name}
      data-state-label={state}
      // Negative margin lets the hover surface breathe past the text while the
      // name itself still lines up with the dialog's other content.
      className="-mx-1.5 border-t border-border/60 py-0.5 first:border-t-0"
    >
      <CollapsibleTrigger
        className={`group flex w-full min-w-0 items-center gap-3 rounded-md px-1.5 py-2 text-left transition-opacity hover:bg-accent/60 ${
          state === 'pending' ? 'opacity-60' : ''
        }`}
      >
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {group.name}
        </span>
        <StateSlot state={state} />
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {locationCount === 1
            ? translate('auto.components.skills.SkillUpdateRow.oneLocation', '1 location')
            : translate(
                'auto.components.skills.SkillUpdateRow.manyLocations',
                '{{value0}} locations',
                { value0: locationCount }
              )}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>

      {state === 'failed' ? (
        <p className="px-1.5 pb-1.5 text-xs leading-5 text-muted-foreground">
          {translate(
            'auto.components.skills.SkillUpdateResultRows.stillOutdated',
            'Still out of date after the update ran.'
          )}
        </p>
      ) : null}

      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="flex flex-col gap-2 px-1.5 pb-2 pt-0.5">
          {state === 'blocked' ? (
            <p className="text-xs leading-5 text-muted-foreground">
              {skippedReason(group.locations)}
            </p>
          ) : null}
          {group.locations.map((location) => (
            <div key={location.id} className="flex min-w-0 items-center gap-2">
              {/* Why: plugin-cache paths nest arbitrarily deep. Without an explicit
                  shrink basis the unbreakable string sets the dialog's width and
                  pushes the footer actions off-screen. */}
              <span
                className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
                title={location.path}
              >
                {location.path}
              </span>
              {location.chip ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="shrink-0 cursor-help border-dashed">
                      {chipLabel(location.chip)}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-pretty">
                    {chipTooltip(location.chip)}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
