import React from 'react'
import { Check, ChevronDown, FolderOpen, FolderPlus } from 'lucide-react'
import { Command, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import RepoBadgeLabel, { RepoBadgeMark } from '@/components/repo/RepoBadgeLabel'
import { cn } from '@/lib/utils'
import { searchNewWorkspaceProjectOptions as searchProjects } from '@/lib/new-workspace-project-options'
import type {
  DesignVariant,
  NewWorkspaceProjectOption,
  ProjectPickerProps
} from '../design-contract'
import { LAB_RECENT_PROJECT_IDS } from '../fixtures'

const ADD_VALUE = '__add-project__'
const RAIL_SIZE = 3
/** Below this many tail options, a search field costs more chrome than the scan it saves. */
const SEARCH_THRESHOLD = 7

type IdentityProps = { option: NewWorkspaceProjectOption; className?: string }

/** Folder groups are a different kind of thing than repos, so they keep FolderOpen. */
function ProjectIdentity({ option, className }: IdentityProps): React.JSX.Element {
  return option.kind === 'project-group' ? (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{option.displayName}</span>
    </span>
  ) : (
    <RepoBadgeLabel name={option.displayName} color={option.badgeColor} className={className} />
  )
}

/** Shared open/filter/commit state; keeps a pick on screen while a slow (SSH) parent catches up. */
function usePickerState({
  value,
  onValueChange,
  onValueSelected,
  onAddProject
}: ProjectPickerProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [pending, setPending] = React.useState<string | null>(null)

  React.useEffect(() => {
    setPending((current) => (current === null || current === value ? null : current))
  }, [value])

  const dismiss = React.useCallback((): void => {
    setOpen(false)
    setQuery('')
  }, [])

  return {
    open,
    setOpen,
    query,
    setQuery,
    /** The pick to render — the parent's value, or the optimistic one still landing. */
    displayId: pending ?? value,
    uncommitted: pending !== null && pending !== value,
    pick: React.useCallback(
      (id: string): void => {
        setPending(id)
        onValueChange(id)
        dismiss()
        onValueSelected?.(id)
      },
      [dismiss, onValueChange, onValueSelected]
    ),
    add: React.useMemo(
      () =>
        onAddProject &&
        (() => {
          dismiss()
          onAddProject()
        }),
      [dismiss, onAddProject]
    )
  }
}

type RowsProps = {
  filtered: readonly NewWorkspaceProjectOption[]
  value: string | null
  query: string
  onPick: (id: string) => void
  onAdd?: () => void
}

/** One line per project: identity, detail as trailing metadata, no empty gutter. */
function ProjectRows({ filtered, value, query, onPick, onAdd }: RowsProps): React.JSX.Element {
  return (
    <>
      {filtered.map((option) => (
        <CommandItem
          key={option.id}
          value={option.id}
          onSelect={() => onPick(option.id)}
          className="h-7 gap-2 px-1 text-[13px]"
        >
          <ProjectIdentity option={option} className="min-w-0 flex-1" />
          <span className="max-w-[45%] shrink-0 truncate text-[11px] text-muted-foreground">
            {option.detail}
          </span>
          {option.id === value ? <Check className="size-3 shrink-0 text-muted-foreground" /> : null}
        </CommandItem>
      ))}
      {/* Silent when there is simply nothing to list — the composer already says so. */}
      {filtered.length > 0 || query.trim() === '' ? null : (
        <p className="px-1 py-2 text-[12px] text-muted-foreground">No match for “{query}”.</p>
      )}
      {onAdd ? (
        <CommandItem
          value={ADD_VALUE}
          onSelect={onAdd}
          onMouseDown={(event) => event.preventDefault()}
          className="h-7 gap-2 px-1 text-[13px] text-muted-foreground"
        >
          <FolderPlus className="size-3.5" />
          <span>Add a new project</span>
        </CommandItem>
      ) : null}
    </>
  )
}

// A — Sentence: the field is a line of prose that edits itself.
function SentencePicker(props: ProjectPickerProps): React.JSX.Element {
  const { options, value, placeholder = 'Choose project', invalid = false, describedBy } = props
  const { open, setOpen, query, setQuery, displayId, uncommitted, pick, add } =
    usePickerState(props)
  const [active, setActive] = React.useState('')
  const triggerRef = React.useRef<HTMLButtonElement>(null)

  const selected = options.find((option) => option.id === displayId) ?? null
  const filtered = React.useMemo(() => searchProjects(options, query), [options, query])

  /** Seeding the highlight keeps Enter meaningful from the first keystroke. */
  const search = (seed: string): void => {
    setQuery(seed)
    setActive(searchProjects(options, seed)[0]?.id ?? ADD_VALUE)
  }

  const openWith = (seed: string): void => {
    search(seed)
    setOpen(true)
  }

  const close = (refocus: boolean): void => {
    setOpen(false)
    setQuery('')
    if (refocus) {
      requestAnimationFrame(() => triggerRef.current?.focus())
    }
  }

  // Type-to-open: any printable key seeds the query, arrows open empty.
  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    const arrow = event.key === 'ArrowDown' || event.key === 'ArrowUp'
    const printable =
      event.key.length === 1 &&
      /\S/.test(event.key) &&
      !(event.metaKey || event.ctrlKey || event.altKey)
    if (arrow || printable) {
      event.preventDefault()
      openWith(arrow ? '' : event.key)
    }
  }

  if (!open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={false}
        aria-haspopup="listbox"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onClick={() => openWith('')}
        onKeyDown={handleTriggerKeyDown}
        data-project-combobox-root="true"
        className="group flex h-6 w-full items-center rounded-sm text-left text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="w-5 shrink-0 text-muted-foreground">in</span>
        <span
          className={cn(
            'flex min-w-0 items-center rounded-sm px-1 transition group-hover:bg-accent',
            uncommitted && 'opacity-60',
            // Dotted underline is the only "fill me in" affordance before a pick.
            !selected && 'underline decoration-dotted underline-offset-4',
            !selected && (invalid ? 'text-destructive' : 'text-muted-foreground')
          )}
        >
          {selected ? (
            <ProjectIdentity option={selected} className="min-w-0" />
          ) : (
            <span className="truncate">{placeholder}</span>
          )}
        </span>
        <ChevronDown className="ml-1 size-3 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" />
      </button>
    )
  }

  return (
    <Command
      shouldFilter={false}
      value={active}
      onValueChange={setActive}
      data-project-combobox-root="true"
      className="overflow-visible bg-transparent"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          close(true)
        }
      }}
    >
      <div className="flex h-6 items-center text-[13px]">
        <span className="w-5 shrink-0 text-muted-foreground">in</span>
        {/* Identity holds the caret's left edge steady, but drops once the
            query stops describing the current project. */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1">
          {query !== '' || !selected ? null : selected.kind === 'project' ? (
            <RepoBadgeMark color={selected.badgeColor} />
          ) : (
            <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <CommandInput
            autoFocus
            value={query}
            onValueChange={search}
            onBlur={(event) => {
              const root = event.currentTarget.closest('[data-project-combobox-root]')
              if (!root?.contains(event.relatedTarget)) {
                close(false)
              }
            }}
            placeholder={selected?.displayName ?? placeholder}
            aria-describedby={describedBy}
            wrapperClassName="min-w-0 flex-1 border-0 bg-transparent p-0"
            iconClassName="hidden"
            className="h-6 w-full py-0 text-[13px]"
          />
        </div>
      </div>
      <CommandList onMouseDown={(e) => e.preventDefault()} className="mt-1 max-h-[188px] pl-5">
        <ProjectRows filtered={filtered} value={value} query={query} onPick={pick} onAdd={add} />
      </CommandList>
    </Command>
  )
}

// B — Rail: the three likeliest answers, already on screen.
const CHIP =
  'flex h-6 min-w-0 shrink-0 items-center rounded-full px-2 text-[12px] outline-none transition focus-visible:ring-[3px] focus-visible:ring-ring/50'
const CHIP_IDLE = 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'

function useRail(
  options: readonly NewWorkspaceProjectOption[],
  selectedId: string | null
): [rail: NewWorkspaceProjectOption[], rest: NewWorkspaceProjectOption[]] {
  const orderRef = React.useRef<readonly string[]>([])
  return React.useMemo(() => {
    const byId = new Map(options.map((option) => [option.id, option]))
    const kept = orderRef.current.filter((id) => byId.has(id))
    // Why: a tail pick earns a rail slot, but picking a chip must not shuffle it
    // to the front out from under the pointer — so promote only what isn't there.
    const promote =
      selectedId !== null && byId.has(selectedId) && !kept.slice(0, RAIL_SIZE).includes(selectedId)
    const ordered = [
      ...new Set([
        ...(promote ? [selectedId] : []),
        ...kept,
        ...LAB_RECENT_PROJECT_IDS.filter((id) => byId.has(id)),
        ...byId.keys()
      ])
    ]
    orderRef.current = ordered
    const rows = ordered.map((id) => byId.get(id) as NewWorkspaceProjectOption)
    return [rows.slice(0, RAIL_SIZE), rows.slice(RAIL_SIZE)]
  }, [options, selectedId])
}

function RailPicker(props: ProjectPickerProps): React.JSX.Element {
  const { options, value, placeholder = 'Choose project', invalid = false, describedBy } = props
  const { open, setOpen, query, setQuery, displayId, uncommitted, pick, add } =
    usePickerState(props)
  const [focusIndex, setFocusIndex] = React.useState(0)
  const railRef = React.useRef<HTMLDivElement>(null)

  const [rail, rest] = useRail(options, displayId)
  const filtered = React.useMemo(() => searchProjects(rest, query), [rest, query])
  const moveFocus = (delta: number): void => {
    const items = [...(railRef.current?.querySelectorAll<HTMLElement>('[data-rail-item]') ?? [])]
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement))
    items[Math.max(0, Math.min(items.length - 1, current + delta))]?.focus()
  }

  /** Roving tabstop: the chip row is one tab stop, arrows move within it. */
  const tabStop = Math.min(focusIndex, rail.length)
  const tailChipProps = {
    'data-rail-item': '',
    type: 'button' as const,
    tabIndex: rail.length === tabStop ? 0 : -1,
    onFocus: () => setFocusIndex(rail.length)
  }

  return (
    <div
      ref={railRef}
      role="group"
      aria-label="Project"
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      data-project-combobox-root="true"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault()
          moveFocus(event.key === 'ArrowRight' ? 1 : -1)
        }
      }}
      className="flex min-w-0 items-center gap-1"
    >
      {/* Silent when there is nothing to pick — the composer says so already. */}
      {value === null && options.length > 0 ? (
        <span
          className={cn(
            'mr-0.5 shrink-0 text-[11px]',
            invalid ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {placeholder}
        </span>
      ) : null}
      {rail.map((option, index) => (
        <button
          key={option.id}
          data-rail-item=""
          type="button"
          aria-pressed={option.id === displayId}
          tabIndex={index === tabStop ? 0 : -1}
          onFocus={() => setFocusIndex(index)}
          onClick={() => pick(option.id)}
          className={cn(
            CHIP,
            option.id === displayId ? 'bg-accent text-accent-foreground' : CHIP_IDLE,
            option.id === displayId && uncommitted && 'opacity-60'
          )}
        >
          <ProjectIdentity option={option} className="max-w-[9rem]" />
        </button>
      ))}

      {rest.length === 0 ? (
        <button
          {...tailChipProps}
          onClick={add}
          className={cn(CHIP, CHIP_IDLE, 'gap-1')}
          aria-label="Add a new project"
        >
          <FolderPlus className="size-3" />
          <span>Add</span>
        </button>
      ) : (
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            setQuery('')
          }}
        >
          <PopoverTrigger asChild>
            <button
              {...tailChipProps}
              aria-label={`Choose from ${rest.length} more projects`}
              className={cn(CHIP, CHIP_IDLE, 'gap-0.5')}
            >
              <span>+{rest.length}</span>
              <ChevronDown className="size-3 opacity-60" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[17rem] p-1">
            <Command shouldFilter={false}>
              {/* Search only once the tail is long enough to need it. */}
              {rest.length > SEARCH_THRESHOLD ? (
                <CommandInput
                  autoFocus
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Filter projects"
                  wrapperClassName="mb-1 border-0 border-b border-border bg-transparent px-1 py-0"
                  iconClassName="mr-1.5 size-3.5"
                  className="h-8 py-0 text-[13px]"
                />
              ) : null}
              <CommandList className="max-h-[220px]">
                <ProjectRows {...{ filtered, value, query }} onPick={pick} onAdd={add} />
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

const variants: DesignVariant[] = [
  {
    id: 'minimal-sentence',
    title: 'Sentence',
    tagline: 'A line of prose — “in orca” — that becomes its own search field in place.',
    notes: [
      'Deletes the label, add-icon, 36px outline box, chevron and popover frame. At rest the field is one 24px line of text, so the composer reads “Create worktree / in orca”.',
      'The trigger is the search field: click or just start typing and the name becomes a caret in the same spot, with bare single-line rows below. No second surface, no search icon, no footer.',
      'Detail moves to right-aligned trailing metadata and the current pick gets a trailing check — no empty checkmark gutter, and trigger and rows finally show the same identity.',
      'Trades discoverability: nothing says “editable” until hover or focus reveals the chevron. Inline expansion pushes the fields below it down. Ignores triggerClassName — there is no boxed trigger.'
    ],
    Component: SentencePicker
  },
  {
    id: 'minimal-rail',
    title: 'Rail',
    tagline: 'Three recency-ordered chips on one 24px row — the usual answer is one click away.',
    notes: [
      'Removes the popover from the common case: the likely projects are visible at rest, so re-picking your daily project is one click — no open, no scan, no close.',
      'One 24px row replaces label + 36px trigger. Identity is a chip that reads the same selected or not, and the placeholder disappears for good after the first pick.',
      'The tail lives behind a +N chip whose list is single-line and only grows a filter field past 7 options — search appears when the list is actually long. Add a new project is the last row there, or its own chip when there is no tail.',
      'Trades: needs a real recency field in the store (this uses the lab fixture); 3 chips means wide names truncate; no label, so a first-run user must infer the chip row is the project selector; the tail is a second-class two-click path. Ignores triggerClassName.'
    ],
    Component: RailPicker
  }
]

export default variants
