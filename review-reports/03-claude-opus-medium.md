# Review — `fix-p2-c2-worktree-scan` vs `origin/main`

Reviewer: Claude Code (Opus, medium effort). Review-only; no product source modified.

## Summary

The branch does what its commit messages claim at the macro level: the periodic all-repo
worktree sweep is now concurrency-capped, idle repos share a global spawn budget, and failing
repos are negative-cached. Those are real wins against crash-cluster C2.

But the implementation buys that bound with three new **global** shared resources — a process-wide
`WorktreeScanGate` (8 permits), a fleet-wide 5s sweep deadline, and a relay-side
`rpc.settled` handshake — and none of them is leak-proof. I found **three defects that can
permanently wedge the entire worktree-scan subsystem for the life of the process** (SSH settlement
never arriving; Windows `taskkill` non-zero exit; `!pid` returning a never-settling promise). I also
found that the branch **silently disables the agent-scratch 5-minute TTL that main already shipped**
for exactly the repos it was written for, and that swapping `listWorktrees` → `listWorktreesStrict`
**drops the cross-module in-flight scan dedupe** — both of which push git-exec volume back up, i.e.
partially undo the branch's own goal.

Net: the direction is right, the fan-out cap is correct, but I would not ship this as-is. Findings
1–3 are release blockers.

## Scope

- Merge base: `e1f0e7689c5346b5778c678514f8c7251ea0b04f`
- Commits reviewed: `25d8636cf5`, `c44595cee6`, `529dca3918`, `3dbad6ddaf`, `03f351a8d5`
- Files read in full or in relevant part:
  - `src/main/runtime/orca-runtime.ts` (scan cache/backoff/fleet/sweep, `withTimeoutFactory`)
  - `src/main/runtime/worktree-scan-gate.ts` (new)
  - `src/main/git/worktree.ts`, `src/main/git/runner.ts`
  - `src/main/ssh/ssh-channel-multiplexer.ts`, `src/main/providers/ssh-git-provider.ts`
  - `src/relay/dispatcher.ts`, `src/relay/git-handler.ts`,
    `src/relay/git-handler-worktree-list.ts`, `src/relay/subprocess-tree-termination.ts`
  - Supporting (unchanged) context: `src/shared/map-with-concurrency.ts`,
    `src/main/local-project-runtime-resolution.ts`, `src/main/repo-worktrees.ts`
- Tests were read for intent only; I did not execute the suite (review-only dispatch).

---

## Findings (severity-sorted)

### F1 — P0 — SSH `settled` promise can never resolve, permanently draining the scan gate

**Files:** `src/main/ssh/ssh-channel-multiplexer.ts:229-251`, `src/relay/dispatcher.ts:432-460`,
`src/main/runtime/worktree-scan-gate.ts:971-985` (`startOperation`)

`requestTracked()` creates a `settled` promise whose **only** resolver is stored in
`trackedSettlementWaiters` and fired exclusively by an inbound `rpc.settled` notification:

```ts
const settled = new Promise<void>((resolve) => {
  this.trackedSettlementWaiters.set(token, resolve)
})
```

Nothing else ever resolves it. Concretely, `trackedSettlementWaiters` is **not** touched by:

- the per-request timeout path (`ssh-channel-multiplexer.ts:210-218`),
- the `signal` abort path (`:196-207`),
- `handleResponse` error delivery (`:460-472`),
- `dispose('connection_lost' | 'shutdown')` (`:296-346`) — which explicitly walks
  `pendingRequests` and rejects them, and ignores `trackedSettlementWaiters` entirely.

Meanwhile the gate releases its permit only from `settled`:

```ts
const settled = operation.settled ?? operation.result
void settled.then(release, release)
```

**Failure scenario.** SSH connection drops (routine — see the relay reattach path) while 8 SSH
worktree scans are tracked-in-flight. `dispose('connection_lost')` rejects the 8 `result` promises;
the runtime handles those fine (`buildCurrentWorktreeScanFallback`). All 8 `settled` promises stay
pending forever. `WorktreeScanGate.active` is stuck at 8 with `limit` 8. **Every subsequent worktree
scan in the process — local repos included — now blocks in `acquire()` until its 5s acquisition
abort fires.** From that point on, `listRepoWorktreesForResolution` never runs a real scan for any
repo; every repo permanently reports `source: 'metadata-fallback'`. Only an app restart recovers.

