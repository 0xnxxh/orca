// Why: durable per-review refs avoid shared FETCH_HEAD races and keep the head
// commit reachable between resolve and worktree create. Client (main) and relay
// must agree on these paths, so both import from here rather than hardcoding.

// Why: an unreachable or stalled remote must fail review-head resolve/create,
// not hang it; client and relay fetches share one bound.
export const REVIEW_HEAD_FETCH_TIMEOUT_MS = 60_000

export function githubPullRequestHeadLocalRef(prNumber: number): string {
  return `refs/orca/pull/${prNumber}`
}

export function gitlabMergeRequestHeadLocalRef(mrIid: number): string {
  return `refs/orca/merge-requests/${mrIid}`
}

// Why: PR/MR numbers are interpolated into refspecs; relay and local fetch
// paths must reject non-integers with one shared guard.
export function isValidReviewHeadNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

// Why: a remote beginning with "-" would be parsed as a git option.
export function isSafeReviewHeadFetchRemote(remote: string): boolean {
  return !remote.startsWith('-')
}
