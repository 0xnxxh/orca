import { describe, expect, it } from 'vitest'
import {
  createDefaultWorkspaceCleanupBrowseState,
  normalizeWorkspaceCleanupBrowseState,
  WORKSPACE_CLEANUP_BROWSE_STATE_VERSION,
  WORKSPACE_CLEANUP_MAX_CUSTOM_PRESETS
} from './workspace-cleanup-browse-state'
import { createDefaultWorkspaceCleanupFilterState } from './workspace-cleanup-filter-model'

/** orca-data.json is JSON, so anything that cannot survive this is not persistable. */
function throughDisk<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value))
}

describe('workspace cleanup browse state persistence', () => {
  it('round-trips the default state unchanged', () => {
    const state = createDefaultWorkspaceCleanupBrowseState()
    expect(normalizeWorkspaceCleanupBrowseState(throughDisk(state))).toEqual(state)
  })

  it('round-trips an edited state including custom presets', () => {
    const state = createDefaultWorkspaceCleanupBrowseState()
    state.activePresetId = null
    state.filters.query = 'checkout'
    state.filters.activity = { idleSignal: 'created', idleMinDays: 45, neverVisited: true }
    state.filters.safety.tiers = ['review', 'protected']
    state.filters.review = { presence: 'some', states: ['merged'], providers: ['gitlab'] }
    state.sort = { field: 'size', direction: 'desc' }
    state.customPresets = [
      {
        id: 'mine',
        label: 'Mine',
        filters: createDefaultWorkspaceCleanupFilterState(),
        sort: { field: 'name', direction: 'asc' },
        createdAt: 1700000000000
      }
    ]

    expect(normalizeWorkspaceCleanupBrowseState(throughDisk(state))).toEqual(state)
  })

  it('degrades a newer build’s state field by field instead of discarding it', () => {
    const persisted = {
      version: 99,
      activePresetId: 'suggested',
      unknownTopLevelField: { anything: true },
      filters: {
        query: 'keep me',
        activity: { idleSignal: 'from-the-future', idleMinDays: 30, unknownFacet: 'ignored' },
        safety: { tiers: ['ready', 'not-a-tier'] },
        unknownGroup: { enabled: true }
      },
      sort: { field: 'unknown-column', direction: 'desc' },
      customPresets: []
    }

    const normalized = normalizeWorkspaceCleanupBrowseState(persisted)

    expect(normalized.version).toBe(WORKSPACE_CLEANUP_BROWSE_STATE_VERSION)
    expect(normalized.activePresetId).toBe('suggested')
    expect(normalized.filters.query).toBe('keep me')
    expect(normalized.filters.activity.idleMinDays).toBe(30)
    expect(normalized.filters.activity.idleSignal).toBe('last-visited')
    expect(normalized.filters.safety.tiers).toEqual(['ready'])
    expect(normalized.sort).toEqual({ field: 'last-activity', direction: 'desc' })
    expect(normalized).not.toHaveProperty('unknownTopLevelField')
  })

  it.each([null, undefined])(
    'restores the default preset when nothing is persisted (%p)',
    (value) => {
      expect(normalizeWorkspaceCleanupBrowseState(value)).toEqual(
        createDefaultWorkspaceCleanupBrowseState()
      )
    }
  )

  // A present-but-corrupt blob is NOT "nothing persisted": activePresetId stays
  // null so the dialog shows unfiltered raw state rather than silently re-applying
  // a preset the user had edited away from.
  it.each(['corrupt', 42, [], { filters: 'nonsense' }])(
    'never throws on a corrupt blob (%p)',
    (value) => {
      expect(normalizeWorkspaceCleanupBrowseState(value)).toEqual({
        ...createDefaultWorkspaceCleanupBrowseState(),
        activePresetId: null
      })
    }
  )

  it('drops duplicate and id-less custom presets and bounds the list', () => {
    const persisted = {
      customPresets: [
        { id: 'a', label: 'A' },
        { id: 'a', label: 'A again' },
        { label: 'no id' },
        ...Array.from({ length: WORKSPACE_CLEANUP_MAX_CUSTOM_PRESETS + 10 }, (_, i) => ({
          id: `gen-${i}`
        }))
      ]
    }

    const { customPresets } = normalizeWorkspaceCleanupBrowseState(persisted)

    expect(customPresets.length).toBeLessThanOrEqual(WORKSPACE_CLEANUP_MAX_CUSTOM_PRESETS)
    expect(customPresets.filter((preset) => preset.id === 'a')).toHaveLength(1)
    expect(customPresets[0]).toMatchObject({ id: 'a', label: 'A' })
  })
})