Fewer than 8 leaks degrade the cap proportionally (7 permits, 6, …) and are invisible.

**Second, independent trigger — version skew.** `rpc.settled` is a brand-new relay-side behavior and
I found no protocol/version negotiation gating it (`grep` for `relayVersion|protocolVersion|
RELAY_PROTOCOL` in `src/main/ssh/*.ts` and `src/relay/protocol.ts` returns nothing). A desktop on
this branch talking to an SSH host still running an older relay binary sends
`__orcaSettlementToken`, the old relay ignores the unknown param, and **no `rpc.settled` is ever
sent for any request**. The gate drains to zero within the first 8 SSH scans and worktree resolution
is dead for the whole session. `startRepoWorktreesForResolution` guards on
`typeof provider.listWorktreesTracked !== 'function'`, but that only checks the *desktop-side* class
— it says nothing about the remote relay's version.

**Third trigger.** `handleRequest` returns early for unknown methods
(`dispatcher.ts:414-420`) *before* the `try/finally` that emits `rpc.settled`. Any future/renamed
tracked method leaks the same way. Also, the `finally` calls `sendFrame(client, …)` — for a client
that disconnected mid-request, the frame goes nowhere and the waiter leaks.

**Secondary:** `trackedSettlementWaiters` is an unbounded `Map` with no eviction on timeout, abort,
or dispose — a slow memory leak on top (relevant given the C1 renderer/main heap work).

**Suggested shape of fix:** resolve `settled` from a `finally` on `result` as a backstop (and clear
the waiter), plus explicit drain in `dispose()`; add a timeout on the settlement wait; and gate
`requestTracked` on a negotiated relay capability.

---

### F2 — P0 (Windows) — `terminateSpawnedCommandTreeAndWait` never resolves when `taskkill` exits non-zero

**File:** `src/main/git/runner.ts:370-400` (and the identical
`src/relay/subprocess-tree-termination.ts:30-62`)

```ts
const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], …)
killer.once('close', (code) => {
  treeKilled = code === 0     // ← never true if the pid is already gone
  finish()
})
killer.once('error', () => {
  // An unconfirmed tree remains gate-owned until runtime restart.
})
const finish = () => { if (childClosed && treeKilled) resolve() }
```

`taskkill /pid <dead pid>` exits **128** ("process not found"). `treeKilled` stays `false`,
`finish()` never resolves, and the returned promise hangs forever. The `error` handler's own comment
concedes the leak ("remains gate-owned until runtime restart") — but this isn't a rare
`taskkill`-missing case, it's the **ordinary race** where git exits between the timeout/abort firing
and `taskkill` running.

Compare the code this replaced: `killSpawnedCommandTree` (`runner.ts:320-366`) treats `code !== 0`
as `finish(true)` — fall back to `child.kill()` and **resolve**. The new function dropped that.

**Failure scenario (Windows).** A `git worktree list` on a slow repo trips the 30s
`WORKTREE_LIST_TIMEOUT_MS` at the same moment git exits. `execFileCapture`'s timeout branch calls
`terminateSpawnedCommandTreeAndWait(child)`; `taskkill` returns 128; the promise never settles;
`terminating` stays `true` forever, so **`finish(timeoutError)` is never called and
`gitExecFileAsync` never resolves or rejects.** The awaiting `listWorktreesStrict` hangs; the
`WorktreeScanGate` permit is never released; the runtime's `worktreeScanInFlight` record for that
repo is never deleted, so that repo is *also* permanently stuck (every later caller joins the dead
promise). Eight of these and the whole scan subsystem is dead — same terminal state as F1, reached
via a much more ordinary race.

Same defect in the relay copy, where it wedges the relay's `git.listWorktrees` handler, which in
turn means the `finally` never runs, which means `rpc.settled` is never sent, which triggers F1 on
the desktop. The two bugs compound.

---

### F3 — P1 — `!pid` returns a promise that never settles

**Files:** `src/main/git/runner.ts:371-374`, `src/relay/subprocess-tree-termination.ts:31-34`

