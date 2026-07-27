import React from 'react'
import { Check, ChevronDown, FolderOpen, FolderPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import RepoBadgeLabel from '@/components/repo/RepoBadgeLabel'
import { cn } from '@/lib/utils'
import { searchNewWorkspaceProjectOptions } from '@/lib/new-workspace-project-options'
import type {
  DesignVariant,
  NewWorkspaceProjectOption,
  ProjectPickerProps
} from '../design-contract'
import { LAB_RECENT_PROJECT_IDS } from '../fixtures'

// Both designs treat the project as resolved scope rather than an empty field,
// so they share the recency model, the default guess, and the switcher list.

/** Below this, a search field costs more than it saves — show the bare list. */
const SEARCH_THRESHOLD = 7
const RAIL_SIZE = 3

const GROUP_HEADING =
  'p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.05em]'

// Selected-chip treatment lifted from EditorViewToggle / AiVaultPanelControls:
// keyed off aria-checked because TooltipTrigger's asChild merge overwrites
// data-state, and bg-accent alone is near-white against a light card.
const CHIP_CLASS =
  'h-7 max-w-[10rem] gap-1.5 border border-transparent px-2 text-xs font-normal text-muted-foreground hover:bg-accent/60 hover:text-foreground aria-[checked=true]:border-foreground/20 aria-[checked=true]:bg-foreground/10 aria-[checked=true]:text-foreground aria-[checked=true]:shadow-xs aria-[checked=true]:hover:bg-foreground/15 aria-[checked=true]:hover:text-foreground'

function orderByRecency(
  options: readonly NewWorkspaceProjectOption[],
  order: readonly string[]
): NewWorkspaceProjectOption[] {
  const rank = new Map(order.map((id, index) => [id, index]))
  const recent = options
    .filter((option) => rank.has(option.id))
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
  return [...recent, ...options.filter((option) => !rank.has(option.id))]
}

type AmbientScope = {
  /** Most-recent-first ids; stands in for a persisted MRU list. */
  order: readonly string[]
  current: NewWorkspaceProjectOption | null
  /** True while the shown project came from the recency guess, not from a pick. */
  inferred: boolean
  select: (id: string) => void
}

/** Resolves the project the composer is already scoped to, and lets a pick replace it. */
function useAmbientScope(props: ProjectPickerProps): AmbientScope {
  const { options, value, onValueChange, onValueSelected } = props
  const [order, setOrder] = React.useState<readonly string[]>(LAB_RECENT_PROJECT_IDS)
  const [picked, setPicked] = React.useState(false)

  // Derived, not deferred to an effect: the scope must be resolved on the very
  // first paint or the user sees an empty control flash before the guess lands.
  const current = React.useMemo(() => {
    const exact = options.find((option) => option.id === value)
    if (exact || picked) {
      return exact ?? null
    }
    return orderByRecency(options, order)[0] ?? null
  }, [options, order, picked, value])

  // Options can arrive late over SSH, so publish the guess whenever it changes.
  React.useEffect(() => {
    if (current && current.id !== value) {
      // Deliberately not onValueSelected — a guess must not steal focus.
      onValueChange(current.id)
    }
  }, [current, onValueChange, value])

  const select = React.useCallback(
    (id: string): void => {
      setPicked(true)
      setOrder((prev) => [id, ...prev.filter((entry) => entry !== id)])
      onValueChange(id)
      onValueSelected?.(id)
    },
    [onValueChange, onValueSelected]
  )

  return { order, current, inferred: !picked && current !== null, select }
}

function ProjectIdentity({
  option,
  className
}: {
  option: NewWorkspaceProjectOption
  className?: string
}): React.JSX.Element {
  if (option.kind === 'project-group') {
    return (
      <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
        <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{option.displayName}</span>
      </span>
    )
  }
  return (
    <RepoBadgeLabel name={option.displayName} color={option.badgeColor} className={className} />
  )
}

/**
 * The exceptional path for both designs: a compact single-line switcher in a
 * popover, which only grows a search field once the list is long enough to
 * need one. Owns the query so a variant supplies nothing but a trigger.
 */
function ScopePopover({
  options,
  scope,
  onAddProject,
  contentClassName,
  align = 'start',
  children
}: Pick<ProjectPickerProps, 'options' | 'onAddProject'> & {
  scope: AmbientScope
  contentClassName?: string
  align?: 'start' | 'end'
  children: (state: { open: boolean; setOpen: (next: boolean) => void }) => React.ReactNode
}): React.JSX.Element {
  const { order, current, select } = scope
  const value = current?.id ?? null
  const showSearch = options.length > SEARCH_THRESHOLD
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(value ?? '')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  const handleOpenChange = React.useCallback((next: boolean): void => {
    setOpen(next)
    if (!next) {
      setQuery('')
    }
  }, [])

  const matches = React.useMemo(
    () => searchNewWorkspaceProjectOptions(options, query),
    [options, query]
  )
  const ranked = React.useMemo(() => orderByRecency(matches, order), [matches, order])
  // Grouping only earns its headings when there is a meaningful remainder, and a
  // query already reorders by relevance — so both collapse to one unlabelled list.
  const recentCount = query ? 0 : matches.filter((option) => order.includes(option.id)).length
  const groups: [string | undefined, NewWorkspaceProjectOption[]][] =
    recentCount > 0 && recentCount < ranked.length
      ? [
          ['Recent', ranked.slice(0, recentCount)],
          ['All projects', ranked.slice(recentCount)]
        ]
      : [[undefined, ranked]]

  const renderRow = (option: NewWorkspaceProjectOption): React.JSX.Element => {
    const current = option.id === value
    return (
      <CommandItem
        key={option.id}
        value={option.id}
        data-current={current ? 'true' : undefined}
        onSelect={() => {
          handleOpenChange(false)
          select(option.id)
        }}
        className="gap-1.5 px-2 py-1.5"
      >
        <ProjectIdentity
          option={option}
          className={cn('min-w-0 flex-1', current && 'font-medium')}
        />
        {current ? <Check className="size-3.5 shrink-0 text-muted-foreground" /> : null}
        <span className="max-w-[45%] shrink-0 truncate pl-1 text-[11px] text-muted-foreground">
          {option.detail}
        </span>
      </CommandItem>
    )
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {children({ open, setOpen: handleOpenChange })}
      <PopoverContent
        align={align}
        sideOffset={2}
        className={cn('p-0', contentClassName)}
        // Without a search field there is nothing to type into, so focus the list.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          requestAnimationFrame(() => (showSearch ? inputRef : listRef).current?.focus())
        }}
      >
        <Command
          shouldFilter={false}
          value={active}
          onValueChange={setActive}
          className="bg-transparent"
        >
          {showSearch ? (
            <CommandInput
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              placeholder="Search projects..."
              className="h-9 py-2 text-sm"
            />
          ) : null}
          <CommandList ref={listRef} tabIndex={-1} className="max-h-[15rem] outline-none">
            <CommandEmpty className="py-4 text-xs">No projects match your search.</CommandEmpty>
            {groups.map(([heading, rows]) =>
              rows.length > 0 ? (
                <CommandGroup key={heading ?? 'all'} heading={heading} className={GROUP_HEADING}>
                  {rows.map(renderRow)}
                </CommandGroup>
              ) : null
            )}
          </CommandList>
          {onAddProject ? (
            // Outside CommandList so it survives the no-matches state.
            <div className="border-t border-border">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  handleOpenChange(false)
                  onAddProject()
                }}
                onMouseDown={(event) => event.preventDefault()}
                className="h-8 w-full justify-start rounded-none px-2 text-xs font-normal"
              >
                <FolderPlus className="size-3.5 text-muted-foreground" />
                Add a new project
              </Button>
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function AddProjectButton({
  onAddProject,
  describedBy
}: Pick<ProjectPickerProps, 'onAddProject' | 'describedBy'>): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onAddProject}
      aria-describedby={describedBy}
      className="h-7 shrink-0 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
    >
      <FolderPlus className="size-3.5" />
      Add a project
    </Button>
  )
}

