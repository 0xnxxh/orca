import type {
  WorkspaceCleanupFilterState,
  WorkspaceCleanupSortState
} from './workspace-cleanup-filter-model'
import {
  toWorkspaceCleanupPreset,
  WORKSPACE_CLEANUP_BUILT_IN_PRESETS,
  type WorkspaceCleanupCustomPreset,
  type WorkspaceCleanupPreset
} from './workspace-cleanup-presets'

export type WorkspaceCleanupPresetApplication = {
  filters: WorkspaceCleanupFilterState
  sort: WorkspaceCleanupSortState
}

export function listWorkspaceCleanupPresets(
  customPresets: readonly WorkspaceCleanupCustomPreset[] = []
): WorkspaceCleanupPreset[] {
  // Custom ids win: a user preset that shadows a built-in id must not be unreachable.
  const customs = customPresets.map(toWorkspaceCleanupPreset)
  const customIds = new Set(customs.map((preset) => preset.id))
  return [...WORKSPACE_CLEANUP_BUILT_IN_PRESETS.filter((p) => !customIds.has(p.id)), ...customs]
}

export function findWorkspaceCleanupPreset(
  presetId: string | null,
  customPresets: readonly WorkspaceCleanupCustomPreset[] = []
): WorkspaceCleanupPreset | null {
  if (presetId === null) {
    return null
  }
  return listWorkspaceCleanupPresets(customPresets).find((p) => p.id === presetId) ?? null
}

/** Deep clone so the UI can mutate applied state without editing the preset definition. */
export function applyWorkspaceCleanupPreset(
  preset: WorkspaceCleanupPreset
): WorkspaceCleanupPresetApplication {
  return {
    filters: cloneWorkspaceCleanupFilterState(preset.filters),
    sort: { ...preset.sort }
  }
}

export function cloneWorkspaceCleanupFilterState(
  filters: WorkspaceCleanupFilterState
): WorkspaceCleanupFilterState {
  return {
    query: filters.query,
    activity: { ...filters.activity },
    size: { ...filters.size },
    status: { ...filters.status, workspaceStatuses: [...filters.status.workspaceStatuses] },
    agent: { ...filters.agent, states: [...filters.agent.states] },
    git: { ...filters.git, states: [...filters.git.states] },
    review: {
      ...filters.review,
      states: [...filters.review.states],
      providers: [...filters.review.providers]
    },
    ticket: { ...filters.ticket, sources: [...filters.ticket.sources] },
    context: { ...filters.context },
    location: {
      ...filters.location,
      hostIds: [...filters.location.hostIds],
      repoIds: [...filters.location.repoIds]
    },
    safety: {
      ...filters.safety,
      blockers: [...filters.safety.blockers],
      tiers: [...filters.safety.tiers]
    }
  }
}

/** Selection order is not meaning, so multi-selects compare as sets. */
export function isWorkspaceCleanupFilterStateEqual(
  left: WorkspaceCleanupFilterState,
  right: WorkspaceCleanupFilterState
): boolean {
  return toComparableFilterState(left) === toComparableFilterState(right)
}

export function isWorkspaceCleanupSortStateEqual(
  left: WorkspaceCleanupSortState,
  right: WorkspaceCleanupSortState
): boolean {
  return left.field === right.field && left.direction === right.direction
}

/**
 * Preset id whose filters+sort the current state still matches, or null once the
 * user has edited away from it. Lets the UI mark a preset chip as active/modified.
 */
export function matchWorkspaceCleanupPresetId(
  state: WorkspaceCleanupPresetApplication,
  customPresets: readonly WorkspaceCleanupCustomPreset[] = []
): string | null {
  const match = listWorkspaceCleanupPresets(customPresets).find(
    (preset) =>
      isWorkspaceCleanupFilterStateEqual(preset.filters, state.filters) &&
      isWorkspaceCleanupSortStateEqual(preset.sort, state.sort)
  )
  return match?.id ?? null
}

export function createWorkspaceCleanupCustomPreset(args: {
  id: string
  label: string
  state: WorkspaceCleanupPresetApplication
  createdAt: number
}): WorkspaceCleanupCustomPreset {
  return {
    id: args.id,
    label: args.label,
    filters: cloneWorkspaceCleanupFilterState(args.state.filters),
    sort: { ...args.state.sort },
    createdAt: args.createdAt
  }
}

function toComparableFilterState(filters: WorkspaceCleanupFilterState): string {
  const normalized = cloneWorkspaceCleanupFilterState(filters)
  normalized.query = normalized.query.trim().toLowerCase()
  normalized.git.branchQuery = normalized.git.branchQuery.trim().toLowerCase()
  normalized.location.pathPrefix = normalized.location.pathPrefix.trim()
  normalized.status.workspaceStatuses.sort()
  normalized.agent.states.sort()
  normalized.git.states.sort()
  normalized.review.states.sort()
  normalized.review.providers.sort()
  normalized.ticket.sources.sort()
  normalized.location.hostIds.sort()
  normalized.location.repoIds.sort()
  normalized.safety.blockers.sort()
  normalized.safety.tiers.sort()
  return JSON.stringify(normalized)
}