```ts
const pid = child.pid
if (!pid) {
  return new Promise(() => {})
}
```

`child.pid` is `undefined` when spawn fails synchronously — `EMFILE`, `EAGAIN`, `ENOMEM`, `ENOENT`.
Those are precisely the conditions produced by the process/fd storm this branch exists to fix.

The predecessor `killSpawnedCommandTree` handled it correctly:
`if (!pid || platform !== 'win32') { child.kill(); return Promise.resolve() }`.

**Failure scenario.** Under `EMFILE`, git spawn fails and the abort/timeout path in
`execFileCapture:554-560` / `:636-643` calls `terminateSpawnedCommandTreeAndWait(child)` → hangs
forever → `finish(abortError)` never runs → the git call never settles → gate permit and runtime
in-flight record leak permanently. Also reachable in the relay via `gitWorktreeScan`'s `terminate()`
on abort (`git-handler.ts:378-386`) when `spawn` failed: that path awaits
`terminateRelaySubprocessTreeAndWait(child)` before `reject`, so the relay handler never settles →
no `rpc.settled` → F1.

The success path (`settleSpawnedCommandTreeAfterExit`) correctly returns `Promise.resolve()` for
`!pid`, which shows the intended semantics; the terminate path is inconsistent with it.

---

### F4 — P1 — The agent-scratch 5-minute TTL is now disabled for the repos it targeted

**File:** `src/main/runtime/orca-runtime.ts:30818-30831`

```ts
if (!fleet || (repo.id !== undefined && fleet.activeRepoIds.has(repo.id))) {
  return WORKTREE_SCAN_CACHE_TTL_MS       // 30s — checked FIRST
}
if (!repo.connectionId && isAgentScratchRepoRootPath(repo.path)) {
  return WORKTREE_SCAN_AGENT_SCRATCH_TTL_MS  // 5min — unreachable when active
}
```

On `main` the agent-scratch branch was unconditional. Here the "has a connected pty" check runs
first, and `resolveWorktreeScanFleet` (`:24997-25010`) populates `activeRepoIds` from **every
connected pty**:

```ts
for (const pty of this.ptysById.values()) {
  if (!pty.connected) continue
  const repoId = splitWorktreeId(pty.worktreeId)?.repoId
  if (repoId) activeRepoIds.add(repoId)
}
```

An agent-scratch worktree with a running agent *by definition* has a connected pty. So the exact
population the 5-minute TTL was introduced for (`WORKTREE_SCAN_AGENT_SCRATCH_TTL_MS`, whose own
comment says "idle agent-scratch repos dominated the measured steady-state scan fan-out") snaps back
to the eager 30s TTL. The branch header comment on that constant was even weakened from the measured
"~128 git execs/min" language to a vaguer sentence, which reads like the regression wasn't noticed.

**Impact:** on a machine running N agents, N scratch repos scan at 2 execs/min each, entirely
outside the global 60/min budget (`WORKTREE_SCAN_GLOBAL_BUDGET_PER_MIN` only applies to the
non-active branch). At 40 active agents that's 80 execs/min before any idle repo is counted — over
budget on its own.

**Related:** the budget denominator is `scannedRepoCount` (*all* scannable repos), not the count of
repos actually on the budget path, so the idle TTL is systematically too short whenever a meaningful
fraction of repos are active.

---

### F5 — P1 — Runtime scans lost cross-module in-flight dedupe (`listWorktrees` → `listWorktreesStrict`)

**Files:** `src/main/runtime/orca-runtime.ts:25325-25340`, `src/main/git/worktree.ts:700-777`

