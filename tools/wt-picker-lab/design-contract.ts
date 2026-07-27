import type React from 'react'
import type { NewWorkspaceProjectOption } from '@/lib/new-workspace-project-options'

export type { NewWorkspaceProjectOption }

/**
 * Every design variant is a drop-in replacement for `ProjectCombobox`, so a
 * winning prototype ports back to `NewWorkspaceComposerCard` unchanged.
 */
export type ProjectPickerProps = {
  options: readonly NewWorkspaceProjectOption[]
  value: string | null
  onValueChange: (projectId: string) => void
  /** Fired after a pick lands; the real card uses it to focus the name field. */
  onValueSelected?: (projectId: string) => void
  onAddProject?: () => void
  placeholder?: string
  triggerClassName?: string
  invalid?: boolean
  describedBy?: string
}

export type DesignVariant = {
  /** Stable slug, unique across all agents. Used in URLs and the pick record. */
  id: string
  title: string
  /** One line: the idea in a sentence. */
  tagline: string
  /** What this does about "bulky" / "unpolished". 2-4 bullets. */
  notes: string[]
  Component: React.ComponentType<ProjectPickerProps>
}
