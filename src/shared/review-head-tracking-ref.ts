// Why: durable per-review refs avoid shared FETCH_HEAD races and keep the head
// commit reachable between resolve and worktree create. Client (main) and relay
// must agree on these paths, so both import from here rather than hardcoding.

export function githubPullRequestHeadLocalRef(prNumber: number): string {
  return `refs/orca/pull/${prNumber}`
}

export function gitlabMergeRequestHeadLocalRef(mrIid: number): string {
  return `refs/orca/merge-requests/${mrIid}`
}
