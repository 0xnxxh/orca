import React from 'react'
import { FolderOpen, FolderPlus, Search } from 'lucide-react'
import { RepoBadgeMark } from '@/components/repo/RepoBadgeLabel'
import { cn } from '@/lib/utils'
import { searchNewWorkspaceProjectOptions } from '@/lib/new-workspace-project-options'
import type { NewWorkspaceProjectOption, ProjectPickerProps } from '../design-contract'
import { LAB_RECENT_PROJECT_IDS } from '../fixtures'

/**
 * Shared machinery for the two `design-spatial` variants. Deliberately not
 * named `design-*.tsx` so the registry glob doesn't register it as a variant.
 */

export type Option = NewWorkspaceProjectOption

const CELL = '[data-grid-cell="true"]'
export const ADD = 'Add a new project'
export const RING = 'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
export const MUTED = 'text-[11px] text-muted-foreground'
export const LABEL = 'shrink-0 text-xs font-medium text-muted-foreground'
const BASE = 'flex cursor-pointer rounded-md border transition select-none'
const QUIET =
  'items-center justify-center gap-1.5 border-dashed border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground'

/** Identity tint derived from the project's own badge colour — never a new hex. */
export function tint(color: string, fill: number, edge: number): React.CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${color} ${fill}%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} ${edge}%, transparent)`
  }
}

/** Ids sharing a display name with another option, where a mark alone can't identify them. */
export function ambiguousIds(options: readonly Option[]): Set<string> {
  const counts = new Map<string, number>()
  const key = (o: Option): string => o.displayName.toLowerCase()
  for (const option of options) {
    counts.set(key(option), (counts.get(key(option)) ?? 0) + 1)
  }
  return new Set(options.filter((o) => (counts.get(key(o)) ?? 0) > 1).map((o) => o.id))
}

export function byRecency(options: readonly Option[]): Option[] {
  const recent = LAB_RECENT_PROJECT_IDS.map((id) => options.find((o) => o.id === id)).filter(
    (o): o is Option => Boolean(o)
  )
  const seen = new Set(recent.map((o) => o.id))
  return [...recent, ...options.filter((o) => !seen.has(o.id))]
}

export function byName(options: readonly Option[], kind: Option['kind']): Option[] {
  return options
    .filter((o) => o.kind === kind)
    .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.detail.localeCompare(b.detail))
}

/**
 * Initial, plus the initial of each following word — `orca-relay` reads "or",
 * `orca-docs` reads "od". Widens to a longer prefix only when that still
 * collides, so four `orca*` projects never share one mark.
 */
export function monograms(options: readonly Option[]): Map<string, string> {
  const initials = (name: string): string =>
    name
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((word) => word[0])
      .join('')
      .slice(0, 3)
      .toLowerCase()
  const result = new Map<string, string>()
  const taken = new Map<string, number>()
  for (const option of options) {
    const name = option.displayName.trim()
    let mark = initials(name) || name.slice(0, 1).toLowerCase()
    // Same initials (orca-docs vs orca-mobile after truncation): fall back to a prefix.
    for (let length = 2; taken.has(mark) && length <= name.length; length += 1) {
      mark = name.slice(0, length).toLowerCase()
    }
    taken.set(mark, (taken.get(mark) ?? 0) + 1)
    result.set(option.id, mark)
  }
  return result
}

/**
 * Roving focus read off real geometry rather than a fixed column count, so a
 * fixed grid, a wrapped set, and a ragged last row all navigate the same way.
 */
function moveGridFocus(container: HTMLElement | null, from: HTMLElement, key: string): boolean {
  const cells = container ? [...container.querySelectorAll<HTMLElement>(CELL)] : []
  const at = cells.indexOf(from)
  if (at < 0) {
    return false
  }
  const box = from.getBoundingClientRect()
  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    const next = cells[at + (key === 'ArrowRight' ? 1 : -1)]
    next?.focus()
    return Boolean(next)
  }
  const midX = box.left + box.width / 2
  let best: { el: HTMLElement; row: number; dx: number } | null = null
  for (const cell of cells) {
    const rect = cell.getBoundingClientRect()
    const row = key === 'ArrowDown' ? rect.top - box.top : box.top - rect.top
    const dx = Math.abs(rect.left + rect.width / 2 - midX)
    const closer = !best || row < best.row - 1 || (Math.abs(row - best.row) <= 1 && dx < best.dx)
    if (row >= box.height / 2 && closer) {
      best = { el: cell, row, dx }
    }
  }
  best?.el.focus()
  return Boolean(best)
}

/**
 * Everything both spatial designs share: optimistic selection, type-anywhere
 * filtering, 2D arrow navigation, and Escape unwinding one layer at a time.
 */
export function useGridPicker(
  ordered: Option[],
  props: ProjectPickerProps,
  shell: { onTypeAhead?: () => void; onDismiss?: () => void; typeAhead?: boolean } = {}
) {
  const [query, setQuery] = React.useState('')
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const gridRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const frameRef = React.useRef<number | null>(null)

  // Optimistic: the lattice lights up now, a slow (SSH) parent catches up later.
  React.useEffect(() => {
    if (pendingId === props.value) {
      setPendingId(null)
    }
  }, [pendingId, props.value])
  React.useEffect(() => () => cancelAnimationFrame(frameRef.current ?? 0), [])

  const matched = React.useMemo(
    () => searchNewWorkspaceProjectOptions(ordered, query),
    [ordered, query]
  )
  const firstCell = (): HTMLElement | null => gridRef.current?.querySelector(CELL) ?? null
  // Focus on the next frame so a just-revealed input is actually mounted.
  const focusLater = (getNode: () => HTMLElement | null): void => {
    cancelAnimationFrame(frameRef.current ?? 0)
    frameRef.current = requestAnimationFrame(() => getNode()?.focus())
  }
  const pick = (id: string): void => {
    setPendingId(id)
    setQuery('')
    props.onValueChange(id)
    shell.onDismiss?.()
    props.onValueSelected?.(id)
  }

  const cellKeyDown = (event: React.KeyboardEvent<HTMLElement>, activate: () => void): void => {
    const moved =
      event.key.startsWith('Arrow') &&
      moveGridFocus(gridRef.current, event.target as HTMLElement, event.key)
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
    } else if (moved) {
      event.preventDefault()
    }
  }

  const gridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return
    }
    if (event.key === 'Escape') {
      setQuery('')
      shell.onDismiss?.()
    } else if ((shell.typeAhead ?? true) && event.key.length === 1 && /\S/.test(event.key)) {
      event.preventDefault()
      shell.onTypeAhead?.()
      // Append: keystrokes land here until focus reaches the input a frame later,
      // and replacing would drop every character but the last.
      setQuery((prev) => prev + event.key)
      focusLater(() => inputRef.current)
    }
  }

  const filterKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setQuery('')
      if (!query) {
        shell.onDismiss?.()
        focusLater(firstCell)
      }
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      firstCell()?.focus()
    } else if (event.key === 'Enter' && matched[0]) {
      event.preventDefault()
      pick(matched[0].id)
    }
  }

  return {
    props,
    query,
    setQuery,
    matched,
    matchedIds: new Set(matched.map((o) => o.id)),
    noMatches: query.trim().length > 0 && matched.length === 0,
    gridRef,
    inputRef,
    activeId: pendingId ?? props.value,
    pick,
    cellKeyDown,
    gridKeyDown,
    filterKeyDown
  }
}

export type GridPicker = ReturnType<typeof useGridPicker>

export function Cell(
  props: React.ComponentProps<'div'> & {
    cellId: string
    label: string
    selected?: boolean
    tabbable: boolean
    navigable?: boolean
    onActivate: () => void
    onPreview?: (id: string | null) => void
  }
): React.JSX.Element {
  const { cellId, label, selected, tabbable, navigable = true, onPreview, ...rest } = props
  const { onActivate, className, ...div } = rest
  const preview = (next: string | null) => () => onPreview?.(next)
  return (
    <div
      role="option"
      aria-selected={Boolean(selected)}
      aria-label={label}
      tabIndex={tabbable ? 0 : -1}
      data-grid-cell={navigable ? 'true' : undefined}
      data-current={selected ? 'true' : undefined}
      onClick={onActivate}
      onFocus={preview(cellId)}
      onBlur={preview(null)}
      onMouseEnter={preview(cellId)}
      onMouseLeave={preview(null)}
      className={cn(BASE, RING, className)}
      {...div}
    />
  )
}

/** A non-project cell (more / add) that navigates exactly like a project cell. */
export function QuietCell(props: {
  picker: GridPicker
  cellId: string
  label: string
  icon: React.ReactNode
  text?: string
  tabbable: boolean
  onActivate: () => void
  className: string
}): React.JSX.Element {
  return (
    <Cell
      cellId={props.cellId}
      label={props.label}
      tabbable={props.tabbable}
      onActivate={props.onActivate}
      onKeyDown={(event) => props.picker.cellKeyDown(event, props.onActivate)}
      className={cn(QUIET, props.className)}
    >
      {props.icon}
      {props.text ? <span className="truncate">{props.text}</span> : null}
    </Cell>
  )
}

export function FilterField({ picker, className }: { picker: GridPicker; className?: string }) {
  const field =
    'h-7 w-full rounded-md border border-input bg-transparent pr-2 pl-7 text-xs placeholder:text-muted-foreground focus-visible:border-ring'
  return (
    <div className={cn('relative min-w-0', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={picker.inputRef}
        type="text"
        value={picker.query}
        onChange={(event) => picker.setQuery(event.target.value)}
        onKeyDown={picker.filterKeyDown}
        placeholder="Filter projects"
        aria-label="Filter projects"
        className={cn(field, RING)}
      />
    </div>
  )
}

export function Mark({ option }: { option: Option }): React.JSX.Element {
  return option.kind === 'project-group' ? (
    <FolderOpen className="size-3 shrink-0 text-muted-foreground" />
  ) : (
    <RepoBadgeMark color={option.badgeColor} className="size-2" />
  )
}

/**
 * The listbox both designs share. "Add a new project" is the last cell of the
 * lattice rather than a pinned footer, so the same arrow keys reach it in every
 * state — including no-matches and zero projects, where it is the only cell.
 */
export function Lattice(props: {
  picker: GridPicker
  className: string
  addClassName: string
  addTabbable: boolean
  /** Text on the add cell; omit for an icon-only square. Zero-projects always labels. */
  addText?: string
  children: React.ReactNode
}): React.JSX.Element {
  const { picker } = props
  const { options, onAddProject, invalid, describedBy } = picker.props
  return (
    <div
      ref={picker.gridRef}
      role="listbox"
      aria-label="Project"
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
      onKeyDown={picker.gridKeyDown}
      className={cn(
        'min-w-0 gap-1.5 rounded-md',
        invalid && 'outline-2 outline-destructive/40 outline-offset-4',
        props.className
      )}
    >
      {props.children}
      {onAddProject ? (
        <QuietCell
          picker={picker}
          cellId="add"
          label={ADD}
          icon={<FolderPlus className="size-3.5 shrink-0" />}
          text={options.length === 0 ? ADD : props.addText}
          tabbable={props.addTabbable}
          onActivate={onAddProject}
          className={props.addClassName}
        />
      ) : null}
    </div>
  )
}
