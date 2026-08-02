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
