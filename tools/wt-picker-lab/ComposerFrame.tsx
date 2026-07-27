import React from 'react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { DesignVariant, NewWorkspaceProjectOption } from './design-contract'
import { LAB_PROJECT_OPTIONS } from './fixtures'

/**
 * The real "Create worktree" dialog chrome (DialogContent recipe, sm:max-w-lg)
 * with the Project row swapped for a variant, so each design is judged in the
 * surface it will actually ship into — not on a blank page.
 */
export default function ComposerFrame({
  variant,
  options = LAB_PROJECT_OPTIONS,
  selectedId,
  onSelectedIdChange
}: {
  variant: DesignVariant
  options?: readonly NewWorkspaceProjectOption[]
  selectedId: string | null
  onSelectedIdChange: (id: string | null) => void
}): React.JSX.Element {
  const nameInputRef = React.useRef<HTMLInputElement>(null)
  const { Component } = variant

  return (
    <div className="w-full max-w-lg rounded-lg border border-black/14 bg-background/96 p-6 text-foreground shadow-[0_20px_60px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl dark:border-white/14 dark:bg-[rgba(23,23,23,0.96)] dark:shadow-[0_24px_72px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="mb-4 text-base font-semibold">Create worktree</div>

      <div className="min-w-0 space-y-4">
        <Component
          options={options}
          value={selectedId}
          onValueChange={onSelectedIdChange}
          onValueSelected={() => nameInputRef.current?.focus()}
          onAddProject={() => {}}
          placeholder="Choose project"
          triggerClassName="h-9 w-full border-input text-sm focus:border-ring focus:ring-[3px] focus:ring-ring/50"
        />
        {options.length === 0 ? (
          // Mirrors the real card's empty-projects helper text.
          <p className="!mt-1 text-[11px] text-muted-foreground">
            Add a project before creating a workspace.
          </p>
        ) : null}

        <div className="min-w-0 space-y-1">
          <label className="block min-w-0 truncate text-xs font-medium text-muted-foreground">
            Name or &apos;Create From&apos;{' '}
            <span className="text-muted-foreground/70">[Optional]</span>
          </label>
          <input
            ref={nameInputRef}
            type="text"
            placeholder="Search issues, PRs, or branches"
            className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Agent</label>
          <div className="flex h-9 w-full items-center justify-between rounded-md border border-input px-3 text-sm text-muted-foreground shadow-xs">
            <span className="text-foreground">Claude Code</span>
            <span className="opacity-50">⌄</span>
          </div>
        </div>

        <Button type="button" variant="ghost" size="sm" className="-ml-2 text-xs">
          Advanced <span className="opacity-60">⌄</span>
        </Button>

        <Separator />

        <div className="flex justify-end">
          <Button type="button" disabled={!selectedId}>
            Create worktree
          </Button>
        </div>
      </div>
    </div>
  )
}
