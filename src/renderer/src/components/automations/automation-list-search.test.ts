import { describe, expect, it } from 'vitest'
import {
  AUTOMATION_LIST_SEARCH_PROMPT_MAX_CODE_UNITS,
  AUTOMATION_LIST_SEARCH_QUERY_MAX_BYTES,
  AUTOMATION_LIST_SEARCH_UNKNOWN_PROJECT,
  automationListSearchFieldsMatch,
  automationListSearchIndexMatches,
  buildAutomationListSearchFingerprint,
  buildAutomationListSearchIndex,
  buildAutomationProjectSearchText,
  clampAutomationListSearchQueryInput,
  filterByActiveAutomationListSearchQuery,
  filterByAutomationListSearch,
  filterByAutomationListSearchIndex,
  getActiveAutomationListSearchQuery,
  getAutomationListSearchQuery,
  isAutomationListSearchQueryTooLarge,
  normalizeAutomationListSearchField,
  resolveAutomationListSearchQuery,
  truncateAutomationListSearchField
} from './automation-list-search'

describe('automation-list-search', () => {
  it('normalizes query casing and whitespace', () => {
    expect(getAutomationListSearchQuery('  Auto PR  ')).toBe('auto pr')
    expect(getActiveAutomationListSearchQuery('  Auto PR  ')).toBe('auto pr')
    expect(resolveAutomationListSearchQuery('  Auto PR  ')).toEqual({
      status: 'active',
      query: 'auto pr'
    })
  })

  it('rejects oversized queries without searching', () => {
    const oversized = 'a'.repeat(AUTOMATION_LIST_SEARCH_QUERY_MAX_BYTES + 1)
    expect(isAutomationListSearchQueryTooLarge(oversized)).toBe(true)
    expect(getAutomationListSearchQuery(oversized)).toBeNull()
    expect(getActiveAutomationListSearchQuery(oversized)).toBeNull()
    expect(resolveAutomationListSearchQuery(oversized)).toEqual({ status: 'too_large' })
    expect(
      automationListSearchFieldsMatch(
        { name: 'Auto PR', project: 'orca', prompt: 'nudge' },
        oversized
      )
    ).toBe(false)

    const items = [
      { id: '1', name: 'Auto PR', project: 'orca', prompt: 'nudge' },
      { id: '2', name: 'Nightly', project: 'mobile', prompt: 'ship' }
    ]
    // Why: oversized paste must leave the list unfiltered, not blank it.
    expect(filterByAutomationListSearch(items, oversized, (item) => item)).toBe(items)
  })

  it('treats whitespace-only queries as inactive (no search work)', () => {
    expect(getActiveAutomationListSearchQuery('   \t  ')).toBeNull()
    expect(resolveAutomationListSearchQuery('   ')).toEqual({ status: 'inactive' })
    const items = [{ name: 'A', project: 'p1', prompt: 'one' }]
    expect(filterByAutomationListSearch(items, '  ', (item) => item)).toBe(items)
  })

  it('clamps stored query input so multi-MB pastes are discarded', () => {
    const hugePaste = 'a'.repeat(AUTOMATION_LIST_SEARCH_QUERY_MAX_BYTES * 100)
    const clamped = clampAutomationListSearchQueryInput(hugePaste)
    expect(clamped.length).toBe(AUTOMATION_LIST_SEARCH_QUERY_MAX_BYTES + 1)
    expect(isAutomationListSearchQueryTooLarge(clamped)).toBe(true)
    expect(clampAutomationListSearchQueryInput('auto pr')).toBe('auto pr')
  })

  it('caps indexed field length so huge prompts stay bounded', () => {
    const prompt = `${'x'.repeat(AUTOMATION_LIST_SEARCH_PROMPT_MAX_CODE_UNITS)}unique-tail-token`
    const index = buildAutomationListSearchIndex({
      name: 'Nightly',
      project: 'mobile',
      prompt
    })
    expect(index.prompt.length).toBe(AUTOMATION_LIST_SEARCH_PROMPT_MAX_CODE_UNITS)
    expect(automationListSearchIndexMatches(index, 'unique-tail-token')).toBe(false)
    expect(automationListSearchIndexMatches(index, 'xxxx')).toBe(true)
  })

  it('null-safely normalizes missing fields', () => {
    expect(normalizeAutomationListSearchField(null, 10)).toBe('')
    expect(normalizeAutomationListSearchField(undefined, 10)).toBe('')
    expect(
      buildAutomationListSearchIndex({
        name: 'Job',
        project: 'host',
        prompt: null as unknown as string
      }).prompt
    ).toBe('')
  })

  it('does not split surrogate pairs when truncating', () => {
    const emoji = '😀'
    const value = `${'a'.repeat(7)}${emoji}`
    expect(truncateAutomationListSearchField(value, 8)).toBe('a'.repeat(7))
    expect(truncateAutomationListSearchField(value, 9)).toBe(value)
  })

  it('indexes unknown project fallback for missing repos', () => {
    expect(buildAutomationProjectSearchText({})).toBe(AUTOMATION_LIST_SEARCH_UNKNOWN_PROJECT)
    expect(buildAutomationProjectSearchText({ displayName: '  ', path: null })).toBe(
      AUTOMATION_LIST_SEARCH_UNKNOWN_PROJECT
    )
    expect(buildAutomationProjectSearchText({ displayName: 'orca', path: '/tmp/orca' })).toBe(
      'orca /tmp/orca'
    )
    const index = buildAutomationListSearchIndex({
      name: 'Orphan',
      project: buildAutomationProjectSearchText({}),
      prompt: 'hi'
    })
    expect(automationListSearchIndexMatches(index, 'unknown')).toBe(true)
  })

  it('matches name, project, or prompt', () => {
    const fields = {
      name: 'Auto PR assignment',
      project: 'orca / main',
      prompt: 'Assign reviewers for open PRs'
    }
    expect(automationListSearchFieldsMatch(fields, 'assignment')).toBe(true)
    expect(automationListSearchFieldsMatch(fields, 'ORCA')).toBe(true)
    expect(automationListSearchFieldsMatch(fields, 'reviewers')).toBe(true)
    expect(automationListSearchFieldsMatch(fields, 'missing')).toBe(false)
  })

  it('filters by active query without re-resolving bounds', () => {
    const items = [
      { id: '1', name: 'Auto Issue assignment', project: 'orca', prompt: 'triage issues' },
      { id: '2', name: 'Nightly deploy', project: 'mobile', prompt: 'ship apk' },
      { id: '3', name: 'PR nudge', project: 'orca', prompt: 'remind reviewers' }
    ]
    const indexes = items.map((item) =>
      buildAutomationListSearchIndex({
        name: item.name,
        project: item.project,
        prompt: item.prompt
      })
    )
    expect(
      filterByActiveAutomationListSearchQuery(items, indexes, 'apk').map((item) => item.id)
    ).toEqual(['2'])
    expect(
      filterByAutomationListSearchIndex(items, indexes, 'orca').map((item) => item.id)
    ).toEqual(['1', '3'])
    expect(filterByAutomationListSearchIndex(items, indexes, '   ')).toBe(items)
    expect(
      filterByAutomationListSearchIndex(
        items,
        indexes,
        'a'.repeat(AUTOMATION_LIST_SEARCH_QUERY_MAX_BYTES + 1)
      )
    ).toBe(items)
  })

  it('builds a stable fingerprint from search sources only', () => {
    const sources = [
      { name: 'A', project: 'p1', prompt: 'one' },
      { name: 'B', project: 'p2', prompt: 'two' }
    ]
    expect(buildAutomationListSearchFingerprint(sources)).toBe(
      buildAutomationListSearchFingerprint([
        { name: 'A', project: 'p1', prompt: 'one' },
        { name: 'B', project: 'p2', prompt: 'two' }
      ])
    )
    expect(buildAutomationListSearchFingerprint(sources)).not.toBe(
      buildAutomationListSearchFingerprint([
        { name: 'A', project: 'p1', prompt: 'changed' },
        { name: 'B', project: 'p2', prompt: 'two' }
      ])
    )
  })
})
