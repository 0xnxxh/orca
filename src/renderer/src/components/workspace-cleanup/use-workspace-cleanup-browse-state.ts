import { useCallback, useMemo } from 'react'
import { useAppStore } from '@/store'
import type { WorkspaceCleanupBrowseState } from '../../../../shared/workspace-cleanup-browse-state'
import {
  createDefaultWorkspaceCleanupFilterState,
  DEFAULT_WORKSPACE_CLEANUP_SORT,
  type WorkspaceCleanupFilterState,
  type WorkspaceCleanupSortField,
  type WorkspaceCleanupSortState
} from '../../../../shared/workspace-cleanup-filter-model'
import {
  applyWorkspaceCleanupPreset,
  listWorkspaceCleanupPresets,
  matchWorkspaceCleanupPresetId
} from '../../../../shared/workspace-cleanup-preset-state'
import type { WorkspaceCleanupPreset } from '../../../../shared/workspace-cleanup-presets'

export type WorkspaceCleanupBrowseController = {
  browse: WorkspaceCleanupBrowseState
  filters: WorkspaceCleanupFilterState
  sort: WorkspaceCleanupSortState
  presets: WorkspaceCleanupPreset[]
  /** Preset the current state still matches; null once the user edits away from one. */
  matchedPresetId: string | null
  setFilters: (next: WorkspaceCleanupFilterState) => void
  patchFilters: <K extends keyof WorkspaceCleanupFilterState>(
    key: K,
    value: Partial<WorkspaceCleanupFilterState[K]> | WorkspaceCleanupFilterState[K]
  ) => void
  setSort: (next: WorkspaceCleanupSortState) => void
  toggleSortField: (field: WorkspaceCleanupSortField) => void
  applyPreset: (preset: WorkspaceCleanupPreset) => void
  clearFilters: () => void
}

/**
 * Single seam over the persisted browse slice so the dialog never owns filter,
 * sort, or preset state — reopening the dialog must not discard the user's view.
 */
export function useWorkspaceCleanupBrowseState(): WorkspaceCleanupBrowseController {
  const browse = useAppStore((s) => s.workspaceCleanupBrowse)
  const updateBrowse = useAppStore((s) => s.updateWorkspaceCleanupBrowseState)

  const presets = useMemo(
    () => listWorkspaceCleanupPresets(browse.customPresets),
    [browse.customPresets]
  )
  const matchedPresetId = useMemo(
    () =>
      matchWorkspaceCleanupPresetId(
        { filters: browse.filters, sort: browse.sort },
        browse.customPresets
      ),
    [browse.customPresets, browse.filters, browse.sort]
  )

  const setFilters = useCallback(
    (next: WorkspaceCleanupFilterState) => {
      updateBrowse({ ...browse, filters: next })
    },
    [browse, updateBrowse]
  )

  const patchFilters = useCallback<WorkspaceCleanupBrowseController['patchFilters']>(
    (key, value) => {
      const current = browse.filters[key]
      const next =
        typeof current === 'object' && current !== null
          ? { ...current, ...(value as object) }
          : value
      // Cast: a computed key over a union widens the spread result past
      // WorkspaceCleanupFilterState even though `key` is constrained to it.
      const filters = { ...browse.filters, [key]: next } as WorkspaceCleanupFilterState
      updateBrowse({ ...browse, filters })
    },
    [browse, updateBrowse]
  )

  const setSort = useCallback(
    (next: WorkspaceCleanupSortState) => {
      updateBrowse({ ...browse, sort: next })
    },
    [browse, updateBrowse]
  )

  // Why: re-picking the active column flips direction, which is the table
  // convention users expect from a sortable header.
  const toggleSortField = useCallback(
    (field: WorkspaceCleanupSortField) => {
      const direction =
        browse.sort.field === field && browse.sort.direction === 'asc' ? 'desc' : 'asc'
      updateBrowse({ ...browse, sort: { field, direction } })
    },
    [browse, updateBrowse]
  )

  const applyPreset = useCallback(
    (preset: WorkspaceCleanupPreset) => {
      const applied = applyWorkspaceCleanupPreset(preset)
      updateBrowse({ ...browse, activePresetId: preset.id, ...applied })
    },
    [browse, updateBrowse]
  )

  const clearFilters = useCallback(() => {
    updateBrowse({
      ...browse,
      activePresetId: null,
      filters: createDefaultWorkspaceCleanupFilterState(),
      sort: { ...DEFAULT_WORKSPACE_CLEANUP_SORT }
    })
  }, [browse, updateBrowse])

  return {
    browse,
    filters: browse.filters,
    sort: browse.sort,
    presets,
    matchedPresetId,
    setFilters,
    patchFilters,
    setSort,
    toggleSortField,
    applyPreset,
    clearFilters
  }
}
