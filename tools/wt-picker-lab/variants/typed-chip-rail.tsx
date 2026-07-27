import React from 'react'
import { FolderPlus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProjectPickerProps } from '../design-contract'
import {
  COUNT,
  discriminator,
  FIELD_SHELL,
  Glyph,
  Hit,
  INVALID_SHELL,
  keepFocus,
  RAW_INPUT,
  scrollArmedIntoView,
  useAmbiguousIds,
  useArmedRow,
  useRows,
  type Row
} from './typed-query-matching'

const COLLAPSED_CHIPS = 5

/**
 * Typed-first design B: no popover at all. A filter line sits above a live rail
 * of matching chips, so the row Enter will take is visible before it is pressed.
 */
export default function TypedChipRail(props: ProjectPickerProps): React.JSX.Element {
  const { options, value, onValueChange, onValueSelected, onAddProject, invalid, describedBy } =
    props
  const [query, setQuery] = React.useState('')
  const [expanded, setExpanded] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const railRef = React.useRef<HTMLDivElement>(null)
  const railId = React.useId()

  const ambiguous = useAmbiguousIds(options)
  const { matches, rows } = useRows(options, query, onAddProject)
  const { index, armed, isArmed, arm, move } = useArmedRow(rows, query)
  // The Add chip is pinned outside the collapse so it survives "+N more".
  const projectRows = rows.filter((row) => row.scored !== null)
  const addRow = rows.find((row) => row.scored === null) ?? null
  const overflow = Math.max(0, projectRows.length - COLLAPSED_CHIPS)
  const armedProjectIndex = projectRows.findIndex(isArmed)
  const showAll = expanded || overflow === 0 || armedProjectIndex >= COLLAPSED_CHIPS
  const visible = showAll ? projectRows : projectRows.slice(0, COLLAPSED_CHIPS)

  React.useEffect(() => {
    scrollArmedIntoView(railRef.current)
  }, [index, rows.length])

  const commit = (row: Row | null): void => {
    if (!row) {
      return
    }
    setQuery('')
    setExpanded(false)
    if (!row.scored) {
      onAddProject?.()
      return
    }
    onValueChange(row.scored.option.id)
    onValueSelected?.(row.scored.option.id)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    const caret = inputRef.current?.selectionStart ?? 0
    if (event.key === 'Enter') {
      event.preventDefault()
      commit(armed)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setExpanded(event.key === 'ArrowDown')
      return
    }
    // Caret guard: arrows only walk the rail once they'd leave the text.
    if (event.key === 'ArrowRight' && caret === query.length) {
      event.preventDefault()
      move(1)
      return
    }
    if (event.key === 'ArrowLeft' && caret === 0) {
      event.preventDefault()
      move(-1)
      return
    }
    if (event.key === 'Escape' && query.length > 0) {
      event.preventDefault()
      setQuery('')
    }
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className={cn(FIELD_SHELL, invalid && INVALID_SHELL)}
    >
      <div className="flex h-8 items-center gap-2 px-2.5">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Project"
          aria-expanded={showAll}
          aria-controls={railId}
          aria-activedescendant={armed ? `${railId}-armed` : undefined}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          value={query}
          placeholder={props.placeholder ?? 'Choose project'}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          className={RAW_INPUT}
        />
        <span aria-live="polite" className={COUNT}>
          {query.length > 0 ? `${matches.length} of ${options.length}` : null}
        </span>
      </div>
      <div
        ref={railRef}
        id={railId}
        role="listbox"
        aria-label="Projects"
        className={cn(
          'flex flex-wrap gap-1 border-t border-border p-1.5',
          showAll && 'max-h-[7.5rem] overflow-y-auto scrollbar-sleek'
        )}
      >
        {visible.map((row) => {
          const option = row.scored?.option
          if (!row.scored || !option) {
            return null
          }
          const armedHere = isArmed(row)
          return (
            <button
              key={row.key}
              type="button"
              tabIndex={-1}
              role="option"
              id={armedHere ? `${railId}-armed` : undefined}
              aria-selected={armedHere}
              data-armed={armedHere}
              data-current={option.id === value ? 'true' : undefined}
              onMouseDown={keepFocus}
              onMouseEnter={() => arm(row.key)}
              onClick={() => commit(row)}
              className={cn(
                'flex h-6 min-w-0 max-w-[15rem] items-center gap-1.5 rounded-full border px-2 text-xs',
                option.id === value
                  ? 'border-border bg-accent text-accent-foreground'
                  : 'border-border/70 text-foreground hover:bg-accent',
                armedHere && 'border-ring ring-2 ring-ring/50'
              )}
            >
              <Glyph option={option} />
              <Hit text={option.displayName} hits={row.scored.nameHits} />
              {ambiguous.has(option.id) ? (
                <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                  {discriminator(option)}
                </span>
              ) : null}
            </button>
          )
        })}
        {showAll ? null : (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={keepFocus}
            onClick={() => setExpanded(true)}
            className="flex h-6 items-center rounded-full border border-dashed border-border/70 px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            +{overflow} more
          </button>
        )}
        {matches.length === 0 && query.length > 0 ? (
          <span className="flex h-6 items-center px-1 text-xs text-muted-foreground">
            No project matches that
          </span>
        ) : null}
        {addRow ? (
          <button
            key={addRow.key}
            type="button"
            tabIndex={-1}
            role="option"
            id={isArmed(addRow) ? `${railId}-armed` : undefined}
            aria-selected={isArmed(addRow)}
            data-armed={isArmed(addRow)}
            onMouseDown={keepFocus}
            onMouseEnter={() => arm(addRow.key)}
            onClick={() => commit(addRow)}
            className={cn(
              'flex h-6 items-center gap-1.5 rounded-full border border-dashed border-border/70 px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground',
              isArmed(addRow) && 'border-solid border-ring text-foreground ring-2 ring-ring/50'
            )}
          >
            <FolderPlus className="size-3.5" />
            <span>Add project</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}
