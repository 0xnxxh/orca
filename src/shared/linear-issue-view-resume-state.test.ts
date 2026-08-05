import { describe, expect, it } from 'vitest'
import {
  emptyLinearIssueAttributeFilter,
  type LinearIssueAttributeFilter
} from './linear-issue-attribute-filter'
import {
  defaultLinearIssueViewResumeState,
  LINEAR_DISPLAY_PROPERTIES,
  LINEAR_ISSUE_VIEW_MAX_PERSISTED_WORKSPACES,
  normalizeLinearIssueViewResumeState,
  orderLinearDisplayProperties,
  resolveLinearIssueViewResumeState,
  selectLinearWorkspaceIssueFilter,
  serializeLinearIssueViewResumeState,
  setLinearWorkspaceIssueFilter,
  type LinearIssueViewResumeState
} from './linear-issue-view-resume-state'

function filter(overrides: Partial<LinearIssueAttributeFilter> = {}): LinearIssueAttributeFilter {
  return { ...emptyLinearIssueAttributeFilter(), ...overrides }
}

const FILTER_A = filter({ stateIds: ['state-a'], priorities: [1] })
const FILTER_B = filter({ labelIds: ['label-b'], assignee: { kind: 'user', id: 'user-b' } })

describe('resolveLinearIssueViewResumeState', () => {
  it('falls back to list/none/priority with every display property when nothing is persisted', () => {
    expect(resolveLinearIssueViewResumeState(undefined)).toEqual({
      viewMode: 'list',
      groupBy: 'none',
      orderBy: 'priority',
      displayProperties: [...LINEAR_DISPLAY_PROPERTIES],
      teamPropertyTouched: false,
      filtersByWorkspaceId: {}
    })
  })

  it('restores a complete persisted view', () => {
    const persisted: LinearIssueViewResumeState = {
      viewMode: 'board',
      groupBy: 'assignee',
      orderBy: 'updated',
      displayProperties: ['state', 'labels'],
      teamPropertyTouched: true,
      filtersByWorkspaceId: { 'workspace-a': FILTER_A, 'workspace-b': FILTER_B }
    }

    expect(resolveLinearIssueViewResumeState(persisted)).toEqual(persisted)
  })

  it('keeps an empty display-property list, which means every property is hidden', () => {
    expect(resolveLinearIssueViewResumeState({ displayProperties: [] }).displayProperties).toEqual(
      []
    )
  })

  it('drops unknown display properties and restores catalog order', () => {
    const resolved = resolveLinearIssueViewResumeState({
      displayProperties: ['updated', 'bogus', 'state']
    })

    expect(resolved.displayProperties).toEqual(['state', 'updated'])
  })
})

