import {
  createDefaultWorkspaceCleanupFilterState,
  DEFAULT_WORKSPACE_CLEANUP_SORT,
  type WorkspaceCleanupFilterState,
  type WorkspaceCleanupSortState
} from './workspace-cleanup-filter-model'
import {
  asRecord,
  asString,
  normalizeWorkspaceCleanupFilterState,
  normalizeWorkspaceCleanupSortState
} from './workspace-cleanup-filter-state-codec'
import {
  WORKSPACE_CLEANUP_DEFAULT_PRESET_ID,
  type WorkspaceCleanupCustomPreset
} from './workspace-cleanup-presets'

/** Bump only for a shape change the tolerant normalizer cannot absorb. */
export const WORKSPACE_CLEANUP_BROWSE_STATE_VERSION = 1

export const WORKSPACE_CLEANUP_MAX_CUSTOM_PRESETS = 50

/**
 * Serializable slice of the cleanup dialog persisted under
 * `WorkspaceCleanupUIState.browse`. Everything here is plain JSON so it
 * round-trips through orca-data.json and the client-ui RPC schema.
 */
export type WorkspaceCleanupBrowseState = {
  version: number
  /** Null once the user edits away from a preset; the raw filters still apply. */
  activePresetId: string | null
  filters: WorkspaceCleanupFilterState
  sort: WorkspaceCleanupSortState
  customPresets: WorkspaceCleanupCustomPreset[]
}

export function createDefaultWorkspaceCleanupBrowseState(): WorkspaceCleanupBrowseState {
  return {
    version: WORKSPACE_CLEANUP_BROWSE_STATE_VERSION,
    activePresetId: WORKSPACE_CLEANUP_DEFAULT_PRESET_ID,
    filters: createDefaultWorkspaceCleanupFilterState(),
    sort: { ...DEFAULT_WORKSPACE_CLEANUP_SORT },
    customPresets: []
  }
}

/**
 * Never throws: a corrupt or older-shape blob degrades to defaults field by
 * field so a bad persisted value cannot brick the dialog.
 */
export function normalizeWorkspaceCleanupBrowseState(value: unknown): WorkspaceCleanupBrowseState {
  if (value == null) {
    return createDefaultWorkspaceCleanupBrowseState()
  }
  const raw = asRecord(value)
  const activePresetId = raw.activePresetId
  return {
    version: WORKSPACE_CLEANUP_BROWSE_STATE_VERSION,
    activePresetId: typeof activePresetId === 'string' && activePresetId ? activePresetId : null,
    filters: normalizeWorkspaceCleanupFilterState(raw.filters),
    sort: normalizeWorkspaceCleanupSortState(raw.sort),
    customPresets: normalizeCustomPresets(raw.customPresets)
  }
}

export function normalizeWorkspaceCleanupCustomPreset(
  value: unknown
): WorkspaceCleanupCustomPreset | null {
  const raw = asRecord(value)
  const id = asString(raw.id, '')
  if (!id) {
    return null
  }
  const createdAt = raw.createdAt
  return {
    id,
    label: asString(raw.label, id),
    filters: normalizeWorkspaceCleanupFilterState(raw.filters),
    sort: normalizeWorkspaceCleanupSortState(raw.sort),
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0
  }
}

function normalizeCustomPresets(value: unknown): WorkspaceCleanupCustomPreset[] {
  if (!Array.isArray(value)) {
    return []
  }
  const byId = new Map<string, WorkspaceCleanupCustomPreset>()
  for (const entry of value) {
    const preset = normalizeWorkspaceCleanupCustomPreset(entry)
    if (preset && !byId.has(preset.id)) {
      byId.set(preset.id, preset)
    }
    if (byId.size >= WORKSPACE_CLEANUP_MAX_CUSTOM_PRESETS) {
      break
    }
  }
  return [...byId.values()]
}
