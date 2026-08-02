# Blind rating packet

Rate reports A–D only. Do not guess models.

## Report: C

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

## Report: D

# Review — anonymized

## Executive summary

I found one high-severity resource/quota regression and two medium-severity ordering/deduplication regressions in the new detachable hosted-review deadline. The timeout releases the tracked record but cannot cancel or bound the detached operation, so the finite backoff can start an unlimited number of never-settling lookups; overlapping late completions can also preserve the older answer, and the 500-record cap deliberately creates duplicate provider calls. The focused 64 tests, Node typecheck, and `git diff --check` pass, but the tests encode the cap duplication and do not exercise repeated never-settling retries or reverse-order completion of two timed-out attempts.

## Findings

1. **High — Timed-out lookups accumulate without any bound**  
   **File:** `src/main/source-control/hosted-review-branch-cache.ts:289` (also `:325-361`, `:400-414`); `src/main/source-control/hosted-review-lookup-backoff.ts:16-34`  
   **Impact:** A genuinely wedged provider can leave an ever-growing set of live HTTP/RPC/subprocess operations and retained closures in the main process. Because visible cards poll every minute (`src/renderer/src/components/sidebar/WorktreeCard.tsx:670-690`) and backoff tops out at 15 minutes, each permanently stuck branch eventually launches another permanent lookup after every capped backoff window. Across many branches this can steadily consume memory, sockets/processes, remote-host work, and provider quota for the lifetime of Orca.  
   **Evidence:** `expire()` removes only the `inflight` record and settles the wrapper promise; the actual `lookup()` remains awaited by the detached async closure, and the implementation explicitly says it cannot be cancelled (`:263-267`, `:300-315`, `:325-361`). Once the finite `backoffUntil` expires, `withHostedReviewBranchCache` calls `startLookup` again (`:400-414`), while `MAX_INFLIGHT_LOOKUPS` counts only currently tracked records and excludes every timed-out detached lookup. The added test at `hosted-review-branch-cache.test.ts:411-425` already demonstrates that a second lookup is started after the first `stuckLookup` remains unresolved; repeating that same tested transition produces unbounded live work. This is a regression from the base behavior, which held exactly one stuck promise per key.

2. **Medium — An older timed-out attempt can suppress the result of a newer attempt**  
   **File:** `src/main/source-control/hosted-review-branch-cache.ts:257-260`, `:325-335`  
   **Impact:** A stale negative answer can hide a newly opened review for up to the 15-minute inactive-card TTL, or stale review metadata can replace the more current result.  
   **Evidence:** The overwrite guard uses the cached entry's **completion/store time** (`fetchedAt >= startedAt`), not the producing lookup's start order. Concrete sequence: attempt A starts, times out; attempt B starts after backoff and also times out; A then returns `null` and stores it with a fresh `fetchedAt`; B then returns the open review. Since A's store time is later than B's start time, B's result is discarded by `timedOut && answeredSince(key, startedAt)` even though B is the newer lookup. The existing straggler test (`hosted-review-branch-cache.test.ts:492-510`) covers only the opposite ordering—newer attempt completes before the older straggler—so it does not falsify this race.

3. **Medium — The in-flight “memory backstop” breaks deduplication and can cause cap-edge cache thrash**  
   **File:** `src/main/source-control/hosted-review-branch-cache.ts:216-226`, `:395-414`; `src/main/source-control/hosted-review-refresh-pacing.ts:40-45`  
   **Impact:** With more than 500 concurrent branch identities (or staggered requests from multiple desktop/mobile/serve clients), evicted-but-still-running keys become indistinguishable from idle keys. Later callers start duplicate provider lookups before the original deadline, defeating the cache's primary quota-control purpose; an evicted attempt also records no backoff when it times out because `releaseInflight` returns false.  
   **Evidence:** `trackInflight` deletes the oldest live record without expiring or cancelling it (`:216-226`), and the lookup path treats absence from the map as permission to start another call (`:395-414`). The branch's own test explicitly proves the duplicate: after filling the cap, a second call for the oldest still-running branch increments the provider-call count (`hosted-review-branch-cache.test.ts:554-568`). The comment in `expire()` says a size-cap-dropped record “has a live successor” (`:297-302`), but eviction alone creates no successor for that key; therefore its timeout skips `noteFailure`, allowing an immediate retry on the next poll.