function ScopeLine(props: ProjectPickerProps): React.JSX.Element {
  const { options, placeholder = 'Choose project', invalid, describedBy, onAddProject } = props
  const scope = useAmbientScope(props)
  const { current, inferred } = scope

  // With nothing to scope to there is no scope to state; the composer says why underneath.
  if (options.length === 0) {
    return (
      <div className="-mx-2">
        <AddProjectButton onAddProject={onAddProject} describedBy={describedBy} />
      </div>
    )
  }

  return (
    <div className="-mx-2">
      <ScopePopover
        options={options}
        scope={scope}
        onAddProject={onAddProject}
        contentClassName="w-[var(--radix-popover-trigger-width)] min-w-[17rem]"
      >
        {({ open, setOpen }) => (
          <PopoverTrigger asChild>
            <button
              type="button"
              role="combobox"
              aria-label="Project"
              aria-expanded={open}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={describedBy}
              // ↓/↑ opens the switcher, matching how the shipped combobox behaves.
              onKeyDown={(event) => {
                if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                  event.preventDefault()
                  setOpen(true)
                }
              }}
              className={cn(
                'group flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent/60',
                invalid && 'ring-1 ring-destructive/60'
              )}
            >
              <span className="shrink-0 text-muted-foreground">in</span>
              {current ? (
                <>
                  <ProjectIdentity option={current} className="min-w-0 font-medium" />
                  <span className="min-w-0 shrink truncate text-xs text-muted-foreground">
                    {current.detail}
                  </span>
                </>
              ) : (
                <span className="truncate text-muted-foreground">{placeholder}</span>
              )}
              <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2 text-[11px] text-muted-foreground">
                {/* Only a real guess earns the caveat — with one project there was nothing to infer. */}
                {inferred && options.length > 1 ? <span>last used ·</span> : null}
                <span className="underline-offset-2 group-hover:underline">Change</span>
                <ChevronDown className="size-3 opacity-60" />
              </span>
            </button>
          </PopoverTrigger>
        )}
      </ScopePopover>
    </div>
  )
}

