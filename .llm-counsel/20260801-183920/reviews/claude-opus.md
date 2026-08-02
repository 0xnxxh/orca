# Review — claude-opus

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
```

`readLocalGitConfigSignature` returns early only for `connectionId || wslDistro` (`local-git-config-signature.ts:16-20`). On the **native local** path — the exact path the commit message names ("a dead network mount") — it runs `stat` and `readFile` against the repo path with no timeout. `fs.stat` on a hung NFS/SMB mount blocks in the libuv threadpool indefinitely, and there is no way to cancel it; the default 4-slot threadpool means a few wedged repos also stall unrelated fs/dns/crypto work in main.

`localGitConfigSignatureInFlight` (line 22-35) has the same permanent-coalescing shape as F2, so once one call wedges, every subsequent `getOwnerRepoForRemote` for that repo joins it forever.

**Net:** for the dead-network-mount scenario in the commit message, the process wedges at line 159 and never reaches the bound added at line 116.

---

### F5 — Medium — a post-deadline straggler resets the escalation

**File:** `src/main/source-control/hosted-review-branch-cache.ts:339-343`

```ts
if (generation === scopeGeneration(scope) && !(timedOut && answeredSince(key, startedAt))) {
  storeEntry(key, { review, fetchedAt: Date.now(), headOid })
  // A late answer proves the provider recovered, so stop backing off.
  clearFailures(key)
}
```

The comment is wrong on its own terms. By this file's own definition (`hosted-review-refresh-pacing.ts:33-37`), a lookup that outlives 120s "is wedged on something that has no timeout of its own, not merely slow". An answer arriving at t=200s therefore does not prove recovery — but it clears the counter anyway. The escalation can never advance past the base window on a chronically slow host. That is exactly the failure mode `hosted-review-lookup-backoff.ts:19-20` was written to prevent: *"a lapsed window keeps its failure count, otherwise the very act of retrying resets the escalation and the backoff never grows past the base."*

**Measured** (harness below, fake timers, one branch, 2 hours of 10s polls, lookup always resolves at startedAt+200s):

```
provider calls in 2h = 36    peak concurrent detached lookups = 2
```

36 calls = one every 200s, backoff pinned at the 60s base. With the escalation reaching its 15-minute cap the same window would cost ~8. Baseline (pre-branch, where all callers join one 200s in-flight lookup and then hold it for the 60s found-review TTL) is ~27. So this is both ~4.5× the intended paced rate and ~33% above the pre-branch rate, on the exact quota the cache exists to protect (`hosted-review-branch-cache.ts:21-24`).

---

### F6 — Medium — detached lookups are unbounded and unaccounted

**File:** `src/main/source-control/hosted-review-branch-cache.ts:307-309`, `216-227`

`expire()` calls `releaseInflight(key, token)`, which **deletes the record from `inflight`**. The underlying `lookup()` keeps running with no cancellation (there is none to have — the comment at line 264-265 says so). After the backoff lapses, a new lookup starts for the same key while the detached one is still live. Nothing counts detached lookups.

`MAX_INFLIGHT_LOOKUPS` is therefore not the backstop its comment claims (`hosted-review-refresh-pacing.ts:47-52`, *"a memory backstop"*): it bounds only the records still in the map, i.e. the ones that have **not** leaked.

**Measured** (harness below, one branch, 8 hours of 10s polls, lookup never settles):

```
never-settling lookups leaked over 8h = 31
```

Pre-branch the same scenario leaks exactly **1** (the in-flight map pinned it and no new lookup could start). At 31 per branch per 8h × a 50-worktree list that is ~1,550 retained closures, each holding the `identity` strings and whatever the wedged call itself holds (child-process handles, sockets). Memory cost per record is small; the concern is that it is unbounded and invisible to the cap that claims to bound it.

Note this interacts with F2: on the GitLab path the retries coalesce onto one dead promise, so no new subprocess is spawned — the leak is promises/closures. On the (now-bounded) GitHub path each retry does spawn and kill a real child.

**Harness used for F5/F6** (written to a scratch test file, run, then deleted — no production or test files were modified):

```ts
it('A: 200s host never escalates past the base window', async () => {
  let live = 0, peakLive = 0, started = 0
  const lookup = vi.fn(() => { started++; live++; peakLive = Math.max(peakLive, live)
    return new Promise<HostedReviewInfo | null>((resolve) => {
      setTimeout(() => { live--; resolve(openReview) }, 200_000) }) })
  for (let step = 0; step < 720; step++) {
    void withHostedReviewBranchCache(identity, { headOid: null }, lookup).catch(() => {})
    await vi.advanceTimersByTimeAsync(10_000)
  }
  // started = 36, peakLive = 2
})