## Performance surface

- Reviewed the process-wide hosted-review polling funnel, renderer card polling, local Electron IPC, runtime RPC, SSH mux request bounds, Git response-stream inactivity bounds, failure backoff, timers, and in-flight maps.
- The local/WSL `git remote get-url` path now passes the intended 30-second timeout through the shared runner (`src/main/github/github-repository-identity.ts:100-118`), while SSH remains bounded by the mux's default 30-second request timeout. I found no separate proven regression in that small change.
- `expireOverdueInflight` adds an O(number of tracked lookups) sweep to every cache request, and mass expiry calls an O(number of failures) prune per record. The maps are capped at 500, so I did not elevate this bounded O(N²) wake-up case above the proven unbounded detached-work issue.

## Functionality / regression surface

- Cache identity still includes connection ID, repo path, branch, linked provider IDs, and serialized local Git execution options; the change did not introduce a direct local/WSL/SSH key collision.
- Token identity correctly prevents a late attempt's `finally` block from deleting a replacement record, but it does not establish answer ordering; finding 2 is the remaining completion race.
- Scope-generation invalidation still prevents a timed-out lookup from storing across an in-scope review-creation invalidation. Error paths preserve the last cached answer as before.

## Residual risks / what you could not verify

- I did not run a live WSL, SSH relay, sleeping-machine, or real provider outage scenario, so OS-level process cleanup and provider-specific cancellation behavior remain integration risks.
- I did not exhaustively audit every forge client's internal HTTP timeout; the deadline code itself states some lower-level work is non-cancellable, which is sufficient for finding 1.
- Validation performed: `pnpm exec vitest run src/main/source-control/hosted-review-branch-cache.test.ts src/main/github/gh-utils.test.ts` (64/64 passed), `pnpm exec tsc --noEmit -p config/tsconfig.node.json --pretty false` (passed), and `git diff --check 8fc892dd023850df379c07cc4e7a46cff9a3ea84` (passed).

## Report: B

# Review — anonymized

Branch `P1-D-hosted-review-inflight` @ `5f908a17ef`, base `8fc892dd02`.
Scope: `0a1ba0f987` (in-flight deadline + backoff split) and `5f908a17ef` (`git remote get-url` timeout), plus the uncommitted working-tree changes that appeared mid-review (see the note below).
Branch tests run and pass: `hosted-review-branch-cache.test.ts` + `gh-utils.test.ts` → 64/64.

> **Note on line numbers.** While this review was in progress the author modified the working tree
> (`hosted-review-branch-cache.ts`, `hosted-review-lookup-backoff.ts`, `hosted-review-refresh-pacing.ts`):
> a comment expansion plus hoisting the three `500` caps into a shared `MAX_BRANCH_MAP_ENTRIES`.
> Those changes are non-behavioural — every finding below still applies unchanged. Line anchors have
> been re-resolved against the current working tree, not against `5f908a17ef`.

## Executive summary

