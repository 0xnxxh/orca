import React from 'react'
import { FolderPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import ProjectCombobox from '@/components/new-workspace/ProjectCombobox'
import type { DesignVariant, ProjectPickerProps } from '../design-contract'

// The shipped Project slot, reproduced exactly as NewWorkspaceComposerCard
// renders it (label row + add-project icon + combobox) — the thing every
// variant is measured against.
function Baseline(props: ProjectPickerProps): React.JSX.Element {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-muted-foreground">Project</label>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={props.onAddProject}
              className="size-5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
              aria-label="Add project"
            >
              <FolderPlus className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            Add project
          </TooltipContent>
        </Tooltip>
      </div>
      <ProjectCombobox {...props} />
    </div>
  )
}

export const baselineVariant: DesignVariant = {
  id: 'baseline',
  title: 'Current (shipped)',
  tagline: 'Today’s Project slot: label row, outline trigger, popover, cmdk list, pinned Add row.',
  notes: [
    'Label + add-icon row + 36px outline trigger + chevron — three layers of chrome before any choice is made.',
    'Two-line rows (name over detail) turn a modest project list into a scroll.',
    'Search field, empty state, and pinned footer repeat chrome inside a 288px popover.',
    'The most common case — reopening the project you always use — costs a click, a scan, and a click.'
  ],
  Component: Baseline
}
