import type { GitHistoryResult } from '../../../../shared/git-history'

/**
 * Fold a newly fetched page onto the commits already on screen.
 *
 * Page metadata (refs, merge base, incoming/outgoing, the next cursor) describes the branch and the
 * paging position rather than the page's contents, so the newest page wins. Items append.
 */
export function appendGitHistoryPage(
  previous: GitHistoryResult | undefined,
  page: GitHistoryResult
): GitHistoryResult {
  if (!previous) {
    return page
  }

  // Why: ids are immutable, so dropping repeats keeps React keys unique if HEAD moved under the
  // walk between pages and shifted the offset.
  const seen = new Set(previous.items.map((item) => item.id))
  const added = page.items.filter((item) => !seen.has(item.id))

  if (added.length === 0) {
    // Why: a page that adds nothing cannot page any further — a host that ignores the cursor hands
    // back page one forever. Stop rather than leave a "Load more" button that never moves.
    return { ...page, items: previous.items, hasMore: false, nextCursor: undefined }
  }

  return { ...page, items: [...previous.items, ...added] }
}