The in-flight deadline in `hosted-review-branch-cache.ts` is well built in isolation — the token identity, generation guard, straggler-adoption and wall-clock sweep all hold up under adversarial reading, and the test file covers them. The problem is that the branch's central claim — *"That is what lets a wedged host recover in-session (P1-D)"* — does not survive contact with the layers underneath it. On the hosted-review lookup path the **first** `git remote get-url` executed is GitLab's (`FORGE_PROVIDERS[0]`), which this branch left unbounded; below that, `runProjectRefProbeOnce`, `getGlabKnownHosts`, `localGitConfigSignatureInFlight` and `ownerRepoInFlight` all coalesce **permanently** on an unsettled promise, so every post-deadline retry re-joins the same dead promise, re-times-out, and the branch escalates to the 15-minute backoff and never recovers. The 30s exec bound that *was* added is also swallowed one frame up (`resolveOwnerRepoForRemote` returns `null` for anything that isn't "no such remote"), converting a wedged local git into a **definitive cached "no review"** — the exact state `hosted-review-creation.ts:452` calls out as "might hide a real PR — refuse rather than risk a duplicate (design invariant 8)".

11 findings: 4 High, 3 Medium, 4 Low. Two are backed by a runnable harness (numbers below are measured, not estimated).

## Findings

| # | Sev | Location | Claim |
|---|-----|----------|-------|
| F1 | High | `src/main/github/github-repository-identity.ts:114` / `src/main/gitlab/gitlab-project-ref-resolution.ts:92` | The timeout was added to the *second* `remote get-url` on the path; the first is still unbounded |
| F2 | High | `src/main/gitlab/project-ref-inflight.ts:9-25` | Permanent coalescing below the deadline makes "recover in-session" impossible |
| F3 | High | `src/main/github/github-repository-identity.ts:227-233` | The new 30s timeout is swallowed into a definitive, cached "no review" |
| F4 | High | `src/main/github/github-repository-identity.ts:159` → `local-git-config-signature.ts:202` | An unbounded `fs.stat` runs *before* the newly-bounded exec, on the exact dead-mount scenario the commit cites |
| F5 | Medium | `src/main/source-control/hosted-review-branch-cache.ts:342` | A post-deadline straggler resets the escalation; measured 36 calls/2h instead of ~8 |
| F6 | Medium | `src/main/source-control/hosted-review-branch-cache.ts:307-309` | Detached lookups are unbounded and unaccounted; measured 31 leaked over 8h for one branch |
| F7 | Medium | `src/main/source-control/hosted-review-refresh-pacing.ts:38` | 120s deadline is below the sum of the bounded sub-steps it wraps |
| F8 | Low | `src/main/source-control/hosted-review-branch-cache.ts:387` | Cross-key O(inflight) sweep on every call; a poll for A can penalise B |
| F9 | Low | `src/main/git/runner.ts:481-497` (WSL) | Killing `wsl.exe` leaves the Linux-side git orphaned inside the distro |
| F10 | Low | `src/main/source-control/hosted-review-branch-cache.ts:267` | `fetchedAt >= startedAt` at ms granularity can discard a legitimate straggler |
| F11 | Low | `src/main/source-control/hosted-review-branch-cache.ts:324-326` | `unref()`ed deadline timer + `expireOverdueInflight` only running on a new call |

---

### F1 — High — the bound was applied to the wrong call site for this path

**File:** `src/main/github/github-repository-identity.ts:114` (the fix) vs `src/main/gitlab/gitlab-project-ref-resolution.ts:92` (unbounded, runs first)

**Evidence.** `src/main/source-control/forge-provider.ts:295-301`:

```ts
export const FORGE_PROVIDERS = [
  gitLabForgeProvider,   // <-- index 0
  gitHubForgeProvider,
  bitbucketForgeProvider,
  azureDevOpsForgeProvider,
  giteaForgeProvider
] as const
```

`getForgeProviderForRepository` (`forge-provider.ts:307-316`) iterates in order and `await`s each `resolveRepository`. So for **every** repo — GitHub repos included — the first provider probe is `gitLabForgeProvider.resolveRepository` → `getProjectSlug` (`gitlab/client.ts:240-248`) → `getProjectRef` → `getProjectRefForRemote` → `resolveProjectRefForRemote`, which at `gitlab-project-ref-resolution.ts:92` runs:

```ts
: await gitExecFileAsync(['remote', 'get-url', remoteName], {
    cwd: repoPath,
    ...(localGitOptions.wslDistro ? { wslDistro: localGitOptions.wslDistro } : {})
  })
```

No `timeout`. This is not gated on glab being installed: `probeGlabKnownHosts` catches its own failure and returns `DEFAULT_GITLAB_HOSTS` (`gitlab-known-host-probe.ts:104-107`), so the git call runs regardless.

The same unbounded pattern exists on the other three fall-through providers, all on this same chain:
- `src/main/bitbucket/repository-ref.ts:101`
- `src/main/azure-devops/repository-ref.ts:226`
- `src/main/gitea/repository-ref.ts:162`

**Failure scenario.** Repo on a wedged local/WSL git (dead SMB mount, stalled WSL interop). `hostedReview:forBranch` → `getForgeProviderForRepository` → GitLab probe → unbounded `git remote get-url` → hangs. The newly-bounded GitHub call at `github-repository-identity.ts:114` is never reached. The commit message for `5f908a17ef` states the call "never returns and every caller above it hangs with it (P1-D)" — that is still true on the hosted-review path, just one file over.

**Why the 120s deadline doesn't rescue it:** see F2.

---

### F2 — High — permanent coalescing below the deadline defeats in-session recovery

**File:** `src/main/gitlab/project-ref-inflight.ts:9-25`

```ts
const projectRefInFlight = new Map<string, Promise<ProjectRef | null>>()

export async function runProjectRefProbeOnce(cacheKey, createProbe) {
  const inFlight = projectRefInFlight.get(cacheKey)
  if (inFlight) return inFlight            // <-- joins a dead promise forever
  const probe = createProbe()
  projectRefInFlight.set(cacheKey, probe)
  try { return await probe }
  finally { if (projectRefInFlight.get(cacheKey) === probe) projectRefInFlight.delete(cacheKey) }
}
```

The `finally` only runs when the probe **settles**. A probe that hangs (F1) is never removed, so the map entry is permanent for the process lifetime. Same structure at:
- `gitlab-known-host-probe.ts:70-82` (`knownHostsInFlightByExecutionContext`)
- `local-git-config-signature.ts:22-35` (`localGitConfigSignatureInFlight`)
- `github-repository-identity.ts:166-181` (`ownerRepoInFlight`) — this one *is* now bounded, because the 30s exec timeout makes it settle. That is the real value delivered by `5f908a17ef`, and it is the only one of the four.

**Failure scenario (contradicts the docblock at `hosted-review-branch-cache.ts:270-275`).**
1. t=0 — lookup L1 wedges in the GitLab probe. `projectRefInFlight[key]` = never-settling promise.
2. t=120s — deadline fires, `noteFailure`, caller rejected. UI unpinned ✅.
3. t=181s — a new lookup L2 starts. It calls `getProjectRefForRemote` → `runProjectRefProbeOnce` → **returns L1's dead promise**. L2 spawns no new git; it simply hangs on the corpse.
4. t=301s — L2's deadline fires. failures=2.
5. Repeat forever, escalating to the 15-minute cap.

The branch is never able to produce an answer again for the rest of the session, even after the mount recovers. `hosted-review-branch-cache.ts:274` claims the opposite: *"That is what lets a wedged host recover in-session (P1-D)."* The UI recovers (it stops hanging); the **lookup** does not. The tests in `hosted-review-branch-cache.test.ts` cannot catch this because they inject the lookup directly (`stuckLookup()` returns a fresh promise each call, at line 20-26), which is precisely the behaviour the real stack does not have.

---

### F3 — High — the new timeout is swallowed into a definitive cached "no review"

**File:** `src/main/github/github-repository-identity.ts:227-233`

```ts
} catch (error) {
  // Why: only stable "no such remote" misses are safe to hold for minutes.
  if (!isStableMissingGitRemoteError(error)) {
    return null                            // <-- a timeout lands here
  }
}
```

The timeout error is `new Error('git timed out.')` (`git/runner.ts:487`). `isStableMissingGitRemoteError` tests `/no such remote/i` (`stable-missing-git-remote-error.ts:16`) → false → `return null`.

Chain: `getOwnerRepoForRemote` → `null` → `gitHubForgeProvider.resolveRepository` falsy → `getForgeProviderForRepository` returns `null` → `hosted-review.ts:71-73` `if (!provider) return null` → `withHostedReviewBranchCache` **stores `{ review: null }`** and serves it for `NO_REVIEW_REFRESH_INTERVAL_MS` = 15 minutes on the list tier, `ACTIVE_REFRESH_INTERVAL_MS` = 60s on the selected tier. No `noteFailure`, no backoff, no error card — a definitive, cached "there is no review".

This is the state `forge-provider.ts:110-114` and `hosted-review-creation.ts:452` both explicitly warn about:

```ts
// Why: collapsing an upstream error into a null "no review" lets a transient
// gh/git failure poison the sidebar's hosted-review cache with a definitive miss.
```
```ts
// Why: an unavailable lookup might hide a real PR — refuse rather than risk a
// duplicate (design invariant 8).
if (eligibility.reviewLookupOutcome === 'unavailable') { ... refuse ... }
```

`hosted-review-creation.ts:493-522` maps `review === null` with no thrown error to `reviewLookupOutcome: 'not_found'` — the outcome that *permits* creating a review.

**Failure scenario.** A 30s git stall (network mount blip, WSL interop hiccup) on a repo that has an open PR:
- Worktree cards drop the PR badge for up to 15 minutes.
- Within the 60s active window, Create PR/MR is offered as `not_found` rather than refused as `unavailable`, so the user can open a duplicate PR.

**Is this a regression?** The `return null` swallow is pre-existing. What `5f908a17ef` newly does is route wedged-host hangs *into* it: before the timeout the call hung (bad, but never produced a false negative); now it resolves to a false negative in 30s. The timeout needs a matching classification — either rethrow timeouts from `resolveOwnerRepoForRemote`, or tag the error so the hosted-review layer surfaces `unavailable`.

---

### F4 — High — an unbounded `fs.stat` runs before the newly-bounded exec

**File:** `src/main/github/github-repository-identity.ts:159` → `src/main/github/local-git-config-signature.ts:199-214`

```ts
// github-repository-identity.ts:159 — before resolveOwnerRepoForRemote
const nextConfigSignature = await readLocalGitConfigSignature(context)
```
```ts
// local-git-config-signature.ts:199-202
async function resolveLocalGitConfigPaths(repoPath: string) {
  const dotGitPath = join(repoPath, '.git')
  try {
    const dotGitStats = await stat(dotGitPath)      // <-- unbounded

… [173 more lines in full file /Users/jinjingliang/Documents/projects/orca/P1-D-hosted-review-inflight/.llm-counsel/20260801-183920/reviews-blind/B.md] …

## Report: A

# Review — anonymized

Branch: `P1-D-hosted-review-inflight` (`8fc892dd02..5f908a17ef`, no uncommitted production changes — only the untracked `.llm-counsel/` scaffolding).

## Executive summary

The branch does what it claims: hosted-review lookups get a 2-minute detachable deadline (timer + wall-clock sweep), the per-branch failure backoff moves to its own module with unchanged semantics, and the local/WSL `git remote get-url` path gets a real 30s kill-path timeout. I actively tried to falsify the core claims and could not: the token-identity release, the double-count guard, the straggler-vs-successor yield, the generation guard, and the sleep-survival sweep all hold on the timed-out path, and the 64 touched tests plus `tsc -p config/tsconfig.node.json` are green. The real gaps are all on the **not-timed-out straggler path**: a record evicted by the `MAX_INFLIGHT_LOOKUPS` cap escapes both the `answeredSince` yield and the `noteFailure` suppression, so under cap pressure an old answer can overwrite a newer one and a healthy successor can be penalized — plus a handful of deliberate-tradeoff behaviors (post-sleep mass-fail, recovery delayed one backoff window) worth having on the record.

## Findings

| # | Severity | Location | Finding |
|---|----------|----------|---------|
| 1 | **Medium** | `src/main/source-control/hosted-review-branch-cache.ts:332` | Cap-evicted straggler bypasses the `answeredSince` yield: an older answer can overwrite a newer cached one |
| 2 | **Medium** | `src/main/source-control/hosted-review-branch-cache.ts:344` | Cap-evicted straggler's late rejection calls `noteFailure` against a key whose healthy successor is mid-flight |
| 3 | **Low** | `src/main/source-control/hosted-review-branch-cache.ts:202`, `hosted-review-lookup-backoff.ts:23` | Sleep/wake mass-fail: every lookup suspended across a >2 min sleep is counted as a provider failure and backed off, with escalation persisting across repeated sleeps |
| 4 | **Low** | `src/main/source-control/hosted-review-branch-cache.ts:378-412` | The poll that detects a lapsed deadline cannot start the retry — recovery is delayed by a full backoff window beyond the deadline |
| 5 | **Low** | `src/main/source-control/hosted-review-branch-cache.ts:325-361` | Truly wedged detached lookups accumulate as never-settling closures for the life of the process |
| 6 | **Low** | `src/main/source-control/hosted-review-refresh-pacing.ts:36` | Slow-but-alive hosts whose full chain exceeds 120s convert every slow success into failure + backoff + duplicate quota spend |
| 7 | **Info** | `src/main/source-control/hosted-review-branch-cache.ts:380` | `expireOverdueInflight` is O(inflight) on every cache call, and each expire's `noteFailure` is O(backoff entries) — bounded ~500×500 worst-case synchronous burst post-wake |

### 1. Medium — cap-evicted straggler overwrites a newer answer (`hosted-review-branch-cache.ts:332`)

The store guard is `!(timedOut && answeredSince(key, startedAt))`. Both successor-protection guards are armed only by `timedOut`, but a record can also leave the `inflight` map **without** timing out: `trackInflight` (`:216-227`) evicts the oldest record when the map exceeds `MAX_INFLIGHT_LOOKUPS` (500), deliberately without calling `expire()`. That evicted record keeps `timedOut === false` until its own 2-minute timer fires.

Failure scenario: inflight climbs past 500 (the exact regime the cap exists for — e.g. a large fleet poll against a slow provider). Record R for key K is evicted at T0. A new caller at T0+1s finds `inflight.get(K)` empty and no backoff, so it starts successor S (legal, tracked). S completes at T0+3s and stores a found review. R — slow but under its own deadline — resolves at T0+30s with data fetched before S's, and because `timedOut` is false the guard passes: R stores its **older** answer with `fetchedAt: Date.now()`, overwriting S's newer one and making it look fresh. If R's answer is `null` ("no review") and the branch is not active, the user's just-found review card blinks out for up to `NO_REVIEW_REFRESH_INTERVAL_MS` (15 minutes). R's store also calls `clearFailures(K)` for a stale observation.

Evidence: the expire path explicitly handles this class ("A record already replaced — or dropped by the size cap — has a live successor", `:297-299`) by gating `noteFailure` on `releaseInflight`; the completion path has no equivalent ownership check — `releaseInflight` is only called in `finally`, *after* the store already happened. The test at `hosted-review-branch-cache.test.ts:492` ("does not let a straggler overwrite an answer newer than itself") only covers the timed-out straggler, not the evicted one.

Precondition-gated (>500 concurrent in-flight lookups), so Medium rather than High. Fix shape: make the store guard ownership-based (`inflight.get(key)?.token === token || !answeredSince(...)`) rather than `timedOut`-based.

### 2. Medium — evicted straggler's late failure penalizes a healthy successor (`hosted-review-branch-cache.ts:344`)

Same eviction window as #1, rejection flavor: the catch path suppresses double-counting only via `if (timedOut) return`. An evicted, not-timed-out record that rejects late calls `noteFailure(key)` unconditionally, even when a healthy successor for the key is mid-flight or has just succeeded — the exact penalty the expire path's `releaseInflight` gate exists to prevent (comment at `:297-299`). Consequence: callers on that key hit "backing off" errors (or pinned stale answers) until the successor's success calls `clearFailures`. Same preconditions as #1; same ownership-check fix covers both.

### 3. Low — post-wake mass failure counting (`hosted-review-branch-cache.ts:202`, `hosted-review-lookup-backoff.ts:23`)

Any lookup in flight when the machine sleeps >2 minutes is expired at wake — by the wall-clock sweep or its own (sleep-delayed) timer — and `noteFailure`'d. Suspended-but-healthy lookups are thus counted identically to provider failures: joined callers with no cached entry get an error card at wake, the branch enters a 60s backoff, and because `noteFailure` retains lapsed counts for a full `LOOKUP_BACKOFF_MAX_MS` (15 min, `hosted-review-lookup-backoff.ts:26-29`), repeated lid-close cycles escalate the window (60s → 120s → …) for branches that never actually failed. Self-healing — the detached lookup resumes post-wake and its adopted answer calls `clearFailures` — and the wall-clock bound is a documented, deliberate choice (the pre-branch alternative was a permanent pin). Flagged because the *failure-counting* side effect, as opposed to the release itself, is not forced by the design: expiry could release callers without escalating.

### 4. Low — recovery waits one backoff window past the deadline (`hosted-review-branch-cache.ts:378-412`)

Order of checks: sweep-expire → inflight-join → backoff. The very poll that sweeps an overdue record then finds the backoff that sweep just created and throws "backing off" (no fresh lookup starts — the detached one doesn't count; it's unjoinable by design). So after a 2-minute hang the first retry begins at ~3 minutes, escalating on repeat. The test at `hosted-review-branch-cache.test.ts:538` encodes this as intended. Worth recording as the actual user-visible recovery latency: deadline + backoff, not deadline.

### 5. Low — permanently wedged detached lookups never settle (`hosted-review-branch-cache.ts:325-361`)

The deadline detaches but nothing cancels: on a host wedged in a step with no timeout of its own (the P1-D premise), each backoff cycle spawns a new detached lookup whose closure is retained forever (its `await lookup()` never resumes). Steady state at max backoff is ~4 new pinned closures/hour/branch — a slow, unbounded, small-object leak for the life of the process. Child processes are not leaked (the git/gh/relay execs underneath have their own 30s kill paths). Acceptable cost for the recovery property; noting for the record.

### 6. Low — 120s deadline vs. legitimately slow chains (`hosted-review-refresh-pacing.ts:36`)

The lookup chain (forge-provider detection → `git remote get-url` → provider `getReviewForBranch`, each step 30s-bounded: `DEFAULT_GH_EXEC_TIMEOUT_MS = 30_000` at `runner.ts:1265`, relay `STREAM_INACTIVITY_TIMEOUT_MS = 30_000`) can in principle chain 5+ slow-but-alive steps past 120s. On such a host every poll converts a slow success into: caller-visible failure/stale, a backoff, *and* duplicate provider calls once the backoff lapses while the detached call still runs — extra quota spend from the mechanism meant to protect quota. Pre-branch, the caller simply waited and got the answer. The band (every step <30s but the sum >120s, consistently) is narrow, and late adoption bounds the damage, so Low.

### 7. Info — sweep cost (`hosted-review-branch-cache.ts:380`)

`expireOverdueInflight` runs synchronously on every `withHostedReviewBranchCache` call (O(inflight), ≤500), and each expire calls `noteFailure`, which itself walks the backoff map (≤500). Worst case — a post-wake call with 500 overdue records — is a one-shot ~250k-iteration synchronous burst on the main process (single-digit ms). Bounded by the caps; no action needed.

## Performance surface

- **Steady-state cost is unchanged.** The hot path (fresh cache hit) adds only the sweep walk over a normally near-empty `inflight` map. No new recurring timers or polls: one `setTimeout` per lookup, `unref`'d, cleared both on completion (`finally`, `:356-358`) and on expiry (`:294-296`). No renderer/stream/send paths touched.
- **No retry amplification on the common path.** Timeouts feed the same escalating backoff as failures (base 60s, ×2 up to 15 min — `MAX_BACKOFF_DOUBLINGS` unchanged), so a wedged host generates at most ~4 lookups/hour/branch at steady state, versus one permanently pinned lookup before. Duplicate provider calls only occur in the deliberate detach-overlap window (#6) and the cap-eviction regime (#1).
- **`git remote get-url` timeout is a strict improvement.** `execFileCapture` does not pass `timeout` to Node's `execFile`; it arms its own timer with `killSpawnedCommandTree` (`runner.ts:480-498`), which handles the WSL wsl.exe→taskkill tree case, so the 30s bound genuinely reaps wedged children. Timeout errors ("`git timed out.`") do **not** match `isStableMissingGitRemoteError`'s `/no such remote/` predicate, so they are correctly *not* negative-cached for 5 minutes (`github-repository-identity.ts:227-233`) — a wedged host retries next poll instead of poisoning identity. In-flight coalescing (`ownerRepoInFlight`) caps concurrent hung probes at one per (repo, remote) key.
- Bounded-map hygiene is consistent: backoff map capped at 500 with insertion-order eviction, inflight capped at 500, all pre-existing caps unchanged.

## Functionality / regression surface

Claims I tried to falsify and could not:

- **Host identity / key scoping.** The backoff map moved modules but keys are byte-identical (`repoScope` + NUL separator, connectionId-scoped); `invalidateHostedReviewBranchCache` reaches the new module via `dropFailuresWithPrefix` with the same prefix. SSH vs local vs WSL keying unchanged; the WSL `wslDistro` passthrough in `getRemoteUrlForRepo` is preserved with the timeout added on both plain and WSL variants (gh-utils tests assert both).
- **Deadline cancel races.** `expire` vs completion is safe: JS single-threading plus the `timedOut`/`completed` flags means every interleaving I traced (timer-fire, sweep-fire, sync-throw, settle-then-sweep) lands in exactly one of release/fail, with `releaseInflight` token-gated so a record only ever deletes itself. Double-fire of `expire` (timer + sweep) is guarded. The shared promise is always consumer-attached before any rejection path can run, so no unhandled-rejection window on the timed-out path.
- **False cache hits/misses.** Generation guard preserved on both the normal and detached store; `answeredSince` uses `fetchedAt >= startedAt` and the theoretical same-millisecond collision is unreachable (a same-ms entry would have been fresh and prevented the lookup from starting). Merged-review head-sensitivity, active-tier promotion/lapse, and stale-beats-error semantics are all regression-tested and unchanged. The exception is the eviction path (#1/#2).
- **Silent swallows.** The one intentionally swallowed rejection (late failure after timeout, `:341-343`) is correct — the caller already heard the deadline failure, and `finally` still releases the record. The non-identity `getRemoteUrlForRepo` callers (`client.ts:434-439`, `github-enterprise-repository.ts:227-231`) already catch and degrade to null, so the new timeout error introduces no new unhandled path.
- **SSH path parity.** The code comment's claim that the SSH branch is already bounded checks out: `provider.exec` → `requestGitStreamable` uses `STREAM_INACTIVITY_TIMEOUT_MS = 30_000` (`ssh/ssh-git-response-stream-reader.ts:10`).
- **Gates.** `npx vitest run` on both touched test files: 64/64 pass. `tsc --noEmit -p config/tsconfig.node.json`: clean.

## Residual risks / what you could not verify

- I did not empirically exercise the >500-inflight eviction regime (#1/#2) — the analysis is by code path; the existing eviction test (`:554`) stops before the straggler-completion interaction.
- I did not verify behavior on a real WSL host that the 30s `killSpawnedCommandTree` reliably reaps a git blocked in `D`-state on a dead network mount (an unkillable process would return the error but leak the child — pre-existing runner behavior, not introduced here).
- Renderer handling of the new timeout rejection text was not traced; it flows through the same RPC rejection channel as the pre-existing "backing off" error, so I assume equivalent presentation, but I did not confirm which surfaces render it versus retry silently.
- `provider.getReviewForBranch` internals per forge (GitLab/Bitbucket/Azure/Gitea) were not individually audited for steps lacking their own timeout — the 120s deadline is explicitly designed as the backstop for exactly that, which is consistent, but it means the "individually bounded" premise in the pacing comment is only verified here for the GitHub and relay paths.
