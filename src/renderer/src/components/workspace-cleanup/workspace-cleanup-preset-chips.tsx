import React from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { WorkspaceCleanupPreset } from '../../../../shared/workspace-cleanup-presets'

export function WorkspaceCleanupPresetChips({
  presets,
  matchedPresetId,
  requestedPresetId,
  hasActiveFilters,
  onApplyPreset,
  onClearFilters
}: {
  presets: readonly WorkspaceCleanupPreset[]
  /** Preset the live filter state still equals, or null once it was edited. */
  matchedPresetId: string | null
  /** Preset the user last picked, even after edits, so the chip can read "modified". */
  requestedPresetId: string | null
  hasActiveFilters: boolean
  onApplyPreset: (preset: WorkspaceCleanupPreset) => void
  onClearFilters: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      <ScrollArea className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 pb-1.5">
          {presets.map((preset) => {
            const active = matchedPresetId === preset.id
            const modified = !active && requestedPresetId === preset.id
            return (
              <Tooltip key={preset.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-pressed={active}
                    data-preset-id={preset.id}
                    data-preset-state={active ? 'active' : modified ? 'modified' : 'idle'}
                    onClick={() => onApplyPreset(preset)}
                    className={cn(
                      'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors',
                      'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                      active && 'bg-accent text-accent-foreground',
                      modified && 'border-dashed text-foreground'
                    )}
                  >
                    <span className="truncate">
                      {preset.labelKey ? translate(preset.labelKey, preset.label) : preset.label}
                    </span>
                    {modified ? (
                      <span className="text-[11px] font-normal text-muted-foreground">
                        {translate('components.workspace.cleanup.browse.presetModified', 'edited')}
                      </span>
                    ) : null}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4}>
                  {preset.descriptionKey
                    ? translate(preset.descriptionKey, preset.description)
                    : preset.description || preset.label}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      {hasActiveFilters ? (
        <Button variant="ghost" size="sm" className="shrink-0" onClick={onClearFilters}>
          <RotateCcw className="size-3.5" />
          {translate('components.workspace.cleanup.browse.clearFilters', 'Clear filters')}
        </Button>
      ) : null}
    </div>
  )
}