The runtime previously went `listRepoWorktrees(repo, opts)` → `listWorktrees(path, opts)`, which
collapses concurrent scans for the same repo through the module-level `inFlightWorktreeScans` map
(comment: "cold start triggers many concurrent `git worktree list` spawns per repo (expensive on
Windows, #7225)") **and** honours `bumpWorktreeScanGeneration`, which retires pre-mutation scans.

The branch calls `listWorktreesStrict` directly, which has neither. The runtime's own
`worktreeScanInFlight` map only dedupes *runtime-internal* callers. The other live consumers of
`listRepoWorktrees` — `src/main/ipc/worktrees.ts:547` (the `worktrees:list` IPC),
`src/main/memory/hydrate-local-pty-registry.ts:80`, `src/main/workspace-space-analysis.ts:789` —
can now each spawn a **second, concurrent** `git worktree list` for a repo the sweep is already
scanning.

**Failure scenario.** App cold start: `hydrate-local-pty-registry` walks every repo while the first
resolved-worktree sweep runs. Previously these shared one scan per repo; now it's two. That is a
direct, measurable regression against this branch's own stated objective, and it lands on the
exact cold-start path #7225 was filed about.

Additionally, losing the generation coupling means a runtime scan started before a worktree mutation
can now be cached (30s–5min) and served as authoritative after the mutation — a stale-listing
window that `bumpWorktreeScanGeneration` was written to close.

---

### F6 — P1 — Strict scanning turns transient and permission errors into 5-minute blindness

**Files:** `src/main/git/worktree.ts:414-437`, `:455-458`, `:615-663`; mirrored in
`src/relay/git-handler.ts:1440-1490`, `src/relay/git-handler-worktree-list.ts:43-95`

Three error-tolerance removals compound:

1. `readRepoLocation` no longer wraps its `runWithFallback` in `try { … } catch { return undefined }`.
2. `normalizeMainWorktreePath` turns a `!location` result into
   `throw new Error('Could not normalize the main worktree path for …')` instead of returning the
   un-normalized worktrees.
3. `annotatePrunableByExistence` now captures any non-`ENOENT`/`ENOTDIR` `stat` error into
   `probeError` and rethrows it after the workers drain (previously all `stat` failures except
   `ENOENT` were silently ignored).

Any one of these now fails the *whole repo scan*, which the runtime classifies via
`classifyLocalWorktreeScanFailure` → `lstat(repoPath)` succeeds → `'scan_failed'` →
`recordWorktreeScanFailure` → exponential backoff `30s → 60s → … → 5min`
(`resolveWorktreeScanRetryDelayMs`).

**Failure scenario (very plausible on macOS).** One linked worktree lives under a TCC-protected or
network-mounted directory. `stat` returns `EPERM`/`EACCES`/`EIO` — not `ENOENT`. Previously: that
worktree was left un-annotated and the other 30 worktrees listed fine. Now: the entire repo scan
throws, the repo enters escalating backoff, and within four failures it is scanned **once every 5
minutes** and reports `metadata-fallback` in between. A single unreachable path takes out a whole
repo's live worktree data. (This codebase has prior art for exactly this class — the RC-update TCC
`EPERM` incident.)

The relay copy has the same shape and additionally has no `ENOTDIR`-vs-`EPERM` distinction for the
`normalizeMainWorktreePath` throw.

Note also #2 makes the failure *unconditional on Git version*: `--path-format=absolute` is Git 2.31+,
and while there is a fallback, a transient `rev-parse` failure (index lock, EAGAIN, EINTR) now
escalates to five minutes of blindness where before it was a no-op.

---

### F7 — P1 — Fleet-wide 5s deadline + shared gate starves late repos and explicit user refreshes

**File:** `src/main/runtime/orca-runtime.ts:24801-24818`, `:24855-24866`, `:17569-17578`

```ts
const sweepDeadline = Date.now() + RESOLVED_WORKTREE_REPO_TIMEOUT_MS   // one 5s budget, fleet-wide
const acquisition = new AbortController()
const abortTimer = setTimeout(() => acquisition.abort(), RESOLVED_WORKTREE_REPO_TIMEOUT_MS)
…
Math.max(0, sweepDeadline - Date.now())
```

