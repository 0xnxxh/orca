import type { GitHistoryCursor, GitHistoryOptions } from './git-history-types'

/**
 * Read history options off a request that crossed a process or host boundary.
 *
 * Every transport (Electron IPC, runtime RPC, the SSH provider, the relay, the paired web client)
 * used to spell this whitelist out for itself, so adding `cursor` to the contract left it dropped
 * on all of them and paging silently re-served page one. One reader means a new option reaches git
 * everywhere or nowhere.
 */
export function readGitHistoryOptions(params: {
  limit?: unknown
  baseRef?: unknown
  cursor?: unknown
}): GitHistoryOptions {
  return {
    limit: typeof params.limit === 'number' ? params.limit : undefined,
    baseRef: typeof params.baseRef === 'string' ? params.baseRef : null,
    cursor: readGitHistoryCursor(params.cursor)
  }
}

// Why: the anchor is only ever a commit id this host handed out, and it is spent on a git revision
// argument. Requiring a full object id keeps anything option-shaped out of argv by construction
// rather than by blocklisting a leading dash.
const FULL_GIT_OBJECT_ID = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/

function readGitHistoryCursor(value: unknown): GitHistoryCursor | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const { anchor, loaded, after } = value as {
    anchor?: unknown
    loaded?: unknown
    after?: unknown
  }
  // Why: without the seam there is nothing to verify the walk against, so a cursor missing it is
  // not a cursor. Dropping it restarts at page 1 rather than resuming on an unchecked assumption.
  if (
    typeof anchor !== 'string' ||
    !FULL_GIT_OBJECT_ID.test(anchor) ||
    typeof after !== 'string' ||
    !FULL_GIT_OBJECT_ID.test(after)
  ) {
    return undefined
  }
  return {
    anchor,
    after,
    loaded:
      typeof loaded === 'number' && Number.isFinite(loaded) ? Math.max(0, Math.trunc(loaded)) : 0
  }
}
