import type { GitHistoryResult } from '../../../../shared/git-history'

/**
 * Commit id to resume paging from, or undefined when nothing is loaded yet.
 */
export function gitHistoryCursor(result: GitHistoryResult | undefined): string | undefined {
  return result?.items.at(-1)?.id
}

/**
 * Fold a newly fetched page onto the commits already on screen.
 *
 * Page metadata (refs, merge base, incoming/outgoing) describes the branch rather than the page,
 * so the newest page wins. Items append.
 */
export function appendGitHistoryPage(
  previous: GitHistoryResult | undefined,
  page: GitHistoryResult
): GitHistoryResult {
  if (!previous) {
    return page
  }

  // Why: topo-order can interleave parallel branches differently when the walk starts at the
  // cursor instead of HEAD, so a commit can repeat across a page boundary. Ids are immutable, so
  // dropping repeats here keeps React keys unique and the graph honest.
  const seen = new Set(previous.items.map((item) => item.id))
  const added = page.items.filter((item) => !seen.has(item.id))

  return { ...page, items: [...previous.items, ...added] }
}
