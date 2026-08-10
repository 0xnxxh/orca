import { describe, expect, it } from 'vitest'
import {
  createDefaultWorkspaceCleanupBrowseState,
  normalizeWorkspaceCleanupBrowseState,
  WORKSPACE_CLEANUP_BROWSE_STATE_VERSION
} from '../../../../shared/workspace-cleanup-browse-state'
import { DAY, FACET_NOW, makeNamedFacets } from './workspace-cleanup-facet.test.fixture'
import { createDefaultWorkspaceCleanupFilterState } from '../../../../shared/workspace-cleanup-filter-model'
import {
  applyWorkspaceCleanupPreset,
  createWorkspaceCleanupCustomPreset,
  findWorkspaceCleanupPreset,
  isWorkspaceCleanupFilterStateEqual,
  listWorkspaceCleanupPresets,
  matchWorkspaceCleanupPresetId
} from '../../../../shared/workspace-cleanup-preset-state'
import { WORKSPACE_CLEANUP_BUILT_IN_PRESETS } from '../../../../shared/workspace-cleanup-presets'
import { runWorkspaceCleanupQuery } from './workspace-cleanup-query'

function applyPreset(presetId: string, rows: ReturnType<typeof makeNamedFacets>[]): string[] {
  const preset = findWorkspaceCleanupPreset(presetId)
  expect(preset).not.toBeNull()
  return runWorkspaceCleanupQuery(rows, applyWorkspaceCleanupPreset(preset!), FACET_NOW).rows.map(
    (row) => row.displayName
  )
}

const CORPUS = [
  makeNamedFacets('ready'),
  makeNamedFacets('needsReview', {
    candidate: {
      tier: 'review',
      blockers: ['dirty-files'],
      git: { clean: false, upstreamAhead: 0, upstreamBehind: 0, checkedAt: 1 }
    }
  }),
  makeNamedFacets('locked', { candidate: { tier: 'protected', blockers: ['live-agent'] } }),
  makeNamedFacets('ignored', { dismissed: true }),
  makeNamedFacets('mergedClean', { review: { state: 'merged', provider: 'gitlab' } }),
  makeNamedFacets('visited', { lastVisitedAt: FACET_NOW - 5 * DAY }),
  makeNamedFacets('huge', { sizeBytes: 5_000, lastVisitedAt: FACET_NOW - 200 * DAY })
]

describe('built-in presets', () => {
  it('exposes unique ids and i18n keys', () => {
    const ids = WORKSPACE_CLEANUP_BUILT_IN_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([
      'suggested',
      'needs-review',
      'protected',
      'ignored',
      'merged-review-clean',
      'never-opened',
      'largest',
      'stale-visits',
      'all'
    ])
    for (const preset of WORKSPACE_CLEANUP_BUILT_IN_PRESETS) {
      expect(preset.source).toBe('built-in')
      expect(preset.labelKey).toBe(`components.workspace.cleanup.presets.${preset.id}.label`)
    }
  })

  it('suggested keeps only selectable ready rows', () => {
    // Equal lastActivityAt across the corpus, so the name tie-break decides order.
    expect(applyPreset('suggested', CORPUS)).toEqual(['huge', 'mergedClean', 'ready', 'visited'])
  })

  it('needs review and protected split the non-selectable rows', () => {
    expect(applyPreset('needs-review', CORPUS)).toEqual(['needsReview'])
    expect(applyPreset('protected', CORPUS)).toEqual(['locked'])
  })

  it('ignored shows only dismissed rows', () => {
    expect(applyPreset('ignored', CORPUS)).toEqual(['ignored'])
  })

  it('merged review & clean requires both a landed review and a clean tree', () => {
    expect(applyPreset('merged-review-clean', CORPUS)).toEqual(['mergedClean'])
  })

  it('never opened ignores background activity', () => {
    expect(applyPreset('never-opened', CORPUS)).not.toContain('visited')
    expect(applyPreset('never-opened', CORPUS)).toContain('ready')
  })

  it('largest drops unsized rows and sorts descending', () => {
    expect(applyPreset('largest', CORPUS)).toEqual(['huge'])
    const sized = [
      makeNamedFacets('small', { sizeBytes: 1 }),
      makeNamedFacets('big', { sizeBytes: 100 })
    ]
    expect(applyPreset('largest', sized)).toEqual(['big', 'small'])
  })

  it('stale visits uses the visit signal, not background activity', () => {
    expect(applyPreset('stale-visits', CORPUS)).toContain('huge')
    expect(applyPreset('stale-visits', CORPUS)).not.toContain('visited')
  })

  it('all includes dismissed rows', () => {
    expect(applyPreset('all', CORPUS)).toContain('ignored')
    expect(applyPreset('all', CORPUS)).toHaveLength(CORPUS.length)
  })
})

