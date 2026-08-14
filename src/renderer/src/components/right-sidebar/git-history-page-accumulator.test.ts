import { describe, expect, it } from 'vitest'
import type { GitHistoryItem, GitHistoryResult } from '../../../../shared/git-history'
import { foldGitHistoryPage } from './git-history-page-accumulator'

function item(id: string): GitHistoryItem {
  return { id, parentIds: [], subject: `commit ${id}`, message: `commit ${id}`, author: 'Ada' }
}

const ANCHOR = 'a'.repeat(40)
// The cursor a Load more click sends, and the anchor a page continuing that walk comes back with.
const REQUESTED = { anchor: ANCHOR, loaded: 2 }

function page(ids: string[], overrides: Partial<GitHistoryResult> = {}): GitHistoryResult {
  return {
    items: ids.map(item),
    pageAnchor: ANCHOR,
    hasIncomingChanges: false,
    hasOutgoingChanges: false,
    hasMore: true,
    limit: 50,
    ...overrides
  }
}

describe('foldGitHistoryPage', () => {
  it('keeps the first page as-is', () => {
    const folded = foldGitHistoryPage(undefined, page(['a', 'b']), undefined)
    expect(folded.items.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('appends the next page after the commits already on screen', () => {
    const merged = foldGitHistoryPage(page(['a', 'b']), page(['c', 'd']), REQUESTED)
    expect(merged.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  // Why: a refresh reloads from HEAD. Appending it would stack today's commits under yesterday's.
  it('replaces when no cursor was requested', () => {
    const merged = foldGitHistoryPage(page(['a', 'b']), page(['c', 'd']), undefined)
    expect(merged.items.map((i) => i.id)).toEqual(['c', 'd'])
  })

  // Why: an anchor killed by a rebase/amend/prune/gc is answered with a fresh page from HEAD, and
  // the differing pageAnchor is the only thing that says so. Appending it would render an
  // unrelated history below a dead one, children after their parents.
  it('replaces when the page came back on a different walk than the one requested', () => {
    const restarted = page(['x', 'y'], { pageAnchor: 'b'.repeat(40) })
    const merged = foldGitHistoryPage(page(['a', 'b']), restarted, REQUESTED)
    expect(merged.items.map((i) => i.id)).toEqual(['x', 'y'])
  })

  // Why: a host too old to page echoes no anchor at all, so it can never be a continuation.
  it('replaces when the host echoes no page anchor', () => {
    const merged = foldGitHistoryPage(
      page(['a', 'b']),
      page(['c', 'd'], { pageAnchor: undefined }),
      REQUESTED
    )
    expect(merged.items.map((i) => i.id)).toEqual(['c', 'd'])
  })

  // Why: HEAD can move under the walk between pages and shift the offset, re-emitting a commit.
  // Duplicate React keys and a doubled graph row are the visible failure.
  it('drops a commit the new page repeats', () => {
    const merged = foldGitHistoryPage(page(['a', 'b', 'c']), page(['c', 'd']), REQUESTED)
    expect(merged.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('takes hasMore, the next cursor, and branch metadata from the newest page', () => {
    const merged = foldGitHistoryPage(
      page(['a'], { mergeBase: 'old', nextCursor: { anchor: ANCHOR, loaded: 1 } }),
      page(['b'], { mergeBase: 'new', nextCursor: { anchor: ANCHOR, loaded: 2 } }),
      REQUESTED
    )
    expect(merged.hasMore).toBe(true)
    expect(merged.nextCursor).toEqual({ anchor: ANCHOR, loaded: 2 })
    expect(merged.mergeBase).toBe('new')
  })

  // Why: a host that ignores the cursor answers every page with page one. Without this the button
  // stays lit and every click re-fetches the same commits, which reads as a hang.
  it('stops paging when a continuing page adds nothing new', () => {
    const merged = foldGitHistoryPage(
      page(['a', 'b']),
      page(['a', 'b'], { nextCursor: { anchor: ANCHOR, loaded: 2 } }),
      REQUESTED
    )
    expect(merged.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(merged.hasMore).toBe(false)
    expect(merged.nextCursor).toBeUndefined()
  })

  it('never loses commits already on screen when the new page is empty', () => {
    const merged = foldGitHistoryPage(page(['a', 'b']), page([], { hasMore: false }), REQUESTED)
    expect(merged.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(merged.hasMore).toBe(false)
  })
})
