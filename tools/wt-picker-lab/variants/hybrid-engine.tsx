import React from 'react'
import { ChevronDown, FolderPlus } from 'lucide-react'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { cn } from '@/lib/utils'
import type { ProjectPickerProps } from '../design-contract'
import {
  FIELD_SHELL,
  Glyph,
  INVALID_SHELL,
  keepFocus,
  RAW_INPUT,
  scrollArmedIntoView,
  useAmbiguousIds,
  useArmedRow,
  useRows,
  type Row,
  type Scored
} from './typed-query-matching'
import { ElidedDetail, HitName, SECTIONS, useSectioned } from './hybrid-sections'

/**
 * Shared engine for both hybrids: one type-ahead field (no nested search box)
 * over a sectioned list. The two designs differ only in density and chrome, so
 * everything behavioural — arming, sections, commit, keyboard — lives here.
 */
export function useHybrid(props: ProjectPickerProps) {
  const { options, value, onValueChange, onValueSelected, onAddProject } = props
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const listId = React.useId()

  const ambiguous = useAmbiguousIds(options)
  const { matches, rows } = useRows(options, query, onAddProject)
  const { armed, isArmed, arm, move, index } = useArmedRow(rows, query)
  const sections = useSectioned(matches, query)
  const selected = options.find((option) => option.id === value) ?? null
  const armedOption = armed?.scored?.option ?? null
  // A committed pick shows as the field's own content; typing replaces it.
  const committed = selected !== null && query.length === 0

  React.useEffect(() => {
    if (open) {
      scrollArmedIntoView(listRef.current)
    }
  }, [open, index, rows.length])

  const commit = React.useCallback(
    (row: Row | null): void => {
      if (!row) {
        return
      }
      setOpen(false)
      setQuery('')
      if (!row.scored) {
        onAddProject?.()
        return
      }
      onValueChange(row.scored.option.id)
      onValueSelected?.(row.scored.option.id)
    },
    [onAddProject, onValueChange, onValueSelected]
  )

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      move(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault()
      commit(armed)
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
      setQuery('')
      return
    }
    // Backspace on a committed pick unsticks it back into editable text.
    if (event.key === 'Backspace' && committed && selected) {
      event.preventDefault()
      setQuery(selected.displayName)
      setOpen(true)
    }
  }

  return {
    query,
    setQuery,
    open,
    setOpen,
    inputRef,
    listRef,
    listId,
    ambiguous,
    matches,
    rows,
    sections,
    armed,
    armedOption,
    isArmed,
    arm,
    commit,
    onKeyDown,
    selected,
    committed,
    options,
    value
  }
}

export type Hybrid = ReturnType<typeof useHybrid>

/** Field content is identical in both designs; only its shell height differs. */
export function HybridField({
  hybrid,
  props,
  className,
  markClassName
}: {
  hybrid: Hybrid
  props: ProjectPickerProps
  className: string
  markClassName?: string
}): React.JSX.Element {
  const { committed, selected, query, open, listId, armed, inputRef } = hybrid
  return (
    <div
      onClick={() => {
        inputRef.current?.focus()
        hybrid.setOpen(true)
      }}
      className={cn(
        FIELD_SHELL,
        'flex items-center gap-2',
        className,
        props.invalid === true && INVALID_SHELL
      )}
    >
      {committed && selected ? (
        <span className={markClassName}>
          <Glyph option={selected} />
        </span>
      ) : (
        <span className={markClassName}>
          <FolderPlus className="size-3.5 shrink-0 text-transparent" aria-hidden="true" />
        </span>
      )}
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Project"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && armed ? `${listId}-armed` : undefined}
          aria-invalid={props.invalid === true ? true : undefined}
          aria-describedby={props.describedBy}
          value={query}
          placeholder={committed ? '' : (props.placeholder ?? 'Choose project')}
          onChange={(event) => {
            hybrid.setQuery(event.target.value)
            hybrid.setOpen(true)
          }}
          onFocus={() => hybrid.setOpen(true)}
          onKeyDown={hybrid.onKeyDown}
          className={cn(RAW_INPUT, committed && 'text-transparent caret-foreground')}
        />
        {/* Committed state paints over the input so a long name can elide its
            path independently rather than truncating one flat string. */}
        {committed && selected ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center gap-2 text-sm"
          >
            {/* Name claims what it needs up to half the field; the path takes
                the remainder, so a deep path can't squeeze the name to "chec…". */}
            <span className="min-w-0 max-w-[50%] shrink truncate">{selected.displayName}</span>
            <ElidedDetail
              option={selected}
              className="min-w-0 flex-1 shrink-[999] justify-end text-[11px] text-muted-foreground"
            />
          </div>
        ) : null}
      </div>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Browse projects"
        onMouseDown={keepFocus}
        onClick={(event) => {
          event.stopPropagation()
          inputRef.current?.focus()
          hybrid.setOpen(!open)
        }}
        className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
    </div>
  )
}

