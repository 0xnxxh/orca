import React from 'react'
import { FolderOpen, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DesignVariant, ProjectPickerProps } from '../design-contract'
import {
  ADD,
  Cell,
  FilterField,
  Lattice,
  LABEL,
  Mark,
  MUTED,
  QuietCell,
  ambiguousIds,
  byName,
  byRecency,
  monograms,
  tint,
  useGridPicker,
  type Option
} from './spatial-lattice'

const SHELF_SLOTS = 4

// ---------------------------------------------------------------------------
// A — Launchpad: a fixed 3-up lattice, the four you actually use held in place.
// ---------------------------------------------------------------------------

function Launchpad(props: ProjectPickerProps): React.JSX.Element {
  const { options, placeholder = 'Choose project' } = props
  const [expanded, setExpanded] = React.useState(false)
  const collapse = React.useCallback(() => setExpanded(false), [])
  const ambiguous = React.useMemo(() => ambiguousIds(options), [options])
  const ordered = React.useMemo(() => byRecency(options), [options])
  const overflow = Math.max(0, options.length - SHELF_SLOTS)
  const picker = useGridPicker(ordered, props, {
    onDismiss: collapse,
    onTypeAhead: () => setExpanded(true),
    typeAhead: overflow > 0
  })

  const shelf = ordered.slice(0, SHELF_SLOTS)
  const selected = options.find((o) => o.id === picker.activeId) ?? null
  const offShelf = selected && !shelf.includes(selected) ? selected : null
  const visible = expanded ? picker.matched : offShelf ? [...shelf, offShelf] : shelf
  const firstId = selected?.id ?? visible[0]?.id ?? 'add'

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <label className={LABEL}>Project</label>
        <span className={cn('min-w-0 flex-1 truncate text-right', MUTED)}>
          {selected ? selected.detail : placeholder}
        </span>
      </div>

      {expanded && overflow > 0 ? <FilterField picker={picker} /> : null}

      <Lattice
        picker={picker}
        addTabbable={firstId === 'add'}
        addText={options.length > 0 ? 'Add' : undefined}
        addClassName={cn('h-10 px-2.5 text-[13px]', options.length === 0 && 'col-span-3')}
        className={cn(
          'grid grid-cols-3',
          expanded && 'max-h-[228px] overflow-y-auto scrollbar-sleek'
        )}
      >
        {visible.map((option) => (
          <Cell
            key={option.id}
            cellId={option.id}
            label={`${option.displayName}, ${option.detail}`}
            selected={option.id === picker.activeId}
            tabbable={option.id === firstId}
            onActivate={() => picker.pick(option.id)}
            onKeyDown={(event) => picker.cellKeyDown(event, () => picker.pick(option.id))}
            className={cn(
              'h-10 min-w-0 flex-col justify-center px-2.5',
              option.id === picker.activeId
                ? 'border-ring/70 bg-accent text-accent-foreground'
                : 'border-border hover:bg-accent/60'
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <Mark option={option} />
              <span className="truncate text-[13px] leading-4">{option.displayName}</span>
            </span>
            {/* Only names that are genuinely ambiguous pay for a second line. */}
            {ambiguous.has(option.id) ? (
              <span className="truncate pl-[14px] text-[10px] leading-3 text-muted-foreground">
                {option.detail}
              </span>
            ) : null}
          </Cell>
        ))}
        {/* Expansion is a cell, not a separate control, so it navigates like one. */}
        {overflow > 0 && !expanded ? (
          <QuietCell
            picker={picker}
            cellId="more"
            label={`Show all ${options.length} projects`}
            icon={<MoreHorizontal className="size-3.5 shrink-0" />}
            text={`${overflow} more`}
            tabbable={false}
            onActivate={() => setExpanded(true)}
            className="h-10 px-2.5 text-[13px]"
          />
        ) : null}
      </Lattice>

      {expanded && picker.noMatches ? (
        <p className={MUTED}>No projects match “{picker.query}”.</p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// B — Palette: every project at once as a colour mark on one stable map; a
// single caption line does the reading. Filtering dims instead of reflowing.
// ---------------------------------------------------------------------------

function Palette(props: ProjectPickerProps): React.JSX.Element {
  const { options, placeholder = 'Choose project' } = props
  const [previewId, setPreviewId] = React.useState<string | null>(null)
  const ambiguous = React.useMemo(() => ambiguousIds(options), [options])
  const repos = React.useMemo(() => byName(options, 'project'), [options])
  const groups = React.useMemo(() => byName(options, 'project-group'), [options])
  const ordered = React.useMemo(() => [...repos, ...groups], [groups, repos])
  const initials = React.useMemo(() => monograms(repos), [repos])
  const picker = useGridPicker(ordered, props)

  const searching = picker.query.trim().length > 0
  const caption = options.find((o) => o.id === (previewId ?? picker.activeId)) ?? null
  const firstId = picker.activeId ?? ordered[0]?.id ?? 'add'
  const hint = previewId && previewId !== picker.activeId && previewId !== 'add'

  const renderCell = (option: Option): React.JSX.Element => {
    const selected = option.id === picker.activeId
    const dimmed = searching && !picker.matchedIds.has(option.id)
    const group = option.kind === 'project-group'
    // A name shared with another project can never be a bare mark.
    const named = ambiguous.has(option.id)
    return (
      <Cell
        key={option.id}
        cellId={option.id}
        label={`${option.displayName}, ${option.detail}`}
        selected={selected}
        tabbable={option.id === firstId}
        navigable={!dimmed}
        onActivate={() => picker.pick(option.id)}
        onKeyDown={(event) => picker.cellKeyDown(event, () => picker.pick(option.id))}
        onPreview={setPreviewId}
        style={tint(option.badgeColor, group ? 0 : selected ? 32 : 13, selected ? 78 : 34)}
        className={cn(
          'h-9 items-center justify-center px-2',
          named ? 'max-w-[132px] min-w-0 gap-1.5' : 'min-w-9',
          group && 'gap-1.5',
          selected && 'ring-2 ring-ring',
          dimmed ? 'opacity-25' : 'hover:brightness-110'
        )}
      >
        {named ? (
          <>
            <Mark option={option} />
            <span className="flex min-w-0 flex-col text-left leading-tight">
              <span className="truncate text-[11px]">{option.displayName}</span>
              <span className="truncate text-[10px] text-muted-foreground">{option.detail}</span>
            </span>
          </>
        ) : group ? (
          <>
            <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="max-w-[92px] truncate text-[11px]">{option.displayName}</span>
          </>
        ) : (
          <span className="text-[11px] font-medium">{initials.get(option.id)}</span>
        )}
      </Cell>
    )
  }

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <label className={LABEL}>Project</label>
        {options.length > 8 || searching ? (
          <FilterField picker={picker} className="w-[164px]" />
        ) : null}
      </div>

      <Lattice
        picker={picker}
        className="flex flex-wrap items-center"
        addTabbable={firstId === 'add'}
        addText={options.length > 0 ? 'Add' : undefined}
        addClassName={cn('h-9 px-2.5 text-[11px]', options.length === 0 && 'w-full text-[13px]')}
      >
        {repos.map(renderCell)}
        {groups.length > 0 ? <div aria-hidden="true" className="h-px w-full bg-border" /> : null}
        {groups.map(renderCell)}
      </Lattice>

      {/* One fixed-height caption does all the reading, so nothing reflows. */}
      <div className={cn('flex h-4 min-w-0 items-center gap-1.5', MUTED)}>
        {picker.noMatches ? (
          <span className="truncate">No projects match “{picker.query}”.</span>
        ) : caption ? (
          <>
            <Mark option={caption} />
            <span className="max-w-[40%] truncate text-foreground">{caption.displayName}</span>
            <span className="min-w-0 truncate">{caption.detail}</span>
            {hint ? <span className="ml-auto shrink-0 text-[10px]">Enter to pick</span> : null}
          </>
        ) : (
          <span className="truncate">{previewId === 'add' ? ADD : placeholder}</span>
        )}
      </div>
    </div>
  )
}

const variants: DesignVariant[] = [
  {
    id: 'spatial-launchpad',
    title: 'Launchpad',
    tagline: 'A fixed 3-up lattice of the projects you actually use — no popover to open.',
    notes: [
      'Bulky: no trigger, no chevron, no popover. Two rows of 40px tiles show the common case immediately, so picking your daily project is one click instead of click-scan-click.',
      'Unpolished: one representation everywhere — the tile you pick is the tile that stays lit (bg-accent + ring), with no empty checkmark column. "N more" and "Add a new project" are cells of the same lattice, not separate controls, so arrow keys reach them in every state including no-matches and zero projects.',
      'The four recent slots hold still while the composer is open so the hand learns positions, and a second line is spent only on names that are genuinely ambiguous (scratch x 2) — every other tile stays single-line. Arrows move in 2D off real geometry, so the ragged last row navigates correctly; typing anywhere expands and filters.',
      'Trades: shelf membership comes from recency, which needs a real recents source in the store (the lab reads LAB_RECENT_PROJECT_IDS), and a recency shelf does shift between sessions. Costs ~30px of permanent dialog height, and expanded-to-13 is taller than the old popover. Ignores triggerClassName — there is no trigger.'
    ],
    Component: Launchpad
  },
  {
    id: 'spatial-palette',
    title: 'Palette',
    tagline:
      'Every project as a colour mark on one stable map; filtering dims instead of reflowing.',
    notes: [
      'Bulky: all 13 projects fit in ~3 rows of 36px marks — no popover, no scroll, no second search surface. Picking is one click on a square whose position never moves (alphabetical, never recency-sorted).',
      'Unpolished: a single fixed-height caption line under the map reads the hovered/focused/selected project as name + detail, so nothing truncates twice and nothing reflows between hover, focus and pick. Repos are colour-tinted monogram marks; folder groups sit below a hairline as FolderOpen pills — kind is a shape difference, not a word.',
      'Ambiguity buys width. Monograms are the shortest form that stays unique — four orca* projects read o / od / om / or, never four identical squares — and a display name shared with another project (scratch x 2) becomes a labelled pill carrying its detail. Typing dims non-matches in place instead of removing them, so the map you memorised survives the search, and arrow keys skip the dimmed cells.',
      'Trades: the risky one. Unlabelled marks are weak on first run and lean on colour, so a colour-blind user works from monogram + position + caption; it stops scaling past roughly 30 projects, where the map becomes a wall. Ignores triggerClassName — no trigger exists.'
    ],
    Component: Palette
  }
]

export default variants
