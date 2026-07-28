# Review: `fix-p2-c2-worktree-scan` vs merge-base `e1f0e7689c`

Reviewer: Claude Code (Fable, medium effort). Review-only pass over the full diff (21 files, +2886/−268), focused on runtime worktree-scan performance and functionality.

## Summary

The branch replaces the unbounded per-repo worktree-scan fan-out with a global 8-slot `WorktreeScanGate`, a fleet-budgeted TTL, per-repo failure backoff, tree-settling subprocess termination, and an SSH "settlement" protocol (`__orcaSettlementToken` / `rpc.settled`) so a gate slot is not released until the remote git process is actually gone. The core design is sound and directly addresses the crash-cluster C2 spawn storm.

The main risk introduced by this design is that **the gate is a single global resource whose slots are released only by settlement, and there are several paths where settlement never happens**. Each such path permanently leaks a slot; after 8 leaks, worktree scanning is dead machine-wide (all repos, local and SSH) until app restart, with everything degrading to metadata fallback. I found one confirmed leak path (mux disposal), one confirmed hang bug (`hasSpawnedCommandExited` misclassifies signal-exits), and several conditional ones (old-relay skew, hung remote git, Windows kill-confirmation race). The strictness changes (throwing where code previously degraded to `[]` / unnormalized lists) also widen the blast radius of single-worktree filesystem errors to whole-repo scan failure, and propagate errors to previously-shielded callers outside the scan path.

## Scope

- Commits: `25d8636cf5` … `03f351a8d5` (5 commits).
- Files reviewed in depth: `src/main/runtime/orca-runtime.ts`, `src/main/runtime/worktree-scan-gate.ts`, `src/main/git/runner.ts`, `src/main/git/worktree.ts`, `src/main/providers/ssh-git-provider.ts`, `src/main/ssh/ssh-channel-multiplexer.ts`, `src/relay/git-handler.ts`, `src/relay/git-handler-worktree-list.ts`, `src/relay/dispatcher.ts`, `src/relay/subprocess-tree-termination.ts`.
- Cross-checked non-diff context: `dispose()` in the multiplexer, `mapWithConcurrency`, `resolveLocalProjectRuntimesForRepos`, and all `provider.listWorktrees(` call sites in `src/main`.
- Not run: tests, gates (review-only task).

## Findings (severity-sorted)

### F1 (P0) — Mux disposal leaks settlement waiters → permanent global gate-slot leak on SSH disconnect

`src/main/ssh/ssh-channel-multiplexer.ts`

`requestTracked()` registers a resolver in `trackedSettlementWaiters` (line ~244) that is resolved only by an incoming `rpc.settled` notification (line ~481). `dispose()` (line ~296) rejects every entry in `pendingRequests` but **never touches `trackedSettlementWaiters`**. On connection loss (`dispose('connection_lost')` — including laptop sleep/wake, which Orca handles routinely) any in-flight `git.listWorktrees` tracked request has its `result` rejected but its `settled` promise pending forever.

Call chain: `OrcaRuntimeService.listRepoWorktreesForResolution` → `worktreeScanGate.runTracked(...)` → `startRepoWorktreesForResolution` → `provider.listWorktreesTracked` → `mux.requestTracked`. In `WorktreeScanGate.startOperation`, the release is bound to `operation.settled` — so the slot is **never released**.

Consequences per occurrence:
- One of 8 global gate slots leaks for the lifetime of the process. The gate serves *all* repos (local included). Eight disconnect events with an in-flight SSH scan ⇒ every future scan queues, aborts at the 5 s acquisition deadline, and returns metadata fallback forever. Silent, unrecoverable without restart.
- The `worktreeScanInFlight` record is also pinned (its cleanup awaits `Promise.allSettled([promise, settled])`), so that repo stops rescanning until its `runtimeKey` changes (provider-generation bump on reconnect rescues the record, but not the slot).

Failure scenario: user with one SSH repo sleeps the laptop while the ~every-30 s sweep has a scan in flight. Repeat 8 times over days ⇒ worktree list on every repo goes stale/metadata-fallback permanently.

Fix direction: on `dispose()`, resolve (not reject) all `trackedSettlementWaiters` — the process tree on a lost connection is untrackable anyway, and resolving matches the `disposed` fast-path in `requestTracked` that returns `settled: Promise.resolve()`.

### F2 (P1) — `hasSpawnedCommandExited` misclassifies signal-killed children → maxBuffer settle path hangs forever

`src/main/git/runner.ts` (~line 313) and the twin `hasRelaySubprocessExited` in `src/relay/subprocess-tree-termination.ts`:

