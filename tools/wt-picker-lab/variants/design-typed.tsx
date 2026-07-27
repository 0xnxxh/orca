import React from 'react'
import { ChevronDown, FolderPlus, Search } from 'lucide-react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { cn } from '@/lib/utils'
import type { DesignVariant, ProjectPickerProps } from '../design-contract'
import TypedChipRail from './typed-chip-rail'
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

/**
 * Typed-first design A: the field *is* the control. No trigger, no nested
 * search box — you type into the thing you're looking at, an inline completion
 * shows what Enter will take, and Enter takes it.
 */
function TypedGhostField(props: ProjectPickerProps): React.JSX.Element {
  const { options, value, onValueChange, onValueSelected, onAddProject, invalid, describedBy } =
    props
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const listId = React.useId()

  const ambiguous = useAmbiguousIds(options)
  const { matches, rows } = useRows(options, query, onAddProject)
  const { index, armed, isArmed, arm, move } = useArmedRow(rows, query)
  const selected = options.find((option) => option.id === value) ?? null
  const armedOption = armed?.scored?.option ?? null
  const committed = selected !== null && query.length === 0

  // Ghost only when the armed name literally continues what was typed.
  const ghost =
    armedOption &&
    query.length > 0 &&
    armedOption.displayName.toLowerCase().startsWith(query.toLowerCase())
      ? armedOption.displayName.slice(query.length)
      : ''
  const trailingOption = committed ? selected : armedOption
  const trailing =
    trailingOption && (committed || ambiguous.has(trailingOption.id))
      ? ambiguous.has(trailingOption.id)
        ? discriminator(trailingOption)
        : trailingOption.detail
      : ''

  React.useEffect(() => {
    if (open) {
      scrollArmedIntoView(listRef.current)
    }
  }, [open, index, rows.length])

  const commit = (row: Row | null): void => {
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
  }

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
    if (event.key === 'Backspace' && committed) {
      event.preventDefault()
      setQuery(selected.displayName)
      setOpen(true)
      return
    }
    const caretAtEnd = inputRef.current?.selectionStart === query.length
    const accepting = event.key === 'Tab' || (event.key === 'ArrowRight' && caretAtEnd)
    if (accepting && ghost.length > 0 && !event.shiftKey) {
      event.preventDefault()
      setQuery(query + ghost)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          onClick={() => {
            inputRef.current?.focus()
            setOpen(true)
          }}
          className={cn(
            FIELD_SHELL,
            'flex h-8 items-center gap-2 px-2.5',
            invalid && INVALID_SHELL
          )}
        >
          {committed ? (
            <Glyph option={selected} />
          ) : (
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <div className="relative min-w-0 flex-1 overflow-hidden">
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label="Project"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="both"
              aria-activedescendant={open && armed ? `${listId}-armed` : undefined}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={describedBy}
              value={query}
              placeholder={committed ? '' : (props.placeholder ?? 'Choose project')}
              onChange={(event) => {
                setQuery(event.target.value)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              className={RAW_INPUT}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center whitespace-pre text-sm"
            >
              <span className={committed ? 'min-w-0 shrink truncate' : 'invisible'}>
                {committed ? selected.displayName : query}
              </span>
              {committed ? null : <span className="text-muted-foreground/60">{ghost}</span>}
              {trailing ? (
                <span className="ml-2 min-w-0 shrink truncate text-[11px] text-muted-foreground">
                  {trailing}
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Browse projects"
            onMouseDown={keepFocus}
            onClick={(event) => {
              event.stopPropagation()
              inputRef.current?.focus()
              setOpen(!open)
            }}
            className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] min-w-[17rem] p-0"
        onOpenAutoFocus={keepFocus}
        onCloseAutoFocus={keepFocus}
      >
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Projects"
          className="max-h-64 overflow-y-auto p-1 scrollbar-sleek"
        >
          {rows.map((row) => {
            const armedHere = isArmed(row)
            return (
              <div
                key={row.key}
                role="option"
                id={armedHere ? `${listId}-armed` : undefined}
                aria-selected={armedHere}
                data-armed={armedHere}
                data-current={row.scored?.option.id === value ? 'true' : undefined}
                onMouseDown={keepFocus}
                onMouseMove={() => arm(row.key)}
                onClick={() => commit(row)}
                className={cn(
                  'flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
                  armedHere && 'bg-accent text-accent-foreground',
                  row.scored === null && 'mt-1 border-t border-border pt-2'
                )}
              >
                {row.scored ? (
                  <>
                    <Glyph option={row.scored.option} />
                    <Hit text={row.scored.option.displayName} hits={row.scored.nameHits} />
                    <span
                      className={cn(
                        'ml-auto flex min-w-0 shrink pl-2 text-[11px]',
                        ambiguous.has(row.scored.option.id)
                          ? 'text-foreground/80'
                          : 'text-muted-foreground'
                      )}
                    >
                      <Hit text={row.scored.option.detail} hits={row.scored.detailHits} />
                    </span>
                  </>
                ) : (
                  <>
                    <FolderPlus className="size-3.5 text-muted-foreground" />
                    <span>Add a new project</span>
                  </>
                )}
              </div>
            )
          })}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border px-2.5 py-1.5">
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShortcutKeyCombo keys={['↵']} />
            <span className="truncate">
              {armedOption
                ? ambiguous.has(armedOption.id)
                  ? `${armedOption.displayName} · ${discriminator(armedOption)}`
                  : armedOption.displayName
                : 'Add a new project'}
            </span>
          </span>
          <span aria-live="polite" className={COUNT}>
            {matches.length} of {options.length}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  )
}

const variants: DesignVariant[] = [
  {
    id: 'typed-ghost-field',
    title: 'Type-ahead field',
    tagline: 'The input is the control: type, watch the completion appear inline, press Enter.',
    notes: [
      'Removes the label row, the add-project icon and the outline trigger, and folds the popover’s nested search box into the field itself — one 32px control you type into directly. There is no trigger, so `triggerClassName` is ignored.',
      'Enter is never a guess: exactly one row is armed at all times and the footer names it. Empty query arms the most recent project; zero matches arms “Add a new project”. Armed is tracked by row key, so a list arriving late over SSH cannot swap the target under a keypress already aimed.',
      'One-line rows halve the list height and make the field and the row read identically. Duplicate names promote their discriminator (`~/code` vs `~/src · devbox`) into both the row and the inline completion, so “scr” never completes blind. Backspace on a committed pick unsticks it into editable text.',
      'Trades: recency ordering needs a real most-recently-used source (new store field); Tab is captured while a completion is pending; the props contract has no null, so a pick can be replaced but not cleared.'
    ],
    Component: TypedGhostField
  },
  {
    id: 'typed-chip-rail',
    title: 'Filter + chip rail',
    tagline:
      'One surface, no popover: a filter line over a live rail of matches, Enter takes the ringed chip.',
    notes: [
      'No floating layer at all — filter row and results are one bordered surface, so there is nothing to open, nothing to reposition, and no popover that lands after the list does on a slow link. Also has no trigger, so `triggerClassName` is ignored.',
      'The armed chip is visible at rest, so Enter is previewed rather than promised. Typing re-ranks in place, ←/→ walk the rail once the caret would leave the text, ↓/↑ expand and collapse the overflow.',
      'Mouse users are first-class without typing: the 5 most recent are one click away at rest, “+N more” reveals the rest, and the committed chip stays visible in `bg-accent` rather than hiding inside a closed trigger. “Add project” is pinned outside the collapse so it survives every state — overflowed, filtered to nothing, or zero projects. Duplicate `scratch` chips carry their discriminator inline.',
      'Trades: the rail costs ~34px permanently and shows 5 of 13 until expanded, so it bets that recency covers the common case; chips are single-line so long names truncate harder than a full-width row; like the other design it can replace but not clear a selection.'
    ],
    Component: TypedChipRail
  }
]

export default variants
