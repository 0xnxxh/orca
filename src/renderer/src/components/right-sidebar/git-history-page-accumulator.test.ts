import { describe, expect, it } from 'vitest'
import type { GitHistoryItem, GitHistoryResult } from '../../../../shared/git-history'
import { appendGitHistoryPage, gitHistoryCursor } from './git-history-page-accumulator'

function item(id: string): GitHistoryItem {
  return { id, parentIds: [], subject: `commit ${id}`, message: `commit ${id}`, author: 'Ada' }
}

function page(ids: string[], overrides: Partial<GitHistoryResult> = {}): GitHistoryResult {
  return {
    items: ids.map(item),
    hasIncomingChanges: false,
    hasOutgoingChanges: false,
    hasMore: true,
    limit: 50,
    ...overrides
  }
}

describe('gitHistoryCursor', () => {
  it('is the oldest commit on screen', () => {
    expect(gitHistoryCursor(page(['a', 'b', 'c']))).toBe('c')
  })

  it('is undefined before anything loads', () => {
    expect(gitHistoryCursor(undefined)).toBeUndefined()
    expect(gitHistoryCursor(page([]))).toBeUndefined()
  })
})

describe('appendGitHistoryPage', () => {
  it('keeps the first page as-is', () => {
    expect(appendGitHistoryPage(undefined, page(['a', 'b'])).items.map((i) => i.id)).toEqual([
      'a',
      'b'
    ])
  })

  it('appends the next page after the commits already on screen', () => {
    const merged = appendGitHistoryPage(page(['a', 'b']), page(['c', 'd']))
    expect(merged.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  // Why: a cursor-anchored walk can re-emit a commit across a page boundary when topo-order
  // interleaves parallel branches differently. Duplicate React keys and a doubled graph row are
  // the visible failure.
  it('drops a commit the new page repeats', () => {
    const merged = appendGitHistoryPage(page(['a', 'b', 'c']), page(['c', 'd']))
    expect(merged.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('takes hasMore and branch metadata from the newest page', () => {
    const merged = appendGitHistoryPage(
      page(['a'], { hasMore: true, mergeBase: 'old' }),
      page(['b'], { hasMore: false, mergeBase: 'new' })
    )
    expect(merged.hasMore).toBe(false)
    expect(merged.mergeBase).toBe('new')
  })

  it('never loses commits already on screen when the new page is empty', () => {
    const merged = appendGitHistoryPage(page(['a', 'b']), page([], { hasMore: false }))
    expect(merged.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(merged.hasMore).toBe(false)
  })
})