it('B: wedged host accumulates unsettled lookups', async () => {
  let started = 0
  const lookup = vi.fn(() => { started++; return new Promise<HostedReviewInfo | null>(() => {}) })
  for (let step = 0; step < 2880; step++) {
    void withHostedReviewBranchCache(identity, { headOid: null }, lookup).catch(() => {})
    await vi.advanceTimersByTimeAsync(10_000)
  }
  // started = 31
})
```

---

### F7 — Medium — the 120s deadline is below the sum of the bounds it wraps

**File:** `src/main/source-control/hosted-review-refresh-pacing.ts:32-38`

The docblock concedes the steps "chain", then picks a deadline smaller than their sum. Bounded sub-steps on one cold-cache `hostedReview:forBranch` for a non-GitLab repo:

| Step | Bound | Source |
|---|---|---|
| `glab auth status` | 10s | `gitlab-known-host-probe.ts:9` |
| GitLab `remote get-url` | **unbounded** | `gitlab-project-ref-resolution.ts:92` (F1) |
| `readLocalGitConfigSignature` | **unbounded** | `local-git-config-signature.ts:202` (F4) |
| GitHub `remote get-url` | 30s | new, `github-repository-identity.ts:116` |
| `ssh -G` alias probe | 2.5s | `git/runner.ts:672` |
| `gh` PR lookup | 30s | `DEFAULT_GH_EXEC_TIMEOUT_MS`, `git/runner.ts:1265` |
| bitbucket / azure / gitea probes | unbounded ×3 | see F1 |

Ignoring the unbounded ones, the bounded steps alone reach 72.5s; add the SSH/relay round-trips (AGENTS.md: "All changes must consider the SSH use case" — each of these crosses the relay mux) and a cold-cache lookup on a high-latency link can exceed 120s while **every individual step is behaving within its own bound**.

**Failure scenario.** A healthy but slow SSH host on the first poll after connect: the deadline fires, the user gets `Hosted review lookup timed out after 120s`, and the branch takes a 60s backoff. On the next poll it re-fails the same way (F5's `clearFailures` only helps if the straggler lands). This is a new user-visible error on a path that previously just took a while.

---

### F8 — Low — cross-key O(inflight) sweep on every call

**File:** `src/main/source-control/hosted-review-branch-cache.ts:206-218, 387`

`expireOverdueInflight(Date.now())` runs unconditionally at the top of every `withHostedReviewBranchCache` call and walks the whole `inflight` map. On the worktree-list path — O(N) branches per poll cycle, per client, and the file's own docblock says every desktop window, the mobile client and `orca serve` all funnel here — that is N × |inflight| iterations per cycle. In practice `inflight` stays small, so this is a real but minor cost.

Second-order: the sweep expires records for **other** keys, so a poll for branch A can `noteFailure(B)` on A's stack. B's own caller does still get its rejection, so this is accounting noise rather than a lost answer — but the backoff for B is now driven by A's poll cadence rather than B's.

---

### F9 — Low — WSL timeout kills `wsl.exe`, not the git inside the distro

**File:** `src/main/git/runner.ts:481-497`

The new `timeout` arms `killSpawnedCommandTree(child)` where `child` is `wsl.exe -d <distro> -- bash -c "cd … && git …"` (`runner.ts:246-254`). Windows process-tree kill reaches `wsl.exe` and its Windows children; the Linux-side `bash`/`git` inside the distro are not Windows processes and survive. Given the retry cadence (one per deadline+backoff, per branch), a genuinely wedged WSL interop accumulates orphan git processes inside the distro. The caller is correctly unblocked, so this is a hygiene issue, not a correctness one — but "bound the WSL path" is weaker than the commit message implies.

---

### F10 — Low — `answeredSince` millisecond collision

**File:** `src/main/source-control/hosted-review-branch-cache.ts:264-268`

```ts
return current !== undefined && current.fetchedAt >= startedAt
```

`startedAt` and `fetchedAt` are both `Date.now()` (ms). If a prior lookup stored an entry in the same millisecond this lookup started, a legitimate post-deadline straggler is discarded as "already answered". Requires a same-ms coincidence, so the practical impact is one wasted answer. `>` would be the correct comparison for "strictly newer than me".

---

### F11 — Low — `unref()`ed timer and sweep-only-on-call

**File:** `src/main/source-control/hosted-review-branch-cache.ts:324-326, 387`

The deadline timer is `unref()`ed, and `expireOverdueInflight` only runs when a *new* `withHostedReviewBranchCache` call arrives. In the Electron main process both are fine (the loop is always alive, and polling is continuous). In `orca serve`/CLI contexts where hosted-review is asked once and the loop would otherwise drain, an unref'd timer cannot keep the process alive to fire the deadline, and no later call exists to trigger the sweep — the caller's promise never settles. I could not construct a concrete `orca serve` shutdown sequence that hits this, so treat it as a hypothesis rather than a confirmed defect.

---

## Performance surface

**What the branch does well.** The `token`-identity release (`releaseInflight`, line 190-196) is the right primitive and correctly prevents a straggler from evicting its own replacement — the test at line 512 proves it. The wall-clock sweep is the right instinct for main-process timers across a system sleep, and the pre-run `trackInflight` (line 328-330) correctly handles a synchronously-throwing lookup. Splitting the backoff into its own module is a clean separation with no behaviour drift (the moved functions are byte-identical apart from `MAX_ENTRIES` → `MAX_BACKOFF_ENTRIES`, both 500).

**Net quota effect.** Against the stated goal ("the host's API quota is per user, so the only place that can pace them together is here"), the branch is a regression in two measured regimes:

| Regime | Pre-branch calls | Post-branch calls | Driver |
|---|---|---|---|
| Host answers in 200s, 2h window | ~27 | **36** (2 concurrent) | F5 — escalation reset by straggler |
| Host wedged, 8h window | 1 (pinned) | **31** leaked lookups | F6 — no detached accounting |

The wedged-host row is the intended trade (a pinned UI is worse than 31 leaked promises), but it should be an explicit, capped trade rather than an unbounded one — and the comment on `MAX_INFLIGHT_LOOKUPS` currently asserts a bound that does not exist.

**Hot-path cost added:** one `Date.now()` + one Map walk per `withHostedReviewBranchCache` call (F8); one `setTimeout` + `unref` + closure allocation per lookup start. Both negligible relative to a provider call.

**Not affected:** no renderer, stream, PTY, or listener surface is touched by this diff. Nothing here runs on a render or scroll path.

## Functionality / regression surface

- **Host identity:** correct. `repoScope` (line 84-86) keys on `connectionId` + `repoPath`; the SSH/local separation test at line 296 passes. `github-repository-identity.ts:136-139` correctly scopes the owner/repo cache by SSH generation and WSL distro. The new timeout does not cross host boundaries — the SSH branch (`getRemoteUrlForRepo:107-113`) is untouched, and the comment's claim that the relay mux bounds it at 30s is plausible but I did not verify it end to end (see residual risks).
- **Deadline cancel races:** I could not break the token/generation logic. The `timedOut`/`completed` guards are correct, `expire()` is idempotent, and there is no `await` between `expireOverdueInflight` and `startLookup` in `withHostedReviewBranchCache` (lines 383-421), so two lookups cannot race into `trackInflight` for the same key.
- **False cache hits/misses:** F3 is the one that matters — a definitive `null` cached from a swallowed timeout. F10 is a benign false miss.
- **WSL/SSH/local differences:** F4 (config-signature `stat`) affects **native local only**; F1/F2 affect local and WSL; F9 is WSL-specific; F7 bites hardest on SSH. The diff's WSL handling itself is correct — `timeout` is threaded through `resolveCommand` unchanged.
- **Silent swallows:** F3 is the significant one. Also note `startLookup`'s `catch` returns without logging when `timedOut` (line 348-350) — a late provider rejection on a wedged host disappears entirely, so the only diagnostic left for F2's permanent-wedge state is the repeating "timed out" error card.
- **Provider compatibility (AGENTS.md):** the fix is GitHub-only. GitLab, Bitbucket, Azure DevOps and Gitea all keep the unbounded `remote get-url` (F1), and GitLab is the one that runs *first* for every repo.

## Residual risks / what I could not verify

1. **The SSH relay 30s bound.** `github-repository-identity.ts:96` asserts "the SSH branch, which the relay mux already bounds at 30s". I read `ssh-git-dispatch.ts` (a plain registry — no bound there) but did not trace `SshGitProvider.exec` through the relay mux to confirm the 30s figure. If that bound does not exist, the SSH path has the same unbounded hang the local path was just fixed for.
2. **Real wedged-host behaviour.** F1/F2/F4 are proven by code reading and call-graph tracing, not by an actual dead mount. I did not have a wedgeable NFS/SMB mount or a stalled WSL distro available. The chain (`FORGE_PROVIDERS[0]` → `getProjectSlug` → unbounded `gitExecFileAsync`; `runProjectRefProbeOnce`'s settle-only cleanup) is unambiguous in the source, but the end-to-end repro is untested.
3. **F3's user-visible reach.** I confirmed the code chain (timeout → `null` → cached negative → `reviewLookupOutcome: 'not_found'`) by reading `hosted-review.ts:71-73`, `hosted-review-branch-cache.ts:339-343` and `hosted-review-creation.ts:493-522`. I did not drive the UI to confirm the Create button actually enables in that state — `detectHostedReviewProvider` also returns `'unsupported'` during the stall, which may block the button by a different route for the duration of the stall. The 15-minute cached negative outlives the stall, though, so the window where the cache says "no review" and the provider resolves normally is real.
4. **F11** is a hypothesis; I did not find a concrete `orca serve` shutdown path that reaches it.
5. I ran only the two test files this branch touches (64 passed). I did not run the broader main-process suite, a typecheck, or `oxfmt --check`, so I cannot speak to breakage outside this diff.