export type RowStyle = {
  row: string
  gap: string
  detail: string
  headingClass: string
}

export function HybridList({
  hybrid,
  style,
  showCheckHint,
  pinAdd = false
}: {
  hybrid: Hybrid
  style: RowStyle
  showCheckHint: boolean
  /** Keeps "Add a new project" on the popover edge instead of after the rows. */
  pinAdd?: boolean
}): React.JSX.Element {
  const { sections, rows, listId, value, ambiguous } = hybrid
  const addRow = rows.find((row) => row.scored === null) ?? null

  const renderRow = (scored: Scored): React.JSX.Element => {
    const option = scored.option
    const row: Row = { key: option.id, scored }
    const armedHere = hybrid.isArmed(row)
    const isCurrent = option.id === value
    return (
      <div
        key={option.id}
        role="option"
        id={armedHere ? `${listId}-armed` : undefined}
        aria-selected={armedHere}
        data-armed={armedHere}
        data-current={isCurrent ? 'true' : undefined}
        onMouseDown={keepFocus}
        onMouseMove={() => hybrid.arm(option.id)}
        onClick={() => hybrid.commit(row)}
        className={cn(
          'flex cursor-default items-center rounded-sm',
          style.row,
          style.gap,
          armedHere && 'bg-accent text-accent-foreground',
          isCurrent && !armedHere && 'bg-accent/60'
        )}
      >
        <Glyph option={option} />
        {/* Name is the primary read, so it keeps up to half the row and the
            path absorbs the rest — the reverse squeezes names to "chec…". */}
        <HitName
          text={option.displayName}
          hits={scored.nameHits}
          className={cn('min-w-0 max-w-[50%] shrink truncate', isCurrent && 'font-medium')}
        />
        <ElidedDetail
          option={option}
          hits={scored.detailHits}
          className={cn(
            'ml-auto min-w-0 flex-1 shrink-[999] justify-end pl-2 text-right',
            style.detail,
            ambiguous.has(option.id) ? 'text-foreground/80' : 'text-muted-foreground'
          )}
        />
        {/* Takes space only while armed, so an unarmed row gives its full width
            to the path and the cap visibly claims it back on hover. */}
        {showCheckHint && armedHere ? (
          <span className="shrink-0 pl-1.5 text-muted-foreground">
            <ShortcutKeyCombo keys={['↵']} keyCapClassName="min-w-5 px-1 py-0 text-[10px]" />
          </span>
        ) : null}
      </div>
    )
  }

  const addRowNode =
    addRow === null ? null : (
      <div
        role="option"
        id={hybrid.isArmed(addRow) ? `${listId}-armed` : undefined}
        aria-selected={hybrid.isArmed(addRow)}
        data-armed={hybrid.isArmed(addRow)}
        onMouseDown={keepFocus}
        onMouseMove={() => hybrid.arm(addRow.key)}
        onClick={() => hybrid.commit(addRow)}
        className={cn(
          'flex cursor-default items-center gap-2',
          style.row,
          pinAdd
            ? // Pinned: full-bleed bar on the popover edge, so no rounding/margin.
              'shrink-0 border-t border-border'
            : 'mt-1 rounded-sm border-t border-border pt-2',
          hybrid.isArmed(addRow) && 'bg-accent text-accent-foreground'
        )}
      >
        <FolderPlus className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">Add a new project</span>
      </div>
    )

  const scrollingRows = (
    <>
      {hybrid.matches.length === 0 ? (
        <p className="px-2 py-5 text-center text-[13px] text-muted-foreground">
          No projects match.
        </p>
      ) : null}
      {SECTIONS.map(({ key, heading }) => {
        const items = sections[key]
        if (items.length === 0) {
          return null
        }
        return (
          <div key={key}>
            {heading ? <div className={style.headingClass}>{heading}</div> : null}
            {items.map(renderRow)}
          </div>
        )
      })}
    </>
  )

  if (!pinAdd) {
    return (
      <div
        ref={hybrid.listRef}
        id={listId}
        role="listbox"
        aria-label="Projects"
        className="max-h-64 min-h-0 flex-1 overflow-y-auto p-1 scrollbar-sleek"
      >
        {scrollingRows}
        {addRowNode}
      </div>
    )
  }

  // Why: Add stays reachable without scrolling, so the listbox wraps a scrolling
  // rows pane plus a fixed row — both still `option` children of the listbox.
  return (
    <div id={listId} role="listbox" aria-label="Projects" className="flex min-h-0 flex-col">
      <div
        ref={hybrid.listRef}
        className="max-h-64 min-h-0 flex-1 overflow-y-auto p-1 scrollbar-sleek"
      >
        {scrollingRows}
      </div>
      {addRowNode}
    </div>
  )
}