describe('normalizeLinearIssueViewResumeState', () => {
  it('drops a malformed preference blob entirely', () => {
    expect(normalizeLinearIssueViewResumeState('board')).toBeUndefined()
    expect(normalizeLinearIssueViewResumeState(null)).toBeUndefined()
    expect(normalizeLinearIssueViewResumeState(['board'])).toBeUndefined()
    expect(normalizeLinearIssueViewResumeState({ viewMode: 'grid', groupBy: 42 })).toBeUndefined()
  })

  it('keeps the valid fields when only some of them are corrupt', () => {
    const normalized = normalizeLinearIssueViewResumeState({
      viewMode: 'board',
      groupBy: 'nonsense',
      orderBy: 'updated',
      teamPropertyTouched: 'yes'
    })

    expect(normalized).toEqual({
      viewMode: 'board',
      groupBy: 'none',
      orderBy: 'updated',
      displayProperties: [...LINEAR_DISPLAY_PROPERTIES],
      teamPropertyTouched: false,
      filtersByWorkspaceId: {}
    })
  })

  it('drops only the corrupt workspace filter and keeps the healthy ones', () => {
    const normalized = normalizeLinearIssueViewResumeState({
      viewMode: 'board',
      filtersByWorkspaceId: {
        'workspace-a': FILTER_A,
        'workspace-broken': { stateIds: 'not-an-array' },
        'workspace-partial': { stateIds: ['state-x'] },
        '': FILTER_B
      }
    })

    expect(normalized?.viewMode).toBe('board')
    expect(normalized?.filtersByWorkspaceId).toEqual({ 'workspace-a': FILTER_A })
  })

  it('drops empty persisted filters and a __proto__ workspace key', () => {
    // JSON.parse (unlike an object literal) makes __proto__ an own key, which is how it would arrive from disk.
    const normalized = normalizeLinearIssueViewResumeState({
      viewMode: 'board',
      filtersByWorkspaceId: JSON.parse(
        `{"workspace-empty": ${JSON.stringify(emptyLinearIssueAttributeFilter())},
          "__proto__": ${JSON.stringify(FILTER_A)}}`
      )
    })

    expect(normalized?.filtersByWorkspaceId).toEqual({})
    expect(({} as Record<string, unknown>).stateIds).toBeUndefined()
  })

  it('caps the persisted workspace filters', () => {
    const filtersByWorkspaceId: Record<string, LinearIssueAttributeFilter> = {}
    for (let index = 0; index < LINEAR_ISSUE_VIEW_MAX_PERSISTED_WORKSPACES + 3; index += 1) {
      filtersByWorkspaceId[`workspace-${index}`] = filter({ stateIds: [`state-${index}`] })
    }

    const normalized = normalizeLinearIssueViewResumeState({ filtersByWorkspaceId })

    const keys = Object.keys(normalized?.filtersByWorkspaceId ?? {})
    expect(keys).toHaveLength(LINEAR_ISSUE_VIEW_MAX_PERSISTED_WORKSPACES)
    // Why: writes append, so the most recently filtered workspaces are the survivors.
    expect(keys.at(-1)).toBe(`workspace-${LINEAR_ISSUE_VIEW_MAX_PERSISTED_WORKSPACES + 2}`)
  })
})

describe('serializeLinearIssueViewResumeState', () => {
  it('round-trips a restored view unchanged', () => {
    const restored = resolveLinearIssueViewResumeState({
      viewMode: 'board',
      groupBy: 'team',
      orderBy: 'identifier',
      displayProperties: ['labels', 'state'],
      teamPropertyTouched: true,
      filtersByWorkspaceId: { 'workspace-a': FILTER_A }
    })

    expect(serializeLinearIssueViewResumeState(restored)).toEqual(restored)
  })

  it('emits display properties in catalog order regardless of toggle order', () => {
    const serialized = serializeLinearIssueViewResumeState({
      ...defaultLinearIssueViewResumeState(),
      displayProperties: new Set(['updated', 'state'] as const)
    })

    expect(serialized.displayProperties).toEqual(['state', 'updated'])
    expect(orderLinearDisplayProperties(['labels', 'priority'])).toEqual(['priority', 'labels'])
  })

  it('omits empty filters and canonicalizes the rest', () => {
    const serialized = serializeLinearIssueViewResumeState({
      ...defaultLinearIssueViewResumeState(),
      filtersByWorkspaceId: {
        'workspace-empty': emptyLinearIssueAttributeFilter(),
        'workspace-a': filter({ labelIds: ['b', 'a', 'a'] })
      }
    })

    expect(serialized.filtersByWorkspaceId).toEqual({
      'workspace-a': filter({ labelIds: ['a', 'b'] })
    })
  })
})

describe('selectLinearWorkspaceIssueFilter', () => {
  const filters = { 'workspace-a': FILTER_A, 'workspace-b': FILTER_B }

  it('retrieves only the selected workspace filter', () => {
    expect(selectLinearWorkspaceIssueFilter(filters, 'workspace-a')).toEqual(FILTER_A)
    expect(selectLinearWorkspaceIssueFilter(filters, 'workspace-b')).toEqual(FILTER_B)
  })

  it('is unfiltered for a workspace with nothing saved', () => {
    expect(selectLinearWorkspaceIssueFilter(filters, 'workspace-c')).toEqual(
      emptyLinearIssueAttributeFilter()
    )
  })

  it('never applies another workspace filter while Linear is unresolved or disconnected', () => {
    expect(selectLinearWorkspaceIssueFilter(filters, null)).toEqual(
      emptyLinearIssueAttributeFilter()
    )
    // Why: an unresolved workspace must read as unfiltered without erasing anything.
    expect(filters).toEqual({ 'workspace-a': FILTER_A, 'workspace-b': FILTER_B })
  })

  it('ignores inherited object keys', () => {
    expect(selectLinearWorkspaceIssueFilter(filters, 'toString')).toEqual(
      emptyLinearIssueAttributeFilter()
    )
  })
})