The per-repo 5s timeout became a single 5s budget for the *entire* sweep. On `main` each repo got its
own 5s. (I understand from the branch history that "fleet deadline stays fleet-wide" was a deliberate
call; I'm flagging the consequences, not relitigating the choice.)

Consequences I'd want confirmed before shipping:

- **Gate permits outlive the deadline.** The sweep's `withTimeoutFactory` resolves at the deadline,
  but the underlying git call keeps its permit until it *actually* settles — up to
  `WORKTREE_LIST_TIMEOUT_MS` (30s), or forever under F2/F3. So a sweep can abandon 8 scans, return,
  and the next sweep 1s later finds the gate fully occupied by the previous sweep's zombies. The
  cursor rotation (`worktreeScanSweepCursor`, advancing by exactly 8) then means each subsequent
  sweep touches a *different* 8 repos and abandons those too — on a slow install, no repo ever
  completes a scan.
- **Explicit user scans queue behind the sweep.** `resolveWorktreesForRepo:17569` shares the same
  global gate. A user-triggered refresh can spend its whole 5s in `acquire()`, get its acquisition
  aborted, and return `buildCurrentWorktreeScanFallback` — a refresh that spawned no git at all. And
  because the explicit path deliberately passes no `sweepFleet`, no backoff is recorded, so it will
  do the same thing on every retry. From the user's perspective: "refresh does nothing."
- **Aborted acquisitions record no failure.** The rejection path
  (`tracked.result.then(ok, () => this.buildCurrentWorktreeScanFallback(repo))`) never sets
  `record.completedResult`, so `recordInFlightWorktreeScanFailure` short-circuits. A repo that
  *always* loses the acquisition race is retried at full sweep frequency forever with zero
  successful scans and zero backoff — a hot loop of enqueue/abort.
- **Cross-caller cancellation.** If caller A (single-repo, 5s abort) starts the scan and caller B
  (sweep) joins via `inFlight.promise`, A's `acquisition.abort()` kills the acquisition for both,
  even though B's deadline hadn't expired.

---

### F8 — P2 — Signalling a PGID whose leader has already exited (PID-reuse hazard)

**Files:** `src/main/git/runner.ts:479-492`, `src/relay/subprocess-tree-termination.ts:127-140`

```ts
export function settleRelaySubprocessTreeAfterExit(child) {
  const pid = child.pid
  try { process.kill(-pid, 0) } catch (e) { if (e.code === 'ESRCH') return Promise.resolve() }
  return terminateRelaySubprocessTreeAndWait(child, true)   // → kill(-pid, SIGTERM), then SIGKILL
}
```

This runs on the **normal success path** of every `settleProcessTree` git exec, *after* the leader
has exited and Node has reaped it. Once reaped, `pid` is free for reuse. If the OS hands it to a new
process that becomes a group leader (any `setsid`/`detached` spawn — including Orca's own PTY and
git spawns, which this branch just made `detached`), `-pid` now names an **unrelated process group**,
and we SIGTERM then SIGKILL it. On a machine spawning hundreds of processes per minute — which is the
described steady state here — this is not hypothetical.

Same hazard in `terminateSpawnedCommandTreeAndWait(child, leaderAlreadyClosed = true)`.

The safe pattern is to capture group membership before the leader exits, or to only signal while the
leader is confirmed alive.

---

### F9 — P2 — Backed-off / deleted repos serve stale worktrees indefinitely

**File:** `src/main/runtime/orca-runtime.ts:25040-25055`, `:25076-25084`

`buildBackedOffWorktreeScanResult` returns `cached.worktrees` with **no freshness check at all** —
`scannedAt` is ignored. The cache is only ever overwritten on a *successful* scan
(`finalizeRepoWorktreeScan`). So for a repo whose directory was deleted:

1. First failure → `missing_repo_path` → 5-minute backoff.
2. Every subsequent sweep returns the last-successful worktree list, forever.
3. Retries every 5 minutes keep failing, so the cache is never refreshed or cleared.

**Failure scenario.** A user deletes a repo directory outside Orca. Its worktrees never disappear
from the workspace list — not after 5 minutes, not after an hour, not until the repo is unregistered
or the app restarts. The `console.warn` is the only signal, and the commit message's claimed
user-facing surface for this does not exist (see F17).

`withStaleWorktreeScanFallback` applies the same "prefer stale over empty" rule to live failures,
which is defensible for a transient error but not when paired with an unbounded backoff.

---

### F10 — P2 — `detached: true` orphans git processes when Orca/relay dies

**Files:** `src/main/git/runner.ts:569-576`, `src/relay/git-handler.ts:357-363`

`detached: process.platform !== 'win32'` puts each worktree-scan git into its own process group.
That's required for `kill(-pid, …)`, but it also removes the child from Orca's process group, so a
`SIGKILL`/crash of the main process or the relay daemon leaves git processes running with no
supervisor. Given this branch is motivated by crash clusters, "the app crashes and leaks git
processes" is a realistic tail. Worth an explicit reap-on-exit sweep, or at minimum a note.

Also note the group-signal semantics change: a `SIGINT` delivered to Orca's group no longer reaches
these git children.

---

### F11 — P2 — Unbounded 25ms poll with no cap

**Files:** `src/main/git/runner.ts:432-442`, `src/relay/subprocess-tree-termination.ts:88-98`

After `SIGKILL`, `poll()` re-arms `setTimeout(poll, 25)` with **no iteration or wall-clock cap**. A
process group member stuck in uninterruptible `D` state (NFS/SSHFS/SMB stall — realistic given the
SSH use case) polls every 25ms indefinitely and holds its gate permit for the process lifetime. The
timers are `unref()`'d so they don't block exit, but they do burn a syscall 40×/second per stuck
tree, and the permit leak reproduces F1's terminal state.

---

### F12 — P2 — Authority is now inferred from cache-state matching, producing spurious `metadata-fallback`

**File:** `src/main/runtime/orca-runtime.ts:24933-24950`, `:17588-17605`

`resolveWorktreesForRepo` no longer reports `authoritative: scan.ok`; it reports whatever
`pruneLineageForAuthoritativeWorktreeScan` returns, which additionally requires:

```ts
current.authority === scan.authority &&
current.generation === identity.generation &&
current.runtimeKey === identity.runtimeKey &&
Date.now() - current.scannedAt <= WORKTREE_SCAN_CACHE_TTL_MS
```

Two ways a *successful* scan is reported as non-authoritative:

- **Generation race.** `updateRepo` now bumps the scan generation on `'kind' in updates` as well as
  `worktreeBasePath` (`:15856`). A repo edit landing between the scan and the prune check invalidates
  the cache → `authoritative: false`.
- **30s boundary.** A cache hit at 29.9s passes the TTL check in `listRepoWorktreesForResolution` but
  can fail the `> 30_000` check microseconds later in the prune.

The blast radius is bounded because `applyMetadataFallbackVisibility` fails *open* (`visible: true`,
ownership downgraded to `'unknown-legacy'`), so nothing disappears — but ownership flips to
`unknown-legacy` and back, which is user-visible churn in the workspace list and could confuse
ownership-dependent logic downstream. Worth a targeted test.

---

### F13 — P2 — The runtime's local scan path never passes a signal, so the new abort plumbing is dead there

**Files:** `src/main/runtime/orca-runtime.ts:25330-25336`, `src/main/git/worktree.ts:620-663`, `:815-846`

The runtime builds `const scanOptions = { ...options, settleProcessTree: true }` from
`getLocalProjectWorktreeGitOptionsForRuntime`, which carries no `signal`. So the new
`options.signal?.aborted` checks and `throwIfWorktreeScanAborted` in `annotatePrunableByExistence` /
`annotateSparseCheckoutStatus` are **unreachable from the runtime sweep** — the path the branch is
about. `acquisitionSignal` only cancels *gate acquisition*, never a running scan.

Practical consequence: once a scan starts, its filesystem probe phases (`stat` per worktree, sparse
detection per worktree) are unbounded and uncancellable, and hold a gate permit. `git worktree list`
itself is bounded at 30s (`readWorktreeList` sets `timeout ?? WORKTREE_LIST_TIMEOUT_MS`), but the
`stat` fan-out afterwards is not. A hung network mount pins a permit indefinitely. The relay path
does thread `context.signal`, so the asymmetry looks unintentional.

---

### F14 — P2 — Folder workspaces are now throttled behind git scans

**File:** `src/main/runtime/orca-runtime.ts:24818-24838`

`sweepOrder` appends all folder repos **last**, then runs everything through
`mapWithConcurrency(…, 8, …)`. Folder repos resolve purely in memory
(`listRuntimeFolderWorkspaces`) and previously resolved instantly under `Promise.all`. Now they wait
for a permit behind up to 8 slow git scans. They still resolve correctly, but a folder-workspace-only
user pays git-scan latency for data that requires no git at all. Cheap fix: partition folder repos out
of the concurrency-limited map entirely.

---

### F15 — P2 — Redundant per-sweep work

**File:** `src/main/runtime/orca-runtime.ts:24806`, `:24885-24888`, `:24997-25010`

- `resolveLocalProjectRuntimesForRepos(this.requireStore(), repos)` is called **twice** per sweep
  (once up front, once as `currentProjectRuntimeByRepoId` after the map). Each call iterates all
  projects and calls `store.getSettings()`.
- `resolveWorktreeScanFleet` iterates **every** entry in `this.ptysById` on every sweep. The sweep
  can fire as often as every `RESOLVED_WORKTREE_CACHE_TTL_MS` (1s).
- `buildCurrentWorktreeScanFallback` → `resolveWorktreeScanIdentity(repo)` with **no** runtime map,
  so it does a fresh `store.getProjects().find(…)` + `resolveLocalProjectRuntime` per fallback. It is
  the timeout fallback for every repo in the sweep, so under load that's one such resolution per repo
  per sweep.

Individually small, but this is main-process synchronous work on a 1Hz path, in a branch whose thesis
is main-process cost.

*(I verified that the batch and singular resolvers produce identical `runtimeKey`s for the same repo —
same project-iteration order, same local-host filter — so the eviction in
`evictMismatchedWorktreeScanState` will not spuriously nuke a valid cache. Good.)*

---

### F16 — P2 — `worktreeScanBackoff` has no removal-time cleanup

**File:** `src/main/runtime/orca-runtime.ts:2578`, `:25391-25406`

`worktreeScanBackoff` is cleared alongside cache/in-flight on generation bump and SSH invalidation,
but I found no path that drops entries when a repo is **removed** from the store. Same lifetime gap as
the pre-existing `worktreeScanCache`, so it's not a new class of leak — but it's a new map, and given
the C1 heap work it's worth a `deleteRepo` hook.

---

### F17 — P3 — Commit message asserts a surface that does not exist

Commit `25d8636cf5` states: *"a missing repo directory backs off to 5min and is surfaced (log +
`listReposMissingOnDisk`)"*. `grep -rn "listReposMissingOnDisk" src/` returns **nothing**. The only
surfacing is `console.warn` in `recordWorktreeScanFailure` (`orca-runtime.ts:25101-25105`). Combined
with F9 (stale worktrees served forever), the "missing repo" state has no user-facing signal at all.
Either implement it or correct the message before merge.