describe('preset application', () => {
  it('deep clones so editing applied state never mutates the preset', () => {
    const preset = findWorkspaceCleanupPreset('suggested')!
    const applied = applyWorkspaceCleanupPreset(preset)
    applied.filters.safety.tiers.push('protected')
    applied.sort.direction = 'desc'
    expect(preset.filters.safety.tiers).toEqual(['ready'])
    expect(preset.sort.direction).toBe('asc')
  })

  it('round-trips through preset matching', () => {
    for (const preset of WORKSPACE_CLEANUP_BUILT_IN_PRESETS) {
      expect(matchWorkspaceCleanupPresetId(applyWorkspaceCleanupPreset(preset))).toBe(preset.id)
    }
  })

  it('reports no preset once the user edits away from one', () => {
    const applied = applyWorkspaceCleanupPreset(findWorkspaceCleanupPreset('suggested')!)
    applied.filters.git.branchQuery = 'feature'
    expect(matchWorkspaceCleanupPresetId(applied)).toBeNull()
  })

  it('compares multi-selects as sets, not ordered lists', () => {
    const left = createDefaultWorkspaceCleanupFilterState()
    const right = createDefaultWorkspaceCleanupFilterState()
    left.safety.blockers = ['pinned', 'live-agent']
    right.safety.blockers = ['live-agent', 'pinned']
    expect(isWorkspaceCleanupFilterStateEqual(left, right)).toBe(true)
    right.safety.blockers = ['pinned']
    expect(isWorkspaceCleanupFilterStateEqual(left, right)).toBe(false)
  })
})

describe('custom presets', () => {
  it('appends customs after built-ins and lets a custom id shadow a built-in', () => {
    const custom = createWorkspaceCleanupCustomPreset({
      id: 'mine',
      label: 'Mine',
      state: applyWorkspaceCleanupPreset(findWorkspaceCleanupPreset('all')!),
      createdAt: FACET_NOW
    })
    const listed = listWorkspaceCleanupPresets([custom])
    expect(listed.at(-1)?.id).toBe('mine')
    expect(listed.at(-1)?.source).toBe('custom')

    const shadow = { ...custom, id: 'suggested', label: 'My suggested' }
    const shadowed = listWorkspaceCleanupPresets([shadow])
    expect(shadowed.filter((preset) => preset.id === 'suggested')).toHaveLength(1)
    expect(findWorkspaceCleanupPreset('suggested', [shadow])?.label).toBe('My suggested')
  })
})

describe('persisted browse state', () => {
  it('defaults to the suggested preset', () => {
    const state = createDefaultWorkspaceCleanupBrowseState()
    expect(state.version).toBe(WORKSPACE_CLEANUP_BROWSE_STATE_VERSION)
    expect(state.activePresetId).toBe('suggested')
    expect(state.customPresets).toEqual([])
  })

  it('degrades unknown, missing, and corrupt values instead of throwing', () => {
    expect(normalizeWorkspaceCleanupBrowseState(null)).toEqual(
      createDefaultWorkspaceCleanupBrowseState()
    )
    const normalized = normalizeWorkspaceCleanupBrowseState({
      activePresetId: 42,
      sort: { field: 'from-the-future', direction: 'sideways' },
      filters: {
        query: 7,
        activity: { idleSignal: 'nope', idleMinDays: -5 },
        safety: { blockers: ['live-agent', 'live-agent', 'not-a-blocker'], dismissed: 'maybe' },
        unknownGroup: { anything: true }
      },
      customPresets: 'nope'
    })
    expect(normalized.activePresetId).toBeNull()
    expect(normalized.sort).toEqual({ field: 'last-activity', direction: 'asc' })
    expect(normalized.filters.query).toBe('')
    expect(normalized.filters.activity.idleSignal).toBe('last-visited')
    expect(normalized.filters.activity.idleMinDays).toBe(0)
    expect(normalized.filters.safety.blockers).toEqual(['live-agent'])
    expect(normalized.filters.safety.dismissed).toBe('exclude')
    expect(normalized.customPresets).toEqual([])
    expect(normalized).not.toHaveProperty('unknownGroup')
  })

  it('round-trips a saved state through JSON', () => {
    const state = createDefaultWorkspaceCleanupBrowseState()
    state.filters.activity.idleMinDays = 45
    state.filters.status.workspaceStatuses = ['in-review']
    state.customPresets = [
      createWorkspaceCleanupCustomPreset({
        id: 'mine',
        label: 'Mine',
        state: { filters: state.filters, sort: state.sort },
        createdAt: FACET_NOW
      })
    ]
    expect(normalizeWorkspaceCleanupBrowseState(JSON.parse(JSON.stringify(state)))).toEqual(state)
  })

  it('drops duplicate custom preset ids and entries without an id', () => {
    const normalized = normalizeWorkspaceCleanupBrowseState({
      customPresets: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }, { label: 'no id' }]
    })
    expect(normalized.customPresets.map((preset) => preset.label)).toEqual(['A'])
  })
})
