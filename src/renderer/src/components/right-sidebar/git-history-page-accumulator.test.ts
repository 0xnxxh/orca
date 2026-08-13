import { describe, expect, it } from 'vitest'
import type { GitHistoryItem, GitHistoryResult } from '../../../../shared/git-history'
import { appendGitHistoryPage } from './git-history-page-accumulator'

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

  // Why: HEAD can move under the walk between pages and shift the offset, re-emitting a commit.
  // Duplicate React keys and a doubled graph row are the visible failure.
  it('drops a commit the new page repeats', () => {
    const merged = appendGitHistoryPage(page(['a', 'b', 'c']), page(['c', 'd']))
    expect(merged.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('takes hasMore, the next cursor, and branch metadata from the newest page', () => {
    const merged = appendGitHistoryPage(
      page(['a'], { hasMore: true, mergeBase: 'old', nextCursor: { anchor: 'x', loaded: 1 } }),
      page(['b'], { hasMore: true, mergeBase: 'new', nextCursor: { anchor: 'x', loaded: 2 } })
    )
    expect(merged.hasMore).toBe(true)
    expect(merged.nextCursor).toEqual({ anchor: 'x', loaded: 2 })
    expect(merged.mergeBase).toBe('new')
  })

  // Why: a host that ignores the cursor answers every page with page one. Without this the button
  // stays lit and every click re-fetches the same commits, which reads as a hang.
  it('stops paging when a page adds nothing new', () => {
    const merged = appendGitHistoryPage(
      page(['a', 'b']),
      page(['a', 'b'], { hasMore: true, nextCursor: { anchor: 'x', loaded: 2 } })
    )
    expect(merged.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(merged.hasMore).toBe(false)
    expect(merged.nextCursor).toBeUndefined()
  })

  it('never loses commits already on screen when the new page is empty', () => {
    const merged = appendGitHistoryPage(page(['a', 'b']), page([], { hasMore: false }))
    expect(merged.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(merged.hasMore).toBe(false)
  })
})