---

### F18 — P3 — `Promise.allSettled` silently swallows sparse-checkout probe failures

**File:** `src/main/git/worktree.ts:838-846`

`annotateSparseCheckoutStatus` changed `Promise.all` → `Promise.allSettled`. An error in one worker
now aborts that worker's slice of the queue, leaving an arbitrary subset of worktrees un-annotated,
and the function returns **success**. Sparse-checkout status is then silently wrong for those
worktrees, with no log. The change was presumably made so a probe error can't defeat
`throwIfWorktreeScanAborted`, but it also discards genuine errors. Suggest `allSettled` + inspect
rejections, or catch inside `detectNext`.

---

## Performance regressions (rollup)

| # | Regression | Direction vs. branch goal |
|---|---|---|
| F4 | Agent-scratch 5-min TTL neutralised by the `activeRepoIds` precedence | **Undoes a shipped `main` optimisation** for the dominant population |
| F5 | Lost `inFlightWorktreeScans` cross-module dedupe (`listWorktrees` → `listWorktreesStrict`) | Up to 2× git execs per repo on cold start (#7225 path) |
| F7 | Gate permits outlive the fleet deadline → abandoned-but-occupying scans; hot enqueue/abort loop with no backoff | Wasted spawns, no forward progress |
| F14 | Folder workspaces serialised behind git scans | Latency added where zero I/O is needed |
| F15 | Duplicate `resolveLocalProjectRuntimesForRepos`; full `ptysById` walk; per-fallback project resolution — all on a 1Hz path | New main-process CPU |
| F11 | Unbounded 25ms poll per stuck tree | 40 syscalls/s/tree, indefinitely |
| F13 | Post-`git` `stat` fan-out is unbounded and uncancellable while holding a permit | Head-of-line blocking |
| — | Every `settleProcessTree` exec adds a `kill(-pid, 0)` probe | Negligible; noted for completeness |

Genuine wins, for balance: the 8-way cap on the sweep is correct and does eliminate the measured
82-concurrent spike; the idle-repo global budget is the right *shape*; negative-caching a missing
repo directory is right.

## Functionality regressions (rollup)

- **F1 / F2 / F3** — three independent paths to a permanently saturated `WorktreeScanGate`, after
  which *no* repo (local or SSH) is ever scanned again and everything reports `metadata-fallback`
  until restart. F2 additionally hangs `gitExecFileAsync` outright.
- **F6** — a single `EPERM`/`EACCES`/`EIO` worktree path, or one transient `rev-parse` failure, now
  fails the whole repo scan and escalates it into 5-minute backoff.
- **F9** — deleted repos keep showing their worktrees indefinitely.
- **F7** — explicit user-triggered refresh can silently perform no scan at all; one caller's timeout
  cancels another caller's joined scan.
- **F12** — successful scans intermittently reported as `metadata-fallback`, flipping ownership to
  `unknown-legacy`.
- **F8** — signals sent to a possibly-reused PGID; worst case, killing an unrelated process group.
- **F10** — orphaned `git` processes after an Orca or relay crash.
- **F5 (second half)** — loss of `bumpWorktreeScanGeneration` coupling reopens a
  stale-listing-after-mutation window of 30s–5min.
- **F18** — silently incorrect sparse-checkout annotation.

**Cross-platform coverage of the findings:** F2 is Windows-specific and severe. F3/F8/F10/F11 are
POSIX (macOS + Linux + SSH hosts). F1 is SSH-specific and also the version-skew case. F6 is
most likely on macOS (TCC) and on SSH/network mounts. F13's WSL note: `classifyLocalWorktreeScanFailure`
correctly refuses to `lstat` a WSL path and returns `'scan_failed'` — that's right, though it means a
deleted WSL repo directory never gets the cheap 5-minute backoff and stays on the escalating path.
Folder workspaces are handled (F14 is latency, not correctness).

## Residual risks / open questions

1. **Relay version negotiation.** Does Orca guarantee the remote relay binary matches the desktop
   build (auto-deploy/upgrade on connect)? If not, F1's skew trigger is a shipping blocker on its own.
   I could not find a version gate; this is the single question I'd most want answered.
2. **Was the fleet-wide deadline (F7) evaluated against a 100+ repo install?** The interaction between
   a 5s fleet budget, permits held for up to 30s, and an 8-repo-per-sweep cursor advance looks like it
   could produce a no-forward-progress steady state, but I did not simulate it.
3. **F4** — is the `activeRepoIds`-before-agent-scratch ordering deliberate (i.e. "an agent is running,
   so we want fresh data")? If so it needs a comment and an acknowledgement that the C2 headline number
   won't move on agent-heavy machines. If not, swap the two branches.
4. I did **not** run the test suite. The branch adds ~1,600 lines of tests; I read them for intent only.
   None of F1–F3 appears to be covered — the tests exercise the happy settlement path
   (`dispatcher.test.ts` "notifies the client only after a tracked request settles") but not
   disconnect/timeout/old-relay, and not `taskkill` non-zero or `!pid`.
5. I did not measure anything. All performance claims here are read from the code and the diff, not
   from a profile.
6. `data: undefined` is passed to `sendResponse`'s error object when a thrown error has no `data`
   (`dispatcher.ts:452`); `JSON.stringify` drops the key, so this is benign — noted so a later reader
   doesn't re-flag it.

## Confidence

- **F1, F2, F3** — high. Each is a direct read of a control-flow path with an identifiable trigger,
  and in each case the predecessor code handled the case correctly, so the regression is visible in
  the diff itself.
- **F4, F5, F17** — high. Straightforward code/`grep` facts.
- **F6, F7, F9, F13, F14, F15** — medium-high. The mechanism is clear; the *frequency* of the
  triggering conditions is inferred rather than measured.
- **F8, F10, F11, F12, F16, F18** — medium. Real but tail-probability or bounded-blast-radius; F12 in
  particular I'd want a test to confirm the race window is reachable in practice.
- Overall coverage: I read every non-test hunk in the diff. I did not execute tests, did not profile,
  and did not exercise a live SSH/WSL/Windows host — so platform-specific claims (F2 especially) are
  code-derived.
