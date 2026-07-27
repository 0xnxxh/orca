import React, { useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
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
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { cn } from '@/lib/utils'
import type { DesignVariant, ProjectPickerProps } from '../design-contract'
import {
  AddProjectRow,
  CAP,
  OptionFace,
  SEARCH_THRESHOLD,
  groupOptions,
  usePicker,
  useTypeToOpen
} from './refined-picker-core'
import type { RowsProps } from './refined-picker-core'

const TIGHT_HEADING =
  'p-0 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.05em] [&_[cmdk-group-heading]]:text-muted-foreground'

function TightRows({ options, heading, value, onSelect }: RowsProps): React.JSX.Element | null {
  if (options.length === 0) {
    return null
  }
  return (
    <CommandGroup heading={heading} className={TIGHT_HEADING}>
      {options.map((option) => (
        <CommandItem
          key={option.id}
          value={option.id}
          onSelect={() => onSelect(option.id)}
          data-current={option.id === value ? 'true' : undefined}
          className={cn(
            'h-7 gap-2 rounded-sm px-2 py-0 text-[13px] data-[selected=true]:ring-1 data-[selected=true]:ring-border data-[selected=true]:ring-inset',
            option.id === value && 'bg-accent/70'
          )}
        >
          <OptionFace option={option} align="end" strong={option.id === value} />
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

/**
 * Tight: one 28px line per project, a header that states the count until the
 * list is long enough to search, recency and folders as labelled sections.
 */
function RefinedTight(props: ProjectPickerProps): React.JSX.Element {
  const { options, placeholder = 'Choose project', triggerClassName, invalid, describedBy } = props
  const picker = usePicker(props)
  const [commandValue, setCommandValue] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const selected = options.find((option) => option.id === picker.effectiveValue) ?? null
  const groups = useMemo(() => groupOptions(options, picker.query), [options, picker.query])
  // A 2-project list needs neither a search field nor a count.
  const showHeader = options.length >= 3
  const handleTriggerKeyDown = useTypeToOpen(picker, showHeader)

  return (
    <div className="min-w-0 space-y-1">
      <label className="text-xs font-medium text-muted-foreground">Project</label>
      <Popover
        open={picker.open}
        onOpenChange={(next) => {
          picker.handleOpenChange(next)
          setCommandValue(next ? (picker.effectiveValue ?? '') : '')
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={picker.open}
            aria-invalid={invalid === true ? true : undefined}
            aria-describedby={describedBy}
            onKeyDown={handleTriggerKeyDown}
            className={cn(
              'group h-8 w-full min-w-0 justify-between gap-2 px-2.5 text-sm font-normal data-[state=open]:border-ring data-[state=open]:ring-[3px] data-[state=open]:ring-ring/50',
              triggerClassName
            )}
          >
            {selected ? (
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <OptionFace option={selected} align="end" />
              </span>
            ) : (
              <span className="flex-1 truncate text-left text-muted-foreground">{placeholder}</span>
            )}
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={5}
          className="w-[var(--radix-popover-trigger-width)] min-w-[17rem] p-0 duration-150 data-[state=closed]:duration-100 motion-reduce:animate-none"
          onCloseAutoFocus={picker.handleCloseAutoFocus}
          // Why: with no search field the list itself has to take focus, or
          // Radix parks it on Add-a-new-project and arrows never reach a row.
          onOpenAutoFocus={
            showHeader
              ? undefined
              : (event) => {
                  event.preventDefault()
                  const target = listRef.current ?? addButtonRef.current
                  target?.focus()
                }
          }
        >
          <Command shouldFilter={false} value={commandValue} onValueChange={setCommandValue}>
            {showHeader ? (
              <CommandInput
                autoFocus
                value={picker.query}
                onValueChange={picker.setQuery}
                placeholder={
                  options.length >= SEARCH_THRESHOLD
                    ? 'Search projects'
                    : `${options.length} projects`
                }
                wrapperClassName="h-8 gap-0 border-b border-border bg-muted/40 px-2.5 py-0"
                iconClassName={cn(
                  'mr-2 h-3.5 w-3.5 opacity-40',
                  options.length < SEARCH_THRESHOLD && 'hidden'
                )}
                className="h-8 py-0 text-[13px]"
              />
            ) : null}
            {/* List height lands the cut mid-row, so overflow reads as "more below". */}
            {options.length > 0 ? (
              <CommandList
                ref={listRef}
                tabIndex={showHeader ? undefined : -1}
                className="max-h-[16.5rem] p-1 outline-none"
              >
                <CommandEmpty className="py-5 text-[13px]">No projects match.</CommandEmpty>
                <TightRows
                  options={groups.recent}
                  heading="Recent"
                  value={picker.effectiveValue}
                  onSelect={picker.select}
                />
                <TightRows
                  options={groups.projects}
                  heading={groups.recent.length > 0 ? 'All projects' : undefined}
                  value={picker.effectiveValue}
                  onSelect={picker.select}
                />
                <TightRows
                  options={groups.folders}
                  heading="Folders"
                  value={picker.effectiveValue}
                  onSelect={picker.select}
                />
              </CommandList>
            ) : null}
            <AddProjectRow
              onAddProject={picker.addProject}
              divided={options.length > 0}
              buttonRef={addButtonRef}
              className="h-8 px-2.5 text-xs"
            >
              {options.length > 0 ? (
                <span className="flex shrink-0 items-center gap-0.5">
                  <ShortcutKeyCombo keys={['↑']} keyCapClassName={CAP} />
                  <ShortcutKeyCombo keys={['↓']} keyCapClassName={CAP} />
                  <ShortcutKeyCombo keys={['↵']} keyCapClassName={CAP} />
                </span>
              ) : null}
            </AddProjectRow>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

const variants: DesignVariant[] = [
  {
    id: 'refined-tight',
    title: 'Refined · Tight',
    tagline:
      'The same trigger + popover, executed dense: 28px single-line rows, recency and folders as sections, one shared identity read.',
    notes: [
      'Bulky: the label row drops its add-project icon (Add already lives in the popover), rows collapse from two lines to one 28px line, and the empty checkmark column is gone — selection is the persistent accent row plus a medium-weight name.',
      'Unpolished: trigger and rows now use the same mark + name + right-aligned detail, so a project reads identically in both places, and dots and folder icons share a 16px rail so names align optically.',
      'The header states the count ("4 projects") and only becomes a search field past 6 options — under 3 it disappears entirely. The footer does two jobs: Add a new project at the left, ↑ ↓ ↵ hints at the right.',
      'Trades: right-aligned detail means a long provider path eats the row from the middle instead of the end; recency needs a real recents field in the store; 28px rows are a smaller pointer target than 36px ones.'
    ],
    Component: RefinedTight
  }
]

export default variants