```ts
return child.exitCode !== undefined
  ? child.exitCode !== null
  : child.signalCode !== undefined && child.signalCode !== null
```

`ChildProcess.exitCode` is always defined (it is `null` until exit, and *stays `null`* for a signal-killed child). So for a child that exited via signal, the first ternary branch is taken and returns `false` — the helper reports "not exited" for an exited process. The `signalCode` branch is dead code.

Exposed path: the new `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` branch in `execFileCapture` calls `terminateSpawnedCommandTreeAndWait(child)` with `leaderAlreadyClosed = false`. Node fires the execFile callback on `'close'` after SIGTERM-killing the child on maxBuffer, so at that point the child has already exited by signal and `'close'` has already fired. `leaderClosed` starts `false`, the `child.once('close')` listener never fires again, and the promise **never resolves** (the POSIX poll loop confirms the group is gone but `finish()` still requires `leaderClosed`; the Windows branch has the same structure). Result: `finish()` in `execFileCapture` never runs, the scan's `result` promise never settles, the gate slot leaks permanently, and the repo's in-flight record is pinned (every sweep returns the timeout fallback for it).

Trigger: any `settleProcessTree` git call whose output exceeds `maxBuffer`. Rare for `worktree list`, but the failure is permanent when it happens, and the helper is wrong for *every* terminate-after-close call, present or future.

Fix direction: `child.exitCode !== null || child.signalCode !== null`.

### F3 (P1) — No timeout anywhere above a hung remote git → gate slot held indefinitely

