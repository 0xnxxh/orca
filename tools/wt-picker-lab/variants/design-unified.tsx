import React from 'react'
import { ChevronsUpDown, FolderPlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DesignVariant, ProjectPickerProps } from '../design-contract'
import {
  DETAIL,
  HINT,
  LINE_INPUT,
  OptionMark,
  useOptimisticSelection,
  usePickerNav
} from './unified-picker-nav'

// ── A. Scoped line ────────────────────────────────────────────────────────────

function ScopedLine({
  options,
  value,
  onValueChange,
  onValueSelected,
  onAddProject,
  placeholder = 'Choose project',
  invalid = false,
  describedBy
}: ProjectPickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const rootRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const listId = React.useId()
  const [selected, setPending] = useOptimisticSelection(options, value)
  const nav = usePickerNav(options, query, Boolean(onAddProject), selected?.id ?? null)

  React.useEffect(() => {
    if (!open) {
      return
    }
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  const openScope = (seed: string): void => {
    setQuery(seed)
    nav.setActive(0)
    setOpen(true)
  }

  const close = (restoreFocus: boolean): void => {
    setOpen(false)
    setQuery('')
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus())
    }
  }

  const commit = (projectId: string): void => {
    close(false)
    setPending(projectId)
    onValueChange(projectId)
    onValueSelected?.(projectId)
  }

  const addProject = (): void => {
    close(false)
    onAddProject?.()
  }

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (nav.navigate(event)) {
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const option = nav.items[nav.active]
      if (nav.active === nav.addIndex) {
        addProject()
      } else if (option) {
        commit(option.id)
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Tab') {
      close(false)
    }
  }

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      openScope('')
    } else if (
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      event.key.length === 1 &&
      /\S/.test(event.key)
    ) {
      event.preventDefault()
      openScope(event.key)
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      {open ? (
        <div className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md rounded-b-none border border-input border-b-transparent px-3 dark:bg-input/30">
          <OptionMark option={null} />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={true}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={nav.items.length > 0 ? `${listId}-${nav.active}` : undefined}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              nav.setActive(0)
            }}
            onKeyDown={onInputKeyDown}
            placeholder={selected?.displayName ?? placeholder}
            className={LINE_INPUT}
          />
          <span className={HINT}>↑↓ ↵</span>
        </div>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-expanded={false}
          aria-haspopup="listbox"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          data-project-combobox-root="true"
          onClick={() => openScope('')}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            'group flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-3 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
            selected
              ? 'hover:bg-accent/60'
              : 'border border-input bg-transparent shadow-xs focus-visible:border-ring dark:bg-input/30',
            invalid && (selected ? 'text-destructive' : 'border-destructive')
          )}
        >
          <OptionMark option={selected} />
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-left',
              selected ? 'font-medium' : 'text-muted-foreground'
            )}
          >
            {selected?.displayName ?? placeholder}
          </span>
          {selected ? (
            <>
              <span className={cn(DETAIL, 'max-w-[46%]')}>{selected.detail}</span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            </>
          ) : null}
        </button>
      )}

      {open ? (
        <div
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-50 -mt-px overflow-hidden rounded-md rounded-t-none border border-input bg-popover shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
        >
          <div className="max-h-64 overflow-y-auto scrollbar-sleek p-1">
            {nav.items.map((option, index) => (
              <React.Fragment key={option.id}>
                {nav.headings.has(index) ? (
                  <div className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
                    {nav.headings.get(index)}
                  </div>
                ) : null}
                <div
                  id={`${listId}-${index}`}
                  {...nav.rowProps(index, () => commit(option.id))}
                  className={cn(
                    'flex h-7 cursor-default items-center gap-2 rounded-sm px-2 text-sm',
                    index === nav.active && 'bg-accent text-accent-foreground'
                  )}
                >
                  <OptionMark option={option} />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      option.id === selected?.id && 'font-medium'
                    )}
                  >
                    {option.displayName}
                  </span>
                  <span className={cn(DETAIL, 'max-w-[46%] pl-3')}>{option.detail}</span>
                </div>
              </React.Fragment>
            ))}
            {nav.items.length === 0 && options.length > 0 ? (
              <div className="px-2 py-2 text-[13px] text-muted-foreground">No project matches.</div>
            ) : null}
          </div>
          {onAddProject ? (
            <div
              {...nav.rowProps(nav.addIndex, addProject)}
              className={cn(
                'flex h-8 cursor-default items-center gap-2 border-t border-border px-3 text-sm',
                nav.active === nav.addIndex && 'bg-accent text-accent-foreground'
              )}
            >
              <FolderPlus className="size-3.5 shrink-0 text-muted-foreground" />
              <span>Add a new project</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const variants: DesignVariant[] = [
  {
    id: 'unified-scope',
    title: 'Scoped line',
    tagline:
      'The line is the search field. Chrome exists only while the question is open; the answer collapses to a borderless scope line.',
    notes: [
      'Bulky: drops the label row, the add-project icon, the chevron, and the popover-with-its-own-search. Typing happens in the line itself, so the open state adds one attached panel and nothing else — and the answered state has no border at all.',
      'Unpolished: trigger and rows are the same object (mark, name, right-aligned detail, one 28px line). No empty checkmark column — the current project is bold on an accent row; recents lead, under Recent / All projects headings once the list passes six.',
      'Traded away: ignores triggerClassName, because the passed border+ring recipe fights the chrome-less answered state. Recency comes from LAB_RECENT_PROJECT_IDS, which the real app would need as a store field. The panel is hand-positioned, not a Radix Popover, so no collision flipping.',
      'Only the leading edge: it still hands focus to the composer Name field. To finish the idea, Name and Agent lose their labels too and stack as continuation lines on the same left edge, so the card reads as one surface instead of three boxed fields.'
    ],
    Component: ScopedLine
  }
]

export default variants
