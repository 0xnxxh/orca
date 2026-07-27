import React from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import type { DesignVariant, NewWorkspaceProjectOption } from './design-contract'
import { LAB_PROJECT_OPTIONS } from './fixtures'

/**
 * The picker inside a real Radix Dialog — the surface the composer actually
 * ships in. Radix applies react-remove-scroll here, which cancels wheel events
 * for portaled popovers, so scroll bugs only reproduce in this frame.
 */
export default function DialogFrame({
  variant,
  options = LAB_PROJECT_OPTIONS,
  open,
  onOpenChange
}: {
  variant: DesignVariant
  options?: readonly NewWorkspaceProjectOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  // Mirrors the composer: Create stays pressable and validates on press.
  const [invalid, setInvalid] = React.useState(false)
  const { Component } = variant

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-lg"
        // Mirror the real composer: focus the name field, not whatever Radix
        // picks first (which would pop the Add-project tooltip on open).
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement)
            .querySelector<HTMLElement>('[data-lab-name-input="true"]')
            ?.focus({ preventScroll: true })
        }}
      >
        <DialogTitle className="text-base font-semibold">Create worktree</DialogTitle>
        <div className="min-w-0 space-y-4">
          <Component
            options={options}
            value={selectedId}
            onValueChange={setSelectedId}
            onAddProject={() => {}}
            placeholder="Choose project"
            invalid={invalid}
            describedBy={invalid ? 'lab-project-error' : undefined}
          />
          {invalid ? (
            <p id="lab-project-error" className="text-[11px] text-destructive">
              Choose or add a project before creating a workspace.
            </p>
          ) : null}
          <div className="min-w-0 space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">Name</label>
            <input
              type="text"
              data-lab-name-input="true"
              placeholder="Search issues, PRs, or branches"
              className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setInvalid(selectedId === null)}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            >
              Create worktree
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
