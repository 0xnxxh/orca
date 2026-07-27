import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen, FolderPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RepoBadgeMark } from '@/components/repo/RepoBadgeLabel'
import { cn } from '@/lib/utils'
import { searchNewWorkspaceProjectOptions } from '@/lib/new-workspace-project-options'
import type { NewWorkspaceProjectOption } from '@/lib/new-workspace-project-options'
import type { ProjectPickerProps } from '../design-contract'
import { LAB_RECENT_PROJECT_IDS } from '../fixtures'

/** Below this a list is scannable, so a search field is chrome, not help. */
export const SEARCH_THRESHOLD = 6
export const RECENT_LIMIT = 4
export const CAP = 'min-w-5 rounded-sm px-1 py-0 text-[10px] leading-[1.4]'

export type PickerGroups = {
  recent: NewWorkspaceProjectOption[]
  projects: NewWorkspaceProjectOption[]
  folders: NewWorkspaceProjectOption[]
}

export function groupOptions(
  options: readonly NewWorkspaceProjectOption[],
  query: string
): PickerGroups {
  const matches = searchNewWorkspaceProjectOptions(options, query)
  const folders: NewWorkspaceProjectOption[] = matches.filter((o) => o.kind === 'project-group')
  const projects: NewWorkspaceProjectOption[] = matches.filter((o) => o.kind === 'project')
  // Recency only earns a section on a list long enough that skipping it helps.
  if (query.trim() !== '' || projects.length < SEARCH_THRESHOLD) {
    return { recent: [], projects, folders }
  }
  const recent = LAB_RECENT_PROJECT_IDS.flatMap(
    (id) => projects.find((option) => option.id === id) ?? []
  ).slice(0, RECENT_LIMIT)
  const recentIds = new Set(recent.map((option) => option.id))
  return { recent, projects: projects.filter((o) => !recentIds.has(o.id)), folders }
}

/** Identity marks share a 16px rail so dots and folder icons align optically. */
export function OptionMark({ option }: { option: NewWorkspaceProjectOption }): React.JSX.Element {
  return (
    <span className="flex w-4 shrink-0 items-center justify-center">
      {option.kind === 'project-group' ? (
        <FolderOpen className="size-3.5 text-muted-foreground" />
      ) : (
        <RepoBadgeMark color={option.badgeColor} className="size-1.5 rounded-[1px]" />
      )}
    </span>
  )
}

/** One identity read, shared by the trigger and every row. */
export function OptionFace({
  option,
  align,
  strong
}: {
  option: NewWorkspaceProjectOption
  align: 'end' | 'inline'
  strong?: boolean
}): React.JSX.Element {
  return (
    <>
      <OptionMark option={option} />
      <span className={cn('min-w-0 truncate', strong === true && 'font-medium')}>
        {option.displayName}
      </span>
      {/* Detail disambiguates duplicate names, so it truncates second, not first. */}
      <span
        className={cn(
          'min-w-0 truncate text-muted-foreground',
          align === 'end' ? 'ml-auto max-w-[52%] text-[11px]' : 'max-w-[55%] text-xs'
        )}
      >
        {option.detail}
      </span>
    </>
  )
}

export type Picker = {
  open: boolean
  setOpen: (open: boolean) => void
  query: string
  setQuery: (query: string) => void
  effectiveValue: string | null
  select: (projectId: string) => void
  addProject: () => void
  handleOpenChange: (next: boolean) => void
  handleCloseAutoFocus: (event: Event) => void
}

export function usePicker(props: ProjectPickerProps): Picker {
  const { value, onValueChange, onValueSelected, onAddProject } = props
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const pickedRef = useRef(false)

  // Why: hold the pick locally so a slow (SSH) parent never shows a stale trigger.
  useEffect(() => setPendingId(null), [value])

  const select = useCallback(
    (projectId: string): void => {
      pickedRef.current = true
      setPendingId(projectId)
      onValueChange(projectId)
      setOpen(false)
      setQuery('')
      onValueSelected?.(projectId)
    },
    [onValueChange, onValueSelected]
  )

  const addProject = useCallback((): void => {
    pickedRef.current = false
    setOpen(false)
    setQuery('')
    onAddProject?.()
  }, [onAddProject])

  const handleOpenChange = useCallback((next: boolean): void => {
    pickedRef.current = false
    setQuery('')
    setOpen(next)
  }, [])

  // Why: Radix restores focus to the trigger on close, but a pick already
  // handed focus to the name field.
  const handleCloseAutoFocus = useCallback(
    (event: Event): void => {
      if (pickedRef.current && onValueSelected) {
        event.preventDefault()
      }
      pickedRef.current = false
    },
    [onValueSelected]
  )

  return {
    open,
    setOpen,
    query,
    setQuery,
    effectiveValue: pendingId ?? value,
    select,
    addProject,
    handleOpenChange,
    handleCloseAutoFocus
  }
}

export function useTypeToOpen(
  picker: Picker,
  searchable: boolean
): (event: React.KeyboardEvent<HTMLButtonElement>) => void {
  const { open, setOpen, setQuery } = picker
  return useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>): void => {
      if (open || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setOpen(true)
        return
      }
      if (event.key.length === 1 && /\S/.test(event.key)) {
        event.preventDefault()
        if (searchable) {
          setQuery(event.key)
        }
        setOpen(true)
      }
    },
    [open, searchable, setOpen, setQuery]
  )
}

export function AddProjectRow({
  onAddProject,
  divided,
  className,
  style,
  buttonRef,
  children
}: {
  onAddProject: () => void
  /** False when Add is the only row, so it doesn't draw a border on the popover edge. */
  divided: boolean
  className?: string
  style?: React.CSSProperties
  buttonRef?: React.Ref<HTMLButtonElement>
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={cn('flex items-center gap-1 pr-2', divided && 'border-t border-border')}>
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        style={style}
        onClick={onAddProject}
        onMouseDown={(event) => event.preventDefault()}
        // Why: cmdk preventDefaults Enter on the Command root, which would
        // otherwise swallow activation of the only control in the empty state.
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            event.stopPropagation()
            onAddProject()
          }
        }}
        className={cn('min-w-0 flex-1 justify-start rounded-none font-normal', className)}
      >
        <FolderPlus className="size-3.5 text-muted-foreground" />
        <span className="truncate">Add a new project</span>
      </Button>
      {children}
    </div>
  )
}

export type RowsProps = {
  options: NewWorkspaceProjectOption[]
  heading?: string
  value: string | null
  onSelect: (projectId: string) => void
}
