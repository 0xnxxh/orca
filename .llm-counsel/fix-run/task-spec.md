You are fixing ALL consensus issues from the LLM counsel review on branch P1-D-hosted-review-inflight.

## Source of truth
Read fully:
- /Users/jinjingliang/Documents/projects/orca/P1-D-hosted-review-inflight/.llm-counsel/20260801-183920/COUNSEL-REPORT.md
- Individual reviews under /Users/jinjingliang/Documents/projects/orca/P1-D-hosted-review-inflight/.llm-counsel/20260801-183920/reviews/ if needed

Worktree: /Users/jinjingliang/Documents/projects/orca/P1-D-hosted-review-inflight
Stay in this worktree. Do not follow absolute paths into other checkouts.

## Non-negotiable goals
Fix functional + performance regressions. Prefer smallest correct fixes over rewrites.
Do NOT disable lint max-lines. Keep comments concise (why only). Follow AGENTS.md / project rules.
All changes must consider SSH, folder workspaces, and multi-forge (not GitHub-only).

## Required fixes (from counsel consensus — implement all)

### 1) Late-adopt store predicate (C1, C6, C5) — PRIMARY
File: src/main/source-control/hosted-review-branch-cache.ts
- On timedOut, do NOT store over a pre-refresh entry (especially open review → null wipe).
- Do not let a timed-out straggler short-circuit a replacement inflight via isFresh(null).
- Reverse-order dual-timeout: older attempt must not suppress newer attempt via fetchedAt vs startedAt alone.
- Cap-evicted (not-timedOut) stragglers must not overwrite newer stores or noteFailure a healthy successor.
- Ownership-based guards preferred (token / latest attempt), not timedOut-only.
- Do not clearFailures on discarded late results.

### 2) Regression tests for cache races
In hosted-review-branch-cache.test.ts add cases for:
(a) timed-out null vs pre-refresh open entry (must keep open / not install long-lived null)
(b) timed-out null while replacement inflight (callers must still join replacement; no false fresh null)
(c) reverse-order dual timed-out completion (newer answer wins)
(d) cap-evicted non-timedOut straggler store/reject cannot clobber/penalize successor

### 3) Timeout must not become definitive cached "no review" (C4)
- github-repository-identity / hosted-review path: git timeout/transient errors must NOT be stored as successful review:null for 15m.
- Prefer throw or classify as unavailable so backoff/error path applies, not NO_REVIEW TTL.
- Align with existing comments about not poisoning cache with definitive miss on transient failure.

### 4) Bound get-url on all forge probes + coalesce awareness (C3)
- FORGE_PROVIDERS[0] is GitLab — gitlab-project-ref-resolution (and bitbucket/azure/gitea peers) still call unbounded git remote get-url.
- Add the same 30s (or shared constant) kill-path timeout as GitHub local/WSL.
- Lower-layer settle-only inflight maps (e.g. project-ref-inflight, known-hosts, config-signature where relevant): a hung probe must not permanently pin retries for the process lifetime. Make coalesce deadline-aware, drop hung entries, or otherwise allow post-recovery retries to start a new probe.

### 5) Cap detached lookups (C2) + optional clearFailures discipline
- Track / limit never-settling detached lookups per key (and consider global budget).
- Refuse starting another lookup for a key while a prior attempt is still unsettled, OR hard-cap detached zombies.
- Revisit clearFailures on post-deadline straggler success so chronically slow hosts still escalate backoff (opus F5).

### 6) Related High if cheap
- readLocalGitConfigSignature unbounded fs.stat on native dead mounts (before get-url) — timeout or skip when it blocks the hang path this PR claims to fix.

## Working tree note
There may already be uncommitted non-behavioral edits (MAX_BRANCH_MAP_ENTRIES hoist + comments). Keep them if useful; do not revert unrelated work.

## Validation
- Run: pnpm exec vitest run src/main/source-control/hosted-review-branch-cache.test.ts src/main/github/gh-utils.test.ts (and any new/related tests you touch)
- Run typecheck for node if you change types: pnpm exec tsc --noEmit -p config/tsconfig.node.json --pretty false (or project-equivalent)
- Fix until green.

## Delivery
- Implement the fixes in this worktree.
- Summarize what changed and which counsel IDs (C1–C6) each change addresses.
- worker_done with filesModified list, outcome succeeded/failed, and a short residual-risk note.