function RecentRail(props: ProjectPickerProps): React.JSX.Element {
  const { options, placeholder = 'Choose project', invalid, describedBy, onAddProject } = props
  const scope = useAmbientScope(props)
  const { order, current, select } = scope

  // Current first so the chosen scope never falls off the end of the rail.
  const rail = React.useMemo(() => {
    const ranked = orderByRecency(options, order)
    const pinned = current ? [current, ...ranked.filter((o) => o.id !== current.id)] : ranked
    return pinned.slice(0, RAIL_SIZE)
  }, [current, options, order])
  const hidden = options.length - rail.length

  return (
    <div className="flex min-w-0 items-center gap-1">
      {current === null && options.length > 0 ? (
        <span className="shrink-0 pr-1 text-xs text-muted-foreground">{placeholder}</span>
      ) : null}
      <ToggleGroup
        type="single"
        spacing={1}
        value={current?.id ?? ''}
        onValueChange={(next) => {
          if (next) {
            select(next)
          }
        }}
        aria-label="Project"
        aria-describedby={describedBy}
        // An empty rail would otherwise leave a focusable radiogroup with nothing in it.
        hidden={rail.length === 0}
        className={cn(
          'w-auto min-w-0 flex-1 justify-start overflow-hidden',
          invalid && 'rounded-md ring-1 ring-destructive/60'
        )}
      >
        {rail.map((option) => (
          <Tooltip key={option.id}>
            <TooltipTrigger asChild>
              <ToggleGroupItem value={option.id} className={CHIP_CLASS}>
                {/* Tooltip carries the detail line — it is what tells two `scratch` chips apart. */}
                <ProjectIdentity option={option} />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {option.detail}
            </TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>

      {hidden > 0 ? (
        <ScopePopover
          options={options}
          scope={scope}
          onAddProject={onAddProject}
          align="end"
          contentClassName="w-72"
        >
          {() => (
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 gap-1 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
              >
                {hidden} more
                <ChevronDown className="size-3 opacity-60" />
              </Button>
            </PopoverTrigger>
          )}
        </ScopePopover>
      ) : (
        // Every project already fits on the rail, so the only thing left to reach is Add.
        <AddProjectButton onAddProject={onAddProject} describedBy={describedBy} />
      )}
    </div>
  )
}

const variants: DesignVariant[] = [
  {
    id: 'context-scope-line',
    title: 'Scope line',
    tagline:
      'The project is a sentence you read, not a field you fill: “in ● orca · orca-labs/orca”.',
    notes: [
      'Bulky: label row, 36px outline box and chevron all go, leaving a 32px borderless line that is already answered when the composer opens — the everyday case costs zero interactions.',
      'Unpolished: the line shows what the rows show — mark, name, detail — so a project reads identically in both places and the two `scratch` entries stay distinct at rest. Selection is an inline check on the current row, not a column blank for everyone else.',
      'A wrong guess is recoverable because the guess is stated, not silent: while the scope came from most-recently-used the line reads “last used · Change”. Change is always visible, opens with ↓, and search only appears past 7 projects.',
      'Trades: needs a real last-used-project field in the store, and a borderless line is a weaker pointer target than an outlined one — discoverability rests on the persistent “Change”. `triggerClassName` is ignored; there is no boxed trigger.'
    ],
    Component: ScopeLine
  },
  {
    id: 'context-recent-rail',
    title: 'Recent rail',
    tagline:
      'Show the three projects it could be, with the guess already selected — no popover for the near miss.',
    notes: [
      'Bulky: one 28px row of chips replaces label + trigger + popover. The common case is zero clicks, the next is one click on a chip already on screen; the popover exists only for the long tail.',
      'Unpolished: it fixes the real failure of a pre-selected default — that the user cannot tell it guessed. The guess and its likeliest competitors sit side by side, so a wrong scope is visible and correctable in one glance rather than behind a click.',
      'Chips are a Radix ToggleGroup: one Tab stop, ←/→ roving focus, Enter to select, then Tab reaches “N more”. Each chip’s tooltip carries the detail line, which is what keeps duplicate names like `scratch` honest at chip size.',
      'Trades: horizontal space is the hard limit — only 3 fit, names truncate early, and work spread over many projects pays the “N more” click most times. Needs a persisted recency list. `triggerClassName` is ignored; there is no single trigger.'
    ],
    Component: RecentRail
  }
]

export default variants
