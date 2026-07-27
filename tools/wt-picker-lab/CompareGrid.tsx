import React from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DesignVariant, NewWorkspaceProjectOption } from './design-contract'
import { LAB_PROJECT_OPTIONS } from './fixtures'

/**
 * All designs at once in their resting state — the fastest way to judge "does
 * this still feel bulky?", since bulk is a comparative property.
 */
export default function CompareGrid({
  variants,
  options = LAB_PROJECT_OPTIONS,
  pickedId,
  onPick,
  onOpen
}: {
  variants: DesignVariant[]
  options?: readonly NewWorkspaceProjectOption[]
  pickedId: string | null
  onPick: (id: string) => void
  onOpen: (id: string) => void
}): React.JSX.Element {
  const [selectionByVariant, setSelectionByVariant] = React.useState<Record<string, string | null>>(
    {}
  )

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
      {variants.map((variant) => {
        const { Component } = variant
        return (
          <div
            key={variant.id}
            className={cn(
              'flex min-w-0 flex-col rounded-lg border bg-card p-4 transition',
              pickedId === variant.id ? 'border-ring' : 'border-border'
            )}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold">{variant.title}</div>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                  {variant.tagline}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button type="button" variant="ghost" size="xs" onClick={() => onOpen(variant.id)}>
                  Open
                </Button>
                <Button
                  type="button"
                  variant={pickedId === variant.id ? 'secondary' : 'outline'}
                  size="xs"
                  onClick={() => onPick(variant.id)}
                >
                  {pickedId === variant.id ? 'Picked' : 'Pick'}
                </Button>
              </div>
            </div>
            {/* Why: isolate stacking so one design's open popover can't paint over a neighbour. */}
            <div className="relative isolate min-w-0">
              <Component
                options={options}
                value={selectionByVariant[variant.id] ?? null}
                onValueChange={(id) =>
                  setSelectionByVariant((prev) => ({ ...prev, [variant.id]: id }))
                }
                onAddProject={() => {}}
                placeholder="Choose project"
                triggerClassName="h-9 w-full border-input text-sm focus:border-ring focus:ring-[3px] focus:ring-ring/50"
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
