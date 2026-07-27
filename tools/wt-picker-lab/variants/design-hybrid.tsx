import React from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { COUNT, keepFocus } from './typed-query-matching'
import type { DesignVariant, ProjectPickerProps } from '../design-contract'
import { HybridField, HybridList, useHybrid, type RowStyle } from './hybrid-engine'

const TIGHT_STYLE: RowStyle = {
  row: 'h-7 px-2 text-[13px]',
  gap: 'gap-2',
  detail: 'text-[11px]',
  headingClass:
    'px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground'
}

const CALM_STYLE: RowStyle = {
  row: 'h-9 px-2.5 text-sm',
  gap: 'gap-2.5',
  detail: 'text-xs',
  headingClass: 'px-2.5 pt-2 pb-1 text-xs font-normal text-muted-foreground'
}

/**
 * Tight rows + Calm's on-row Enter cap + an Add row pinned to the popover edge.
 * No footer: the cap carries the Enter promise, so the strip is redundant.
 */
function HybridCompact(props: ProjectPickerProps): React.JSX.Element {
  const hybrid = useHybrid(props)
  return (
    <div className="min-w-0 space-y-1">
      <label className="text-xs font-medium text-muted-foreground">Project</label>
      <Popover open={hybrid.open} onOpenChange={hybrid.setOpen}>
        <PopoverAnchor asChild>
          <div>
            <HybridField
              hybrid={hybrid}
              props={props}
              className="h-8 px-2.5"
              markClassName="flex w-4 shrink-0 items-center justify-center"
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="flex w-[var(--radix-popover-trigger-width)] min-w-[17rem] flex-col p-0"
          onOpenAutoFocus={keepFocus}
          onCloseAutoFocus={keepFocus}
        >
          <HybridList hybrid={hybrid} style={TIGHT_STYLE} showCheckHint pinAdd />
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** Tight: 28px rows, uppercase section caps, count in the footer. */
function HybridTight(props: ProjectPickerProps): React.JSX.Element {
  const hybrid = useHybrid(props)
  return (
    <div className="min-w-0 space-y-1">
      <label className="text-xs font-medium text-muted-foreground">Project</label>
      <Popover open={hybrid.open} onOpenChange={hybrid.setOpen}>
        <PopoverAnchor asChild>
          <div>
            <HybridField
              hybrid={hybrid}
              props={props}
              className="h-8 px-2.5"
              markClassName="flex w-4 shrink-0 items-center justify-center"
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="flex w-[var(--radix-popover-trigger-width)] min-w-[17rem] flex-col p-0"
          onOpenAutoFocus={keepFocus}
          onCloseAutoFocus={keepFocus}
        >
          <HybridList hybrid={hybrid} style={TIGHT_STYLE} showCheckHint={false} />
          <div className="flex items-center justify-between gap-2 border-t border-border px-2.5 py-1.5">
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShortcutKeyCombo keys={['↵']} keyCapClassName="min-w-5 px-1 py-0 text-[10px]" />
              <span className="truncate">
                {hybrid.armedOption?.displayName ?? 'Add a new project'}
              </span>
            </span>
            <span aria-live="polite" className={COUNT}>
              {hybrid.matches.length} of {hybrid.options.length}
            </span>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** Calm: 36px rows, quiet sentence-case headings, Enter cap on the armed row. */
function HybridCalm(props: ProjectPickerProps): React.JSX.Element {
  const hybrid = useHybrid(props)
  return (
    <div className="min-w-0 space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">Project</label>
      <Popover open={hybrid.open} onOpenChange={hybrid.setOpen}>
        <PopoverAnchor asChild>
          <div>
            <HybridField
              hybrid={hybrid}
              props={props}
              className="h-9 px-3"
              markClassName="flex shrink-0 items-center justify-center"
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={5}
          className="flex w-[var(--radix-popover-trigger-width)] min-w-[18rem] flex-col p-0"
          onOpenAutoFocus={keepFocus}
          onCloseAutoFocus={keepFocus}
        >
          <HybridList hybrid={hybrid} style={CALM_STYLE} showCheckHint />
        </PopoverContent>
      </Popover>
    </div>
  )
}

const LONG_NAME_NOTE =
  'Long names and paths: the name truncates last and the path elides from its middle (…/services/checkout-api), so the tail that actually distinguishes two deep paths survives. Name and detail shrink at different rates rather than sharing one flat truncate.'

const variants: DesignVariant[] = [
  {
    id: 'hybrid-compact',
    title: 'Hybrid · Compact',
    tagline:
      'Calm’s on-row Enter cap at Tight’s density, with “Add a new project” pinned to the popover edge.',
    notes: [
      'Calm with the air taken out: 28px rows and uppercase section caps (Tight’s density), but it keeps Calm’s ↵ cap on the hovered/armed row — hovering arms, so the cap follows the pointer and Enter is previewed exactly where your eye already is.',
      'The cap takes space only while armed, so an unarmed row spends its full width on the path and the cap visibly claims it back on hover — the same nudge Refined · Calm has.',
      '“Add a new project” is pinned as a full-bleed bar on the popover edge instead of trailing the rows, so it stays clickable with 13 projects scrolled — and it’s still an armable row, so ↓-past-the-end and Enter reach it too. Both panes remain `option` children of one listbox.',
      'Drops Tight’s footer entirely: with the cap on the row, a strip repeating “↵ orca” was saying it twice. Cost is the N-of-M count — this bets you scan rather than count. No trigger, so `triggerClassName` is ignored; recency still needs a real store field.'
    ],
    Component: HybridCompact
  },
  {
    id: 'hybrid-tight',
    title: 'Hybrid · Tight',
    tagline:
      'Type-ahead field over Refined-Tight’s list: no nested search box, 28px rows, uppercase sections, live count.',
    notes: [
      'Takes the one thing you liked from Type-ahead field — the field *is* the search, so there is no second search box inside the popover — and drops it onto Refined · Tight’s list: 28px rows, uppercase section caps, and a footer that names what Enter will take plus an N-of-M count.',
      'Enter is never a guess: exactly one row is armed at all times, tracked by row key so a list arriving late over SSH cannot swap the target under a keypress already aimed. Empty query arms the most recent project; zero matches arms “Add a new project”.',
      LONG_NAME_NOTE,
      'Trades: no trigger, so `triggerClassName` is ignored. Recency ordering needs a real most-recently-used store field. The dense rows put more on screen but read colder than Calm — that is the axis you are choosing between.'
    ],
    Component: HybridTight
  },
  {
    id: 'hybrid-calm',
    title: 'Hybrid · Calm',
    tagline:
      'Type-ahead field over Refined-Calm’s list: no nested search box, 36px rows, quiet headings, Enter cap on the armed row.',
    notes: [
      'Same type-ahead field and the same arming rules as Hybrid · Tight — one control, no nested search box — but Refined · Calm’s list: 36px rows, sentence-case headings, and more air between sections.',
      'The Enter affordance moves from a footer bar onto the armed row itself, so the promise sits where your eye already is and the popover loses a whole strip of chrome. Nothing is duplicated between field and list.',
      LONG_NAME_NOTE,
      'Trades: no trigger, so `triggerClassName` is ignored. Roughly 4 fewer rows visible than Tight at the same height, and no running match count — it bets you scan rather than count. Recency still needs a real store field.'
    ],
    Component: HybridCalm
  }
]

export default variants