`src/relay/git-handler.ts` `gitWorktreeScan` (new) spawns git with **no timeout** (the old `this.git` path at least accepted `opts.timeout`, though `listWorktrees` didn't pass one either). The difference is what a hang now costs: `rpc.settled` is sent in the dispatcher's `finally`, i.e. only after the handler returns; the client-side `request()` timeout rejects `result` but leaves `settled` pending; `WorktreeScanGate` has no slot watchdog. A remote git wedged on `index.lock`, a dead NFS mount, or fsmonitor holds one of the 8 global slots for as long as the connection lives. Pre-branch, a hung git leaked one process but scans elsewhere were unaffected; now each hang shrinks global scan throughput, and 8 concurrent hangs (one bad remote mount can produce that across sweeps... actually the in-flight dedupe caps it at 1 per repo — but 8 bad repos suffice) wedge scanning entirely.

Fix direction: hard timeout in `gitWorktreeScan` (e.g. `WORKTREE_LIST_TIMEOUT_MS`) that runs the terminate path, and/or a generous last-resort settlement timeout on the gate slot.

### F4 (P1, conditional) — Old relay binary never sends `rpc.settled` → every tracked SSH scan leaks a slot

`requestTracked` unconditionally registers a settlement waiter and sends `__orcaSettlementToken`; only the new `RelayDispatcher` answers with `rpc.settled`. If the app can ever talk to a previous-version relay (stale deployed binary, skipped upload, downgrade), the older dispatcher ignores the token, `settled` never resolves, and **every single SSH worktree scan leaks a gate slot** — the global wedge arrives within roughly the first minute of sweeps. If the connect handshake hard-pins relay version to app version this is moot, but there is no capability negotiation in this diff (`rpc.settled` support is assumed, not probed — cf. the repo's own `GitCapabilityCache` convention for exactly this class of problem). Verify the deployment invariant; otherwise gate the tracked path on a relay capability check.

### F5 (P1→P2) — Windows kill-confirmation race: `taskkill` on an already-exited pid never resolves

`terminateSpawnedCommandTreeAndWait` (both copies): on Windows, `treeKilled` is set only when taskkill exits `0`. If the child exits naturally between the timeout/abort firing and taskkill running, taskkill exits 128 ("not found"), `treeKilled` stays false, and the promise never resolves even though `childClosed` is true — same permanent slot-leak outcome as F2. The comment ("An unconfirmed tree remains gate-owned until runtime restart") shows the leak-on-uncertainty is deliberate for taskkill *failure*, but the exited-before-taskkill case is a certainty ("nothing left to kill"), not an uncertainty, and it is a real race at the 30 s timeout boundary. Downgraded from P1 only because it needs timeout/abort + a tight race; the consequence is still permanent. Fix: treat taskkill exit 128 / "not found" stderr as confirmation, or re-probe the pid after taskkill.

Related: POSIX branch — if `!pid` (spawn failed), the function returns `new Promise(() => {})`, a deliberate forever-pending promise; reachable from the abort/timeout paths only in a narrow race with the spawn-error callback, but worth a comment or a resolved fast-path since `pid === undefined` means there is no tree to own.

### F6 (P2) — Strict prunable-existence probe turns one bad worktree path into whole-repo scan failure

`src/main/git/worktree.ts` `annotatePrunableByExistence` and `src/relay/git-handler-worktree-list.ts`: non-`ENOENT`/`ENOTDIR` stat errors (`EACCES`, `EPERM`, `EIO`, `ELOOP`) now abort the entire listing (`probeError` → throw) where they were previously ignored (worktree kept, not prunable). One worktree under a macOS TCC-denied folder (`~/Documents` without permission — a failure mode this codebase has already hit, cf. the RC-update TCC incident) or an unreadable mount now fails the whole repo's scan persistently: runtime marks `scan_failed`, backs off 30 s→5 min, and serves stale cache / metadata fallback indefinitely. Scope limiter: this probe only runs on the Git <2.31/<2.36 fallback paths, so prevalence is low — but those are exactly the hosts least likely to get attention. Consider treating permission-class errors like the old behavior (keep, not prunable) and reserving throw for genuinely unclassifiable errors.

### F7 (P2) — `normalizeMainWorktreePath` now throws on rev-parse failure, and is shared by non-scan callers

Both `src/main/git/worktree.ts:455` and `src/relay/git-handler.ts`. Previously a failed `readRepoLocation` returned the unnormalized list (only the separate-git-dir/submodule main path was ever wrong); now it throws `Could not normalize the main worktree path…`. Inside the runtime scan this converts a cosmetic degradation into `scan_failed` + backoff. But `normalizeMainWorktreePath` also serves `listWorktrees`/`listWorktreesStrict` callers *outside* the scan gate (worktree create/remove flows, cleanup scans, `orca-runtime.ts:20741` removal preflight): a transient rev-parse failure (EMFILE under load — the very condition this branch is fighting) now fails those operations outright where they previously succeeded with a possibly-unnormalized main path. The throw only fires when the main worktree path differs from `repoPath` (linked-worktree / separate-git-dir entry points), which narrows it, but the trade of "rare cosmetic wrongness" for "hard failure of a user-facing operation" deserves a second look, or at least a scan-only strictness flag.

### F8 (P2) — Relay `listWorktrees` no longer swallows errors; unguarded callers changed behavior

`src/relay/git-handler.ts`: the old `.catch(() => [])` (and the inner fallback's `try { … } catch { return [] }`) are gone — errors now propagate to *every* client of `git.listWorktrees`, not just the tracked scan path. Call-site audit in `src/main` found unguarded `await provider.listWorktrees(...)`:
- `ipc/worktree-remote.ts:732` (`canCheckoutExistingLocalBranchSsh`) — previously a git failure yielded `[]` ⇒ "branch available"; now the SSH worktree-create flow throws mid-preflight unless a caller above catches.
- `repo-worktrees.ts:47` (`listRepoWorktrees`) — generic helper with multiple downstream consumers.
- `orca-runtime.ts:20741` (worktree-removal preflight), `ipc/worktrees.ts:1039/1103/1178/1446`, `project-groups/nested-repo-import-target.ts:73`, `ipc/worktree-remote.ts:1422`.
Some sites (e.g. `ipc/filesystem.ts:363`, `workspace-cleanup-scan.ts`) already catch. Failing loudly is arguably *more* correct than silently treating "git errored" as "no worktrees" (which could, e.g., let create proceed onto a checked-out branch), but this is an unaudited behavior change across ~10 call sites in flows unrelated to the C2 fix. Recommend an explicit sweep of each site.

### F9 (P2) — "Active repo" = connected PTY only; visible-but-idle repos stretch to minutes of staleness

`resolveWorktreeScanFleet` (orca-runtime.ts ~24997) defines eager repos solely by connected PTYs in `this.ptysById`. A repo the user is actively *viewing* (sidebar expanded, worktree list on screen) with no terminal open gets the idle TTL — `⌈repoCount/60⌉` minutes, up to 5 min (≈1.8 min at 107 repos). Externally-created worktrees (`git worktree add` in an outside terminal — a headline use case) took ≤30 s to appear before; now up to minutes on the repo you're looking at, unless a pane is open. Also verify SSH-hosted terminals actually register in `ptysById` with parseable `worktreeId`s — if any terminal class doesn't, those repos are permanently "idle". Deliberate trade, but renderer-visibility (not just PTYs) would be a better activity signal.

### F10 (P3) — No priority for user-triggered scans over the sweep

Both the periodic sweep and the explicit single-repo path (`resolveRepoWorktreesForResolution`, ~17569) share the same 8-slot gate FIFO. Eight slow sweep scans (e.g. SSH repos on a slow link) monopolize the gate; a user-triggered refresh queues behind them and gives up at its 5 s acquisition abort, silently serving stale/metadata fallback. A reserved slot or priority queue for non-sweep callers would fix the inversion.

### F11 (P3) — Backoff/cache maps never pruned against the repo set

`worktreeScanBackoff` / `worktreeScanCache` / `worktreeScanGenerations` entries for repos removed from the store are deleted only via explicit invalidation paths. Removing a repo without hitting `invalidateWorktreeScanCacheForRepo` leaves small permanent entries. Negligible memory; hygiene only.

### F12 (P3) — Agent-scratch TTL no longer applies to non-sweep reads

`resolveWorktreeScanCacheTtlMs` returns the flat 30 s TTL whenever `fleet` is absent — the 5-min agent-scratch TTL (previously unconditional) now applies only on sweep reads. Explicit resolutions of scratch repos re-scan at 30 s. Likely intentional (explicit reads want freshness) but it quietly reverts part of the earlier scratch-TTL optimization for that path; worth confirming intent.

## Performance regressions

- **F3**: hung remote git now consumes global scan throughput (slot) instead of being an isolated leaked process.
- **F10**: sweep/user gate contention adds up to 5 s latency (then stale fallback) to user-facing refreshes under load.
- **F8**: relay error classification runs an extra `lstat` per failed scan, and `gitWorktreeScan`'s abort path spawns kill probes — negligible.
- `getResolvedWorktrees` now calls `resolveLocalProjectRuntimesForRepos` twice per sweep — verified in-memory/cheap, fine.
- `detached: true` + post-exit group probe adds one `kill(−pid, 0)` syscall per successful scan — negligible.
- Otherwise this branch is a large net performance *win*: bounded 8-way fan-out (vs 82 concurrent measured), fleet TTL capping steady-state at ~60 spawns/min (vs ~214/min), missing-repo backoff at 5 min, exponential failure backoff.

## Functionality regressions

- **F1/F2/F3/F4/F5**: the settlement family — every unsettled slot is a permanent global scan-capacity loss with no watchdog, telemetry, or recovery. This is the branch's structural weakness: it converts "too many processes" failures into "silent scanning death" failures.
- **F6/F7**: strictness converts previously-cosmetic degradations into repo-wide scan failures (with backoff amplifying the outage window) and hard failures in worktree create/remove flows.
- **F8**: ~10 call sites now see rejections where they saw `[]`; at least `canCheckoutExistingLocalBranchSsh` changes user-visible behavior of SSH worktree create.
- **F9**: externally-created worktrees on idle-but-visible repos appear up to 5 min late (was ≤30 s).
- Settlement-era correctness improvements verified sound: in-flight dedupe with generation/runtimeKey identity, sweep-join failure attribution (`consumedBySweep`/`failureRecorded` guards), stale-cache fallback on failure, folder-repo exclusion from git scanning, `kind` change now invalidating the scan cache, and abort-on-acquisition (never on running scans, whose results still warm the cache) — all consistent with SSH/WSL/folder-workspace constraints.

## Residual risks / open questions

1. Is relay version hard-pinned to app version on connect? F4 hinges on this.
2. Do all terminal classes (SSH, relay, daemon-owned) register connected PTYs in `ptysById` with `splitWorktreeId`-parseable ids? F9's "active" signal silently degrades for any that don't.
3. POSIX pgid reuse: `process.kill(-pid, 0)` can match a *recycled* process group after the original dies, making `groupGone()` return false forever (poll loop never resolves). Vanishingly rare, but it is another never-settle path with the same permanent cost.
4. The gate limit (8) equals the sweep's `mapWithConcurrency` limit; any future second consumer of the gate silently halves effective sweep throughput. A comment tying the two constants together exists; an assertion doesn't.
5. No telemetry/log when a gate slot is held longer than, say, 5 min — the wedge described in F1–F5 would today be diagnosable only by symptom ("everything is metadata-fallback"). A cheap counter + warn would make every finding above field-debuggable.

## Confidence

High on F1 (verified `dispose()` does not clean `trackedSettlementWaiters`), F2 (Node `exitCode`/`signalCode` semantics; callback-after-close ordering on maxBuffer verified against Node's exec implementation, small residual uncertainty across Node versions), F6, F7, F8 (call sites grepped and spot-read). Medium on F3 (depends on absence of any timeout I didn't find above the handler — I checked `this.git` and `gitWorktreeScan`), F4 (deployment invariant unknown), F5 (race-window reasoning, not reproduced), F9 (did not trace every PTY registration path). Findings are from code reading only; nothing was executed or reproduced.
