# Review — anonymized

## Executive summary

This branch correctly unpins wedged `hostedReview:forBranch` lookups (120s detachable deadline + wall-clock sweep) and bounds local/WSL `git remote get-url` (30s) so a dead mount no longer hangs the funnel forever. The design is mostly sound—tokenized inflight ownership, stale-on-timeout, backoff on deadline, generation guards—but the late-adopt path is too aggressive: a timed-out straggler may still `storeEntry` whenever no *newer completed* answer exists, even if a replacement lookup is in flight or an older last-known review is still cached. That creates false cache hits (including wiping an open review to `null` for up to the 15‑minute no-review TTL) and clears backoff while recovery is still running. Under a true hang (the failure mode this PR targets), detached lookups also accumulate without bound because each deadline cycle starts a new provider call while prior ones keep running.

**Verdict:** Do not ship without tightening late-adopt store rules; the pin-recovery claim is real, but it introduces high-severity correctness and load regressions on the exact hang path.

## Findings

| # | Severity | Location | Impact | Evidence |
|---|----------|----------|--------|----------|
| 1 | **High** | `hosted-review-branch-cache.ts:332-336` | Timed-out straggler can **overwrite last-known open review with `null`**, blanking the card for up to **15 minutes** (no-review TTL) or **60s** if active. Also `clearFailures` undoes deadline backoff. | Store guard is only `generation` + `!(timedOut && answeredSince)`. `answeredSince` requires `entries.get(key).fetchedAt >= startedAt`. A refresh that timed out still has the *pre-refresh* entry with `fetchedAt < startedAt`, so a late `null` is treated as adoptable and replaces the open review. Tests cover straggler vs *already-stored* newer answer (`does not let a straggler overwrite…`) and straggler *reject* vs replacement inflight (`does not let a straggler evict…`), but **not** straggler *resolve* while replacement is inflight or while pre-refresh entry remains. |
| 2 | **High** | `hosted-review-branch-cache.ts:332-336` + `:396-398` | While replacement lookup **B** is in flight after A timed out, late A success stores a fresh entry → subsequent callers hit `isFresh` and **never join B**. False “no review” (15 min) or false open (60s) until B finishes (if it still does). | After timeout, `releaseInflight` cleared A; B is tracked. A’s completion does not check `inflight.has(key)` / newer token. Fresh negative cache short-circuits before `inflight.get(key)`. |
| 3 | **High** | `hosted-review-branch-cache.ts:264-267, 325-361` + pacing `HOSTED_REVIEW_LOOKUP_DEADLINE_MS` | Under persistent hang (unbounded step below the funnel), each deadline+backoff cycle starts a **new** lookup while prior detached ones keep running → **unbounded concurrent wedged work** per branch (handles/API children), the opposite of the old “one pin” steady state. | Comment at pacing:38 admits deadline is for steps *without* their own timeout. Detached IIFE always `await lookup()` with no cancel. Inflight map only tracks the current owner; zombies are invisible to `MAX_INFLIGHT_LOOKUPS` (500). Steady state after max backoff ≈ one new zombie every ~deadline+15m, unbounded over a long session / many branches. |
| 4 | **Medium** | `hosted-review-branch-cache.ts:216-226` | Size-cap eviction drops inflight **without** `expire()` / `noteFailure`. Evicted branch is immediately re-lookupable; callers still wait until timer/sweep; amplifies duplicate provider calls under pathological fan-out. | Explicit comment: “drop without expiring”. Test `bounds the in-flight map…` asserts re-lookup of branch 0. Fine as memory backstop at 500, but couples poorly with finding 3. |
| 5 | **Medium** | `github-repository-identity.ts:100-118` + `resolveOwnerRepoForRemote` catch | Local/WSL `get-url` timeout correctly fails the hang, but timeout is **not** a stable-missing remote → returns `null` without negative cache; hosted-review path treats missing provider as **successful `null` review** and can pin “no review” for 15 min after a 30s WSL/mount blip. | `isStableMissingGitRemoteError` only matches `/no such remote/i`. Transient/timeout → uncached `null`. `hosted-review.ts:73-75` maps no provider → `null` (success into cache), not throw. Pre-existing transient pattern; this PR makes 30s timeouts a common trigger where hang used to dominate. |
| 6 | **Low** | `hosted-review-branch-cache.ts:289-315` | Timeout on a **refresh** still `noteFailure` even when stale review is successfully returned to callers → active-tier “every minute” refresh becomes 60s→120s→… backoff after one wedge, delaying visibility of state changes. | Intentional escalation, but UX regression vs pre-deadline behavior (stuck forever vs temporarily slower). Worth documenting; probably acceptable if late-adopt bugs are fixed. |
| 7 | **Low** | `github-repository-identity.ts:106-112` | SSH `getRemoteUrlForRepo` still has no local timeout (relies on relay 30s). Asymmetric with local/WSL; OK if relay contract holds, brittle if SSH provider exec bypasses mux bounds. | Diff intentionally leaves SSH branch unchanged. |

### Finding 1–2 detail (failure scenario)