describe('setLinearWorkspaceIssueFilter', () => {
  it('keeps workspace filters independent across A -> B -> A', () => {
    let filters: Record<string, LinearIssueAttributeFilter> = {}
    filters = setLinearWorkspaceIssueFilter(filters, 'workspace-a', FILTER_A)
    expect(selectLinearWorkspaceIssueFilter(filters, 'workspace-a')).toEqual(FILTER_A)

    // Switching to B shows B's (empty) filter without touching A's.
    expect(selectLinearWorkspaceIssueFilter(filters, 'workspace-b')).toEqual(
      emptyLinearIssueAttributeFilter()
    )
    filters = setLinearWorkspaceIssueFilter(filters, 'workspace-b', FILTER_B)

    expect(selectLinearWorkspaceIssueFilter(filters, 'workspace-a')).toEqual(FILTER_A)
    expect(selectLinearWorkspaceIssueFilter(filters, 'workspace-b')).toEqual(FILTER_B)
  })

  it('returns the same record when the canonical filter is unchanged', () => {
    const filters = setLinearWorkspaceIssueFilter({}, 'workspace-a', FILTER_A)

    expect(setLinearWorkspaceIssueFilter(filters, 'workspace-a', { ...FILTER_A })).toBe(filters)
  })

  it('removes the entry when the filter is cleared and leaves other workspaces alone', () => {
    let filters = setLinearWorkspaceIssueFilter({}, 'workspace-a', FILTER_A)
    filters = setLinearWorkspaceIssueFilter(filters, 'workspace-b', FILTER_B)

    filters = setLinearWorkspaceIssueFilter(
      filters,
      'workspace-a',
      emptyLinearIssueAttributeFilter()
    )

    expect(filters).toEqual({ 'workspace-b': FILTER_B })
  })

  it('refuses an unusable workspace key', () => {
    const filters = { 'workspace-a': FILTER_A }

    expect(setLinearWorkspaceIssueFilter(filters, '__proto__', FILTER_B)).toBe(filters)
    expect(setLinearWorkspaceIssueFilter(filters, '', FILTER_B)).toBe(filters)
  })
})

describe('startup sequences', () => {
  const persisted = {
    viewMode: 'board',
    groupBy: 'status',
    orderBy: 'updated',
    displayProperties: ['state'],
    teamPropertyTouched: true,
    filtersByWorkspaceId: { 'workspace-a': FILTER_A, 'workspace-b': FILTER_B }
  }

  it('cold start with the workspace already resolved shows that workspace filter', () => {
    const restored = resolveLinearIssueViewResumeState(persisted)

    expect(selectLinearWorkspaceIssueFilter(restored.filtersByWorkspaceId, 'workspace-b')).toEqual(
      FILTER_B
    )
    expect(restored.viewMode).toBe('board')
  })

  it('cold start with the workspace resolving after hydration keeps the restored filter', () => {
    const restored = resolveLinearIssueViewResumeState(persisted)

    // Hydration lands first with Linear still unresolved...
    expect(selectLinearWorkspaceIssueFilter(restored.filtersByWorkspaceId, null)).toEqual(
      emptyLinearIssueAttributeFilter()
    )
    // ...and the workspace resolving later needs no reset effect to surface the filter.
    expect(selectLinearWorkspaceIssueFilter(restored.filtersByWorkspaceId, 'workspace-a')).toEqual(
      FILTER_A
    )
    expect(serializeLinearIssueViewResumeState(restored)).toEqual(restored)
  })

  it('persists the full map when a workspace switch happens during startup', () => {
    const restored = resolveLinearIssueViewResumeState(persisted)
    // Linear resolves workspace-b mid-startup and the user edits its filter there.
    const edited = setLinearWorkspaceIssueFilter(
      restored.filtersByWorkspaceId,
      'workspace-b',
      filter({ priorities: [0] })
    )

    expect(
      serializeLinearIssueViewResumeState({ ...restored, filtersByWorkspaceId: edited })
    ).toEqual({
      ...persisted,
      filtersByWorkspaceId: {
        'workspace-a': FILTER_A,
        'workspace-b': filter({ priorities: [0] })
      }
    })
  })
})
