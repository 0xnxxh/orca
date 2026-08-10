import {
  createDefaultWorkspaceCleanupFilterState,
  DEFAULT_WORKSPACE_CLEANUP_SORT,
  type WorkspaceCleanupFilterState,
  type WorkspaceCleanupSortState
} from './workspace-cleanup-filter-model'

export type WorkspaceCleanupPresetSource = 'built-in' | 'custom'

export type WorkspaceCleanupPreset = {
  id: string
  source: WorkspaceCleanupPresetSource
  /** Built-in: English default for `translate`. Custom: the literal user text. */
  label: string
  labelKey: string | null
  description: string
  descriptionKey: string | null
  filters: WorkspaceCleanupFilterState
  sort: WorkspaceCleanupSortState
}

/** Persisted user preset — no i18n keys, so it round-trips through orca-data.json unchanged. */
export type WorkspaceCleanupCustomPreset = {
  id: string
  label: string
  filters: WorkspaceCleanupFilterState
  sort: WorkspaceCleanupSortState
  createdAt: number
}

type FilterPatch = {
  [K in keyof WorkspaceCleanupFilterState]?: WorkspaceCleanupFilterState[K] extends string
    ? string
    : Partial<WorkspaceCleanupFilterState[K]>
}

export const WORKSPACE_CLEANUP_DEFAULT_PRESET_ID = 'suggested'

export const WORKSPACE_CLEANUP_BUILT_IN_PRESETS: readonly WorkspaceCleanupPreset[] = [
  definePreset({
    id: 'suggested',
    label: 'Suggested',
    description: 'Idle, clean, and safe to delete right now.',
    patch: { safety: { tiers: ['ready'], selectableOnly: true, dismissed: 'exclude' } },
    sort: { field: 'last-activity', direction: 'asc' }
  }),
  definePreset({
    id: 'needs-review',
    label: 'Needs review',
    description: 'Old enough to remove, but something still needs a human look.',
    patch: { safety: { tiers: ['review'], dismissed: 'exclude' } },
    sort: { field: 'last-activity', direction: 'asc' }
  }),
  definePreset({
    id: 'protected',
    label: 'Protected',
    description: 'Held back by a blocker such as a live agent, pin, or unpushed work.',
    patch: { safety: { tiers: ['protected'], dismissed: 'exclude' } },
    sort: { field: 'blocker-count', direction: 'desc' }
  }),
  definePreset({
    id: 'ignored',
    label: 'Ignored',
    description: 'Workspaces you dismissed from cleanup.',
    patch: { safety: { dismissed: 'only' } },
    sort: { field: 'last-activity', direction: 'asc' }
  }),
  definePreset({
    id: 'merged-review-clean',
    label: 'Merged review & clean',
    description: 'The pull/merge request landed and the working tree is clean.',
    patch: {
      review: { presence: 'some', states: ['merged'] },
      git: { states: ['clean'] },
      safety: { dismissed: 'exclude' }
    },
    sort: { field: 'last-activity', direction: 'asc' }
  }),
  definePreset({
    id: 'never-opened',
    label: 'Never opened',
    description: 'Orca never recorded you opening these, whatever background activity says.',
    patch: { activity: { neverVisited: true }, safety: { dismissed: 'exclude' } },
    sort: { field: 'created', direction: 'asc' }
  }),
  definePreset({
    id: 'largest',
    label: 'Largest on disk',
    description: 'Biggest measured workspaces first. Needs a disk-space scan.',
    patch: { size: { includeUnsized: false }, safety: { dismissed: 'any' } },
    sort: { field: 'size', direction: 'desc' }
  }),
  definePreset({
    id: 'stale-visits',
    label: 'Not opened in 90 days',
    description: 'Threshold is editable — background activity does not reset it.',
    patch: {
      activity: { idleSignal: 'last-visited', idleMinDays: 90 },
      safety: { dismissed: 'exclude' }
    },
    sort: { field: 'last-visited', direction: 'asc' }
  }),
  definePreset({
    id: 'all',
    label: 'All workspaces',
    description: 'Every workspace Orca knows about, including dismissed ones.',
    patch: { safety: { dismissed: 'any' } },
    sort: DEFAULT_WORKSPACE_CLEANUP_SORT
  })
]

export function createWorkspaceCleanupPresetFilters(
  patch: FilterPatch
): WorkspaceCleanupFilterState {
  const base = createDefaultWorkspaceCleanupFilterState()
  return {
    query: patch.query ?? base.query,
    activity: { ...base.activity, ...patch.activity },
    size: { ...base.size, ...patch.size },
    status: { ...base.status, ...patch.status },
    agent: { ...base.agent, ...patch.agent },
    git: { ...base.git, ...patch.git },
    review: { ...base.review, ...patch.review },
    ticket: { ...base.ticket, ...patch.ticket },
    context: { ...base.context, ...patch.context },
    location: { ...base.location, ...patch.location },
    safety: { ...base.safety, ...patch.safety }
  }
}

export function toWorkspaceCleanupPreset(
  custom: WorkspaceCleanupCustomPreset
): WorkspaceCleanupPreset {
  return {
    id: custom.id,
    source: 'custom',
    label: custom.label,
    labelKey: null,
    description: '',
    descriptionKey: null,
    filters: custom.filters,
    sort: custom.sort
  }
}

function definePreset(args: {
  id: string
  label: string
  description: string
  patch: FilterPatch
  sort: WorkspaceCleanupSortState
}): WorkspaceCleanupPreset {
  return {
    id: args.id,
    source: 'built-in',
    label: args.label,
    labelKey: `components.workspace.cleanup.presets.${args.id}.label`,
    description: args.description,
    descriptionKey: `components.workspace.cleanup.presets.${args.id}.description`,
    filters: createWorkspaceCleanupPresetFilters(args.patch),
    sort: args.sort
  }
}