```text
t0     cache has openReview, fetchedAt=T0
t0+60s refresh A starts (startedAt=T1), lookup wedges
t1+120 A deadline: release stale openReview to callers, noteFailure, inflight cleared
t2     (backoff ends) B starts; still in flight
t3     A finally resolves null
       → timedOut && answeredSince?  fetchedAt T0 < T1 → false
       → storeEntry(null), clearFailures   // BUG
t3+ε   poll: isFresh(null) true → return null, never joins B
       card shows “no PR” for NO_REVIEW_REFRESH_INTERVAL_MS (15m) or 60s if active
```

Same shape if B is not started yet (still backing off): late null clears backoff *and* installs a long-lived negative cache, so recovery is deferred further.

**Fix direction (review-only suggestion):** on `timedOut`, store only when the cache is empty *and* no other inflight owns the key (pure cold-start adopt); never `clearFailures` unless the stored answer is kept; never overwrite an entry whose `fetchedAt < startedAt` with a late result unless it is strictly newer than any concurrent owner. Prefer: `if (!timedOut) { store… } else if (!inflight.has(key) && entries.get(key) === undefined) { store… }`.

### Finding 3 detail

Old steady state on hang: 1 inflight promise, branch pinned, no additional provider load.

New steady state on hang: after each 120s deadline, backoff allows another `startLookup` while the previous IIFE still awaits. No cap on detached work. Escalation slows the *start* rate but never reaps zombies. This is the load regression on the exact P1-D hang the PR claims to fix.

**Fix direction:** track detached count / global in-flight provider calls; refuse new starts while a detached for the same key (or global budget) is still alive; or hard-cancel via AbortSignal once steps support it.

## Performance surface

| Surface | Assessment |
|---------|------------|
| Hot path `withHostedReviewBranchCache` | Adds `expireOverdueInflight` O(\|inflight\|) ≤ 500 per call — fine for poll cadence. |
| Deadline timer | `setTimeout` + `unref` — good; does not keep event loop alive alone. |
| Coalescing | Still collapses concurrent joiners onto one tokenized record — good. |
| Backoff | Extracted cleanly; preserves escalation across cache invalidation lifetime — good. |
| Duplicate work after deadline | **Regressed:** detach + re-poll intentionally duplicates; hang multiplies (finding 3). |
| Inflight cap 500 | Memory backstop only; eviction causes duplicate calls (finding 4); does not bound detached zombies. |
| `git remote get-url` 30s | Real hang fix for local/WSL; arms runner kill path (consistent with `runner.ts` timeout design). Cost: up to 30s blocked probe on wedge, then null (finding 5). |
| Owner-repo cache | Timeout not cached → repeated 30s probes until hosted-review/backoff absorbs — watch under WSL flakiness. |

## Functionality / regression surface

| Claim | Reality |
|-------|---------|
| Unpin wedged branch in-session | **Works** — deadline + wall-clock sweep + tests (`releases a stuck lookup…`, `releases a caller by wall clock…`). |
| Stale review on timeout refresh | **Works** — `keeps the last known review when a refresh times out`. |
| Token prevents straggler from clearing replacement inflight | **Works** for map ownership / reject path. |
| Late answer adopted for convergence | **Partially works**, but store predicate is incomplete → **false cache hits / wiped open review** (findings 1–2). |
| Straggler cannot overwrite newer answer | Only if newer answer already **stored**; incomplete vs in-flight replacement. |
| Generation / invalidation | Still correct; invalidation does not cancel inflight (pre-existing); generation blocks store after open-in-Orca. |
| Local/WSL get-url bound | **Works** as hang break; SSH relies on relay. |
| Timeout vs “no review” | Risk of mis-classifying infra failure as no PR (finding 5). |
| Host identity (SSH vs local same path) | Unchanged; still keyed by `connectionId` + path. |

## Residual risks / what you could not verify

- Did not run full app/Electron integration or real WSL/SSH hang repros; unit tests for cache + gh-utils (64) pass, including new P1-D cases.
- Did not audit every provider step under `getReviewForBranch` for missing timeouts (assumed some remain unbounded per pacing comment).
- Did not inspect renderer error/empty-state handling for thrown timeout / “backing off” strings (IPC rethrows; may blink error cards during backoff with no cache — largely pre-existing).
- Did not measure production poll fan-out (desktop + mobile + `orca serve`) under multi-window load after deadline storms.
- `localGitExecOptions` still `JSON.stringify`’d into cache keys (pre-existing key stability risk; out of diff focus).

## Test gaps to add before merge

1. Timed-out straggler **resolves `null`** while a replacement is **in flight** → cache must not go negative; replacement must still be joined.
2. Timed-out refresh straggler **resolves `null`** while last-known **open** entry remains → must not overwrite open with null / must not `clearFailures` incorrectly.
3. Long hang: N successive deadline cycles → assert bounded concurrent detached lookups (or document hard limit).
4. `getRemoteUrlForRepo` passes `timeout: 30_000` (gh-utils tests already expect 30s on several paths; ensure timeout-kill path does not cache as stable miss).

## Bottom line

Ship the hang-unpin and get-url timeout ideas, but **block on fixing late-adopt store conditions and bounding detached zombie accumulation**. Without those, the branch trades a stuck spinner for silent wrong “no PR” windows and potential main-process load growth under the same wedge.
