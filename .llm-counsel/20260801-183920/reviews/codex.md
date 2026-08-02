# Review — codex

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
