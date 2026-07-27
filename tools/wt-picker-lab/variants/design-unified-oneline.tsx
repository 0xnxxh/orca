import React from 'react'
import { CornerDownLeft, FolderPlus } from 'lucide-react'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { cn } from '@/lib/utils'
import type { DesignVariant, ProjectPickerProps } from '../design-contract'
import {
  HINT,
  IS_MAC,
  LINE_INPUT,
  OptionMark,
  useOptimisticSelection,
  usePickerNav
} from './unified-picker-nav'

// ── B. One line, two meanings ─────────────────────────────────────────────────

function OneLine({
  options,
  value,
  onValueChange,
  onValueSelected,
  onAddProject,
  placeholder = 'Choose project',
  invalid = false,
  describedBy
}: ProjectPickerProps): React.JSX.Element {
  const [scoping, setScoping] = React.useState(true)
  const [query, setQuery] = React.useState('')
  const [name, setName] = React.useState('')
  const queryRef = React.useRef<HTMLInputElement>(null)
  const nameRef = React.useRef<HTMLInputElement>(null)
  const stripRef = React.useRef<HTMLDivElement>(null)
  const stripId = React.useId()
  const [selected, setPending] = useOptimisticSelection(options, value)
  const nav = usePickerNav(options, query, Boolean(onAddProject), selected?.id ?? null)
  const ambiguous = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const option of options) {
      counts.set(option.displayName, (counts.get(option.displayName) ?? 0) + 1)
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([n]) => n))
  }, [options])
  // Nothing matches, so the same string reads as a name against the top project.
  const nameFallback = nav.items.length === 0 && query.trim() ? (options[0] ?? null) : null
  const preview = nav.items[nav.active] ?? null

  React.useEffect(() => {
    stripRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [nav.active, nav.items])

  const openScope = (): void => {
    setScoping(true)
    setQuery('')
    nav.setActive(0)
    requestAnimationFrame(() => queryRef.current?.focus())
  }

  const toName = (): void => {
    setScoping(false)
    setQuery('')
    requestAnimationFrame(() => nameRef.current?.focus())
  }

  const commit = (projectId: string, pendingName?: string): void => {
    if (pendingName !== undefined) {
      setName(pendingName)
    }
    setPending(projectId)
    onValueChange(projectId)
    onValueSelected?.(projectId)
    // Why: the contract hands focus to the composer's Name field; this design
    // owns naming, so it takes the caret back on the next frame.
    toName()
  }

  const onQueryKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (nav.navigate(event, query.length === 0)) {
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (nameFallback) {
        commit(nameFallback.id, query.trim())
      } else if (nav.active === nav.addIndex) {
        onAddProject?.()
      } else if (preview) {
        commit(preview.id)
      }
      return
    }
    const backOut = event.key === 'Escape' || (event.key === 'Backspace' && query.length === 0)
    if (backOut && selected) {
      event.preventDefault()
      toName()
    }
  }

  const onLineKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if ((IS_MAC ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'p') {
      event.preventDefault()
      openScope()
    }
  }

  return (
    <div className="min-w-0" onKeyDown={onLineKeyDown}>
      <div
        className={cn(
          'flex h-8 min-w-0 items-center gap-2 border-b',
          invalid ? 'border-destructive' : 'border-transparent'
        )}
      >
        {selected && !scoping ? (
          <button
            type="button"
            role="combobox"
            aria-expanded={false}
            aria-haspopup="listbox"
            aria-describedby={describedBy}
            data-project-combobox-root="true"
            onClick={openScope}
            className="-ml-1 flex max-w-[45%] shrink-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <OptionMark option={selected} />
            <span className="truncate font-medium">{selected.displayName}</span>
            <span className="text-muted-foreground">/</span>
          </button>
        ) : (
          <OptionMark option={null} />
        )}

        {scoping ? (
          <input
            ref={queryRef}
            type="text"
            role="combobox"
            aria-expanded={true}
            aria-controls={stripId}
            aria-autocomplete="list"
            aria-activedescendant={nav.items.length > 0 ? `${stripId}-${nav.active}` : undefined}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            data-project-combobox-root="true"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              nav.setActive(0)
            }}
            onKeyDown={onQueryKeyDown}
            placeholder={placeholder}
            className={LINE_INPUT}
          />
        ) : (
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Backspace' && name.length === 0) {
                event.preventDefault()
                openScope()
              }
            }}
            placeholder="Name this worktree"
            className={LINE_INPUT}
          />
        )}

        {scoping ? (
          <span className={HINT}>↑↓ ↵</span>
        ) : (
          <ShortcutKeyCombo keys={[IS_MAC ? '⌘' : 'Ctrl', 'P']} className="shrink-0" />
        )}
      </div>

      {scoping ? (
        <div
          ref={stripRef}
          id={stripId}
          role="listbox"
          className="mt-2 flex min-w-0 items-center gap-1 overflow-x-auto scrollbar-sleek pb-1"
        >
          {nav.items.map((option, index) => (
            <div
              key={option.id}
              id={`${stripId}-${index}`}
              {...nav.rowProps(index, () => commit(option.id))}
              className={cn(
                'flex h-6 shrink-0 cursor-default items-center gap-1.5 rounded-full border px-2 text-xs transition-colors',
                index === nav.active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                option.id === selected?.id ? 'border-ring/70' : 'border-border'
              )}
            >
              <OptionMark
                option={option}
                className={option.kind === 'project-group' ? 'size-3' : undefined}
              />
              <span
                className={cn(
                  'max-w-[10rem] truncate',
                  option.id === selected?.id && 'font-medium'
                )}
              >
                {option.displayName}
              </span>
              {ambiguous.has(option.displayName) ? (
                <span className="max-w-[8rem] truncate text-muted-foreground">{option.detail}</span>
              ) : null}
            </div>
          ))}
          {onAddProject ? (
            <div
              {...nav.rowProps(nav.addIndex, () => onAddProject())}
              className={cn(
                'flex h-6 shrink-0 cursor-default items-center gap-1.5 rounded-full border border-dashed border-border px-2 text-xs transition-colors',
                nav.active === nav.addIndex
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60'
              )}
            >
              <FolderPlus className="size-3" />
              <span>Add project</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {scoping && options.length > 0 ? (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <CornerDownLeft className="size-3 shrink-0" />
          {nameFallback ? (
            <span className="min-w-0 truncate">
              {`Name it “${query.trim()}” in `}
              <span className="text-foreground">{nameFallback.displayName}</span>
            </span>
          ) : preview ? (
            <span className="min-w-0 truncate">
              {'Create in '}
              <span className="text-foreground">{preview.displayName}</span>
              {` · ${preview.detail}`}
            </span>
          ) : (
            <span className="min-w-0 truncate">Add a project to continue</span>
          )}
        </div>
      ) : null}
    </div>
  )
}

const variants: DesignVariant[] = [
  {
    id: 'unified-oneline',
    title: 'One line, two meanings',
    tagline:
      'A borderless command line where one string means both “which project” and “what to call it” — a query that matches nothing becomes the worktree name.',
    notes: [
      'Bulky: no label, no border, no field box, no popover, no footer. Choosing costs zero opens — a recency-ranked pill strip is already on screen — and the answered state is a single 32px line reading “● orca / name”.',
      'Unpolished: pills carry the same mark and name as the chip, and detail text appears only where it disambiguates (the two scratch projects), so 13 options fit without a second line per row. The dead no-match state becomes the useful one: it flips to “Name it ‘x’ in ● orca” and Enter takes it.',
      'Traded away: real ambiguity. The same keystrokes mean two things and the flip point is invisible until it happens, so a project named like a branch hijacks the name path. A borderless line is also weaker as an affordance, and a horizontal strip only scales to what fits — past ~6 projects you must type.',
      'Needs the rest of the composer to change: it owns naming, so it fires onValueSelected as contracted and then takes the caret back into its own name segment. Shipping it means deleting the composer Name field and letting this line write that state; the frame Name input below is the redundancy it argues against. Ignores triggerClassName (no trigger).'
    ],
    Component: OneLine
  }
]

export default variants
