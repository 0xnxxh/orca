import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { cn } from '@/lib/utils'
import type { DesignVariant, ProjectPickerProps } from '../design-contract'
import {
  AddProjectRow,
  CAP,
  OptionFace,
  OptionMark,
  groupOptions,
  usePicker,
  useTypeToOpen
} from './refined-picker-core'
import type { RowsProps } from './refined-picker-core'

const CALM_HEADING =
  'p-0 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-normal [&_[cmdk-group-heading]]:text-muted-foreground'

function CalmRows({ options, heading, value, onSelect }: RowsProps): React.JSX.Element | null {
  if (options.length === 0) {
    return null
  }
  return (
    <CommandGroup heading={heading} className={CALM_HEADING}>
      {options.map((option) => (
        <CommandItem
          key={option.id}
          value={option.id}
          onSelect={() => onSelect(option.id)}
          data-current={option.id === value ? 'true' : undefined}
          className={cn(
            'group h-9 gap-2.5 rounded-md px-2.5 text-sm data-[selected=true]:ring-1 data-[selected=true]:ring-border data-[selected=true]:ring-inset',
            option.id === value && 'bg-accent/70'
          )}
        >
          <OptionFace option={option} align="inline" strong={option.id === value} />
          {/* The trailing edge was a mostly-empty checkmark column; give it both jobs. */}
          <span className="ml-auto flex shrink-0 items-center pl-2 text-muted-foreground">
            <span className="hidden group-data-[selected=true]:inline-flex">
              <ShortcutKeyCombo keys={['↵']} keyCapClassName={CAP} />
            </span>
            {option.id === value ? (
              <Check className="size-3.5 group-data-[selected=true]:hidden" />
            ) : null}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

/**
 * Calm: the trigger becomes the search field in place — the popover opens over
 * it — so the field never doubles up, and the list gets 36px rows and air.
 */
function RefinedCalm(props: ProjectPickerProps): React.JSX.Element {
  const { options, placeholder = 'Choose project', triggerClassName, invalid, describedBy } = props
  const picker = usePicker(props)
  const [commandValue, setCommandValue] = useState('')
  const [triggerHeight, setTriggerHeight] = useState(36)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const selected = options.find((option) => option.id === picker.effectiveValue) ?? null
  const groups = useMemo(() => groupOptions(options, picker.query), [options, picker.query])
  const handleTriggerKeyDown = useTypeToOpen(picker, options.length > 0)
  const showSeparator = groups.recent.length > 0 && groups.projects.length > 0

  // Measure so the popover's input lands exactly on the trigger it replaces.
  const handleOpenChange = useCallback(
    (next: boolean): void => {
      const height = triggerRef.current?.getBoundingClientRect().height
      if (next && height !== undefined && height > 0) {
        setTriggerHeight(height)
      }
      picker.handleOpenChange(next)
      setCommandValue(next ? (picker.effectiveValue ?? '') : '')
    },
    [picker]
  )

  return (
    <div className="min-w-0 space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">Project</label>
      <Popover open={picker.open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={picker.open}
            aria-invalid={invalid === true ? true : undefined}
            aria-describedby={describedBy}
            onKeyDown={handleTriggerKeyDown}
            className={cn(
              'h-9 w-full min-w-0 justify-between gap-2 px-3 text-sm font-normal transition-opacity duration-150 data-[state=open]:opacity-0 motion-reduce:transition-none',
              triggerClassName
            )}
          >
            {selected ? (
              <span className="flex min-w-0 items-center gap-2.5">
                <OptionFace option={selected} align="inline" />
              </span>
            ) : (
              <span className="truncate text-left text-muted-foreground">{placeholder}</span>
            )}
            <Search className="ml-auto size-3.5 shrink-0 text-muted-foreground/60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={-triggerHeight}
          // Why: an in-place overlay can't flip sides without landing off its
          // trigger, so cap to the available height instead of avoiding collisions.
          avoidCollisions={false}
          className="flex max-h-(--radix-popover-content-available-height) w-[var(--radix-popover-trigger-width)] min-w-[18rem] flex-col p-0 duration-200 motion-reduce:animate-none"
          onCloseAutoFocus={picker.handleCloseAutoFocus}
          // Why: with the input hidden there is nothing for autoFocus to land
          // on, so send focus to the one control that remains.
          onOpenAutoFocus={
            options.length > 0
              ? undefined
              : (event) => {
                  event.preventDefault()
                  addButtonRef.current?.focus()
                }
          }
        >
          <Command shouldFilter={false} value={commandValue} onValueChange={setCommandValue}>
            {/* Nothing to search: the Add row alone lands on the trigger. */}
            <div className={cn('relative', options.length === 0 && 'hidden')}>
              {selected ? (
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">
                  <OptionMark option={selected} />
                </span>
              ) : (
                <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
              )}
              <CommandInput
                autoFocus
                value={picker.query}
                onValueChange={picker.setQuery}
                placeholder={selected ? selected.displayName : placeholder}
                wrapperClassName="border-b border-border bg-transparent px-3 py-0"
                iconClassName="hidden"
                className="h-auto py-0 pl-7 text-sm"
                style={{ height: triggerHeight }}
              />
            </div>
            {/* List height lands the cut mid-row, so overflow reads as "more below". */}
            {options.length > 0 ? (
              <CommandList className="max-h-[17.75rem] p-1.5">
                <CommandEmpty className="px-3 py-8 text-sm">
                  No project matches “{picker.query}”.
                </CommandEmpty>
                <CalmRows
                  options={groups.recent}
                  value={picker.effectiveValue}
                  onSelect={picker.select}
                />
                {showSeparator ? <CommandSeparator className="mx-1 my-1.5" /> : null}
                <CalmRows
                  options={groups.projects}
                  value={picker.effectiveValue}
                  onSelect={picker.select}
                />
                <CalmRows
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
              className="px-3 text-sm"
              style={options.length === 0 ? { height: triggerHeight } : undefined}
            />
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

const variants: DesignVariant[] = [
  {
    id: 'refined-calm',
    title: 'Refined · Calm',
    tagline:
      'The trigger becomes the search field in place — the popover opens over it — with 36px rows and air instead of a second field.',
    notes: [
      'Bulky: there is no separate search row. The popover is offset by the measured trigger height so its input lands exactly on the trigger, which fades out — one field whether open or closed — and the add-project icon leaves the label row.',
      'Unpolished: the selected project’s dot and name carry into the open state as the input’s adornment and placeholder, so opening loses nothing; recency is ordering plus a hairline rather than a heading, and folders keep the one label they earn.',
      'The trailing edge does the work the mostly-empty checkmark column used to: ↵ on the row you are about to pick, a check on the one already chosen, nothing anywhere else.',
      'Trades: the overlay depends on measuring the trigger, so it disables collision flipping and caps to the available height instead; covering the trigger hides the current value while you browse; 36px rows show ~7 projects before scrolling.'
    ],
    Component: RefinedCalm
  }
]

export default variants
