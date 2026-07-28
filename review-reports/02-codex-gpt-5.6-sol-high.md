# Worktree-scan regression review

## Summary

The branch materially improves the original unbounded all-repo `Promise.all`, but it introduces one P1 global-liveness regression and one P1 compatibility/functionality regression.

The most serious issue is that the new process-settlement contract can intentionally remain unresolved after an SSH disconnect or failed tree-kill confirmation, while the single runtime-wide gate releases capacity only after that promise settles. Eight such operations—readily produced by one SSH connection with eight repos—permanently consume the global limit and stop local, WSL, and unrelated SSH scans until the runtime restarts.

The second P1 is specific to the supported Git 2.25–2.35 range: auxiliary filesystem and path-normalization probes that were previously best-effort now fail the entire repo scan. One inaccessible linked worktree, or one failed secondary `rev-parse`, can therefore hide every worktree in that repo and put background scans into backoff.

I found no P0 issue. I found two P1 and four P2 issues.

## Scope

- Compared `HEAD` (`03f351a8d5`) with merge-base `e1f0e7689c5346b5778c678514f8c7251ea0b04f` / `origin/main`.
- Reviewed all five branch commits:
  - `25d8636cf5` — bounded sweep and backoff
  - `c44595cee6` — settlement tracking
  - `529dca3918` — settlement race fixes
  - `3dbad6ddaf` — process-group probing
  - `03f351a8d5` — acquisition handoff
- Focused on:
  - `src/main/runtime/orca-runtime.ts`
  - `src/main/runtime/worktree-scan-gate.ts`
  - `src/main/git/runner.ts`
  - `src/main/git/worktree.ts`
  - `src/main/providers/ssh-git-provider.ts`
  - `src/main/ssh/ssh-channel-multiplexer.ts`
  - `src/relay/dispatcher.ts`
  - `src/relay/git-handler.ts`
  - `src/relay/git-handler-worktree-list.ts`
  - `src/relay/subprocess-tree-termination.ts`
  - Relevant tests and the existing desktop worktree-list call path.
- Validation performed:
  - `git diff --check origin/main...HEAD` — passed.
  - Focused Vitest run across eight changed test files — 190 tests passed.
  - `src/main/runtime/orca-runtime.test.ts` — 902 tests passed.
  - `pnpm run typecheck:node` — passed.

## Findings (severity-sorted)

### P1 — Unsettled operations permanently consume a runtime-global gate and can wedge every host

**Evidence**

- There is one `WorktreeScanGate(8)` for the entire `OrcaRuntimeService`, not one per execution host or connection (`src/main/runtime/orca-runtime.ts:2580`).
- A gate permit is released only when `operation.settled` resolves or rejects (`src/main/runtime/worktree-scan-gate.ts:71-84`).
- SSH scans use `requestTracked`, whose settlement promise is resolved only by a later `rpc.settled` notification (`src/main/ssh/ssh-channel-multiplexer.ts:229-251`).
- On connection loss, `dispose` rejects ordinary pending requests but does not resolve, reject, or remove tracked settlement waiters (`src/main/ssh/ssh-channel-multiplexer.ts:296-335`).
- The new test explicitly locks in that behavior: after `mux.dispose()`, `tracked.settled` remains pending and `trackedSettlementWaiters.size` remains 1 (`src/main/ssh/ssh-channel-multiplexer.test.ts:488-502`).
- The runtime retains the corresponding in-flight record until both result and settlement finish (`src/main/runtime/orca-runtime.ts:25247-25260`). Reconnection changes the provider generation and evicts the record from the lookup map, but it cannot call the release closure held by the old settlement promise.
- The local/relay process-tree helpers have additional permanent-pending branches:
  - Missing child PID returns a never-settling promise (`src/main/git/runner.ts:370-377`, `src/relay/subprocess-tree-termination.ts:31-38`).
  - On Windows, `taskkill` must exit zero; a nonzero exit or spawn error never resolves the promise (`src/main/git/runner.ts:378-402`, `src/relay/subprocess-tree-termination.ts:39-63`). “Process not found” is a normal race when the leader exits between timeout detection and `taskkill`.
  - POSIX group polling has no upper deadline once a group cannot be confirmed absent.

**Failure mode**

1. The periodic sweep starts up to eight tracked scans for repos on one SSH connection.
2. The connection drops before the relay's settlement notifications arrive.
3. RPC result promises reject and the UI falls back, but all eight settlement promises remain pending.
4. All eight global permits remain owned forever.
5. Subsequent local, WSL, folder-adjacent runtime resolution, reconnected SSH, and other-host scans cannot acquire a permit. Explicit calls time out after five seconds and return metadata fallback; periodic scans do the same. Recovery requires restarting the runtime.

The same terminal state can be reached incrementally through eight Windows tree-kill races, not only one eight-repo disconnect. The retained in-flight records and waiter maps also retain old providers/multiplexers.

**Why P1**

This is a persistent cross-host loss of core worktree discovery caused by an ordinary network failure or kill race. One failing host can disable healthy hosts.

**Required direction**

Settlement ownership needs a bounded terminal state and host isolation. At minimum, gates should be scoped by execution host/SSH provider generation, and lost transports/tree-kill failures need a bounded quarantine/reaper path that releases capacity without allowing uncontrolled respawn. Tests should prove connection-loss recovery, later cached calls, concurrent disconnects, and unrelated-host progress.

### P1 — Best-effort compatibility probes now fail the whole repo on Git 2.25–2.35

**Evidence**

The `-z` fallback is used for Git versions before 2.36, including Orca's Git 2.25 baseline.

- Local fallback probing now records any `stat` error other than `ENOENT`/`ENOTDIR` and throws it after the workers settle (`src/main/git/worktree.ts:615-662`). Before this branch, non-`ENOENT` errors were ignored and the already parsed worktree graph was returned.
- The relay duplicates the same all-or-nothing behavior (`src/relay/git-handler-worktree-list.ts:42-96`).
- A second auxiliary path was also made fatal:
  - Local `readRepoLocation` no longer catches secondary `rev-parse` failures, and an unparseable result throws from normalization (`src/main/git/worktree.ts:408-469`).
  - Relay normalization does the same (`src/relay/git-handler.ts:1440-1491`).
  - Before this branch, both paths returned the original parsed graph when normalization could not be completed.
- Runtime local scans now call the strict listing and classify these errors as `scan_failed`; a cold scan returns no local worktrees and a sweep starts exponential backoff (`src/main/runtime/orca-runtime.ts:25273-25339`).

**Failure modes**

- A repo on Git 2.25–2.35 has several linked worktrees and one path returns `EACCES`, `EPERM`, `EIO`, a transient network-filesystem error, or a WSL UNC access error. The main repo and every healthy linked worktree disappear from the fresh result.
- A repo registered from a linked worktree, separate-git-dir checkout, submodule-style layout, WSL path, or tilde-expanded SSH path requires normalization because the porcelain main path differs from `repo.path`. If the second `rev-parse` fails or produces an unparseable response, a successful `git worktree list` is discarded.
- On cold start there is no stale cache to mask the failure. On warm start stale entries can remain visible, but the result is non-authoritative and background retries back off.

**Why P1**

Git 2.25 is an explicit core-workflow baseline. A failure enriching one row should not erase an already valid repo-wide worktree graph, especially on SSH, WSL, and network-mounted paths where these filesystem errors are credible.

**Required direction**

Keep cancellation/settlement strict without making enrichment authoritative for the whole graph. Preserve parsed worktrees when an individual existence probe or normalization probe fails, mark only the affected information unknown, and distinguish cancellation from a row-level filesystem failure.

### P2 — User-triggered scans have no priority over background work and can be forced into false fallback

**Evidence**

- Background sweeps and explicit `listDetectedManagedWorktrees` calls share the same FIFO global gate (`src/main/runtime/orca-runtime.ts:24831-24867`, `src/main/runtime/orca-runtime.ts:25238-25240`).
- A background local Git or SSH RPC can legitimately retain a permit for its 30-second command/RPC timeout.
- The explicit API gives acquisition/result only five seconds, aborts its queued acquisition, and returns the current fallback (`src/main/runtime/orca-runtime.ts:17557-17580`).
- “Explicit user-triggered scans ... always get a fresh attempt” in the comment at `src/main/runtime/orca-runtime.ts:25195-25199` is therefore not true when the gate is full: they bypass backoff, but do not necessarily start.

**Failure mode**

Eight healthy-but-slow NFS, WSL, or SSH scans start in a periodic sweep. A user asks to discover/show worktrees for a different healthy repo. Its request waits behind the background operations, is cancelled after five seconds without spawning Git, and reports `source: metadata-fallback`. A newly created external worktree is omitted; on a cold repo the list can be empty.

This occurs without the permanent leak from the P1 finding.

**Required direction**

Reserve or prioritize capacity for explicit scans, or separate background and interactive acquisition while preserving an aggregate host-level bound.

### P2 — Runtime strict scans bypass the existing cross-caller in-flight dedupe

**Evidence**

- The ordinary local `listWorktrees` path owns a module-level in-flight map specifically to collapse cold-start duplicates (`src/main/git/worktree.ts:700-773`).
- `listWorktreesStrict` directly calls `readWorktreeList` and is outside that map (`src/main/git/worktree.ts:802-812`).
- The branch switches runtime resolution from `listRepoWorktrees`/`listWorktrees` to `listWorktreesStrict` (`src/main/runtime/orca-runtime.ts:25319-25328`).
- Desktop `worktrees:listAll`/`listDetectedGitWorktrees`, memory hydration, and other callers still use `listRepoWorktrees` and the ordinary shared path.

**Failure mode**

At startup or during concurrent mobile/desktop polling, runtime resolution and desktop detected-worktree listing can run two Git commands for the same local repo. Their separate concurrency pools can produce up to eight runtime scans plus eight desktop scans, and the same repo is no longer guaranteed to collapse to one subprocess. The strict runtime path also repeats sparse-checkout filesystem probes independently.

This does not recreate the original 82-process fan-out by itself, but it removes an existing performance invariant on the exact startup path being optimized.

**Required direction**

Share the underlying strict scan operation across callers, with the cache key including strictness/timeout/settlement requirements, or centralize runtime and IPC discovery behind one host-scoped scan broker.

### P2 — The idle TTL causes five-minute discovery lag for visible repos with no connected pane

**Evidence**

- A repo is “active” only when a connected PTY record parses to its repo ID (`src/main/runtime/orca-runtime.ts:24991-25009`); renderer selection, sidebar visibility/expansion, mobile visibility, and an explicit watch subscription do not count.
- Every other repo gets a fleet-size-derived TTL of up to five minutes (`src/main/runtime/orca-runtime.ts:30825-30839`).
- Orca mutations invalidate the cache, but out-of-band `git worktree add/remove` does not.

**Failure mode**

A user is viewing or selecting a repo without an attached connected pane and creates a worktree outside Orca. Automatic runtime discovery can continue returning the old cached graph for up to five minutes instead of the previous 30 seconds. The same applies after an externally removed worktree, so stale entries persist longer.

**Required direction**

Include actual consumer visibility/recent explicit access in the eager set, or use event/watch invalidation for external worktree metadata. The performance budget should not redefine visible-but-terminal-less repos as idle.

### P2 — The advertised global spawn budget is not a hard bound

**Evidence**

- The idle TTL is computed as `repoCount / 60` minutes but capped at five minutes (`src/main/runtime/orca-runtime.ts:30835-30838`).
- For more than 300 scannable repos, the cap dominates and steady-state idle scan rate becomes `repoCount / 5` per minute: 400 repos yield about 80 scans/minute, 1,000 yield about 200/minute.
- Repos with any connected PTY are excluded from the budget and remain at 30 seconds, even if the panes are idle/done/hidden.

**Impact**

The change bounds instantaneous fan-out to eight, but it does not bound total spawn rate as the comments claim. Large fleets or many retained terminal panes still produce a scan rate linear in repo count and can sustain disk/process pressure.

**Required direction**

Treat the rate as an actual token budget, remove or justify the five-minute cap, and distinguish genuinely foreground repos from merely connected pane records.

## Performance regressions

1. **Permanent capacity loss:** unresolved settlement promises leak permits and retained runtime/provider state; after eight, throughput is zero globally.
2. **Interactive latency inversion:** background scans can consume all capacity for longer than the explicit API's deadline.
3. **Lost dedupe:** the new strict local path no longer joins the existing module-level scan shared by IPC and startup callers.
4. **Budget leakage:** the five-minute TTL cap and broad “connected PTY = active” rule allow steady-state spawn rate to scale linearly again.
5. **Extra failure-path I/O:** every failed local scan adds an `lstat`, and every failed SSH scan adds a relay-side `lstat`. This is reasonable for missing-root classification in isolation, but becomes repeated work when auxiliary row probes turn otherwise usable scans into failures.

The concurrency cap itself is a clear improvement over `origin/main`; the regressions are in ownership lifetime, prioritization/isolation, and duplicate work around that cap.

## Functionality regressions

1. **Stuck scans across unrelated hosts:** one disconnected SSH host or repeated Windows kill race can permanently prevent all later worktree scans.
2. **Whole-repo false failures on supported Git:** one non-missing `stat` failure in a linked worktree erases every row on Git 2.25–2.35.
3. **Whole-repo false failures during normalization:** a secondary best-effort `rev-parse` failure discards a successful porcelain listing.
4. **False metadata fallback for explicit requests:** an interactive request can time out solely because background work owns the global permits.
5. **Delayed external discovery:** terminal-less but visible repos can miss externally added/removed worktrees for up to five minutes.

Folder workspaces remain on an in-memory path and do not invoke Git, but they still share the enclosing five-second resolved-snapshot computation. SSH metadata fallback is preserved when an RPC result fails; it does not solve the global permit leak because settlement, not result, owns the permit.

## Residual risks / open questions

- There is no real-process integration test demonstrating recovery after:
  - eight concurrent SSH scans followed by connection loss and reconnect,
  - Windows `taskkill` returning nonzero because the process already exited,
  - a POSIX process group that cannot be confirmed absent,
  - one failed host while another host and local Git continue scanning.
- The settlement tests intentionally assert permanent pending ownership after mux disposal, but no test composes that behavior with the runtime's global gate.
- The process-group poll loops have no maximum lifetime, metric, or operator-visible recovery path. It is unclear how the runtime should distinguish a truly surviving process from an unconfirmable group after transport loss.
- No real-binary test in this branch exercises Git 2.25, 2.31, 2.35, and 2.36 boundaries with inaccessible/prunable paths. That boundary is central because the new fatal `stat` behavior runs only on the pre-2.36 fallback.
- WSL missing-root scans are always classified as generic `scan_failed`, so they do not receive immediate missing-root backoff. This avoids host-side false ENOENT classification but leaves the intended dead-repo optimization weaker on WSL.
- The second `resolveLocalProjectRuntimesForRepos` pass after every resolved-worktree computation is CPU-only but duplicates project/repo traversal on a one-second cache path (`src/main/runtime/orca-runtime.ts:24903-24914`). It is probably small relative to Git I/O, but no scale measurement is supplied.
- The report did not exercise real SSH, WSL, Windows, NFS, or Git 2.25 binaries; conclusions for those paths are code-path based.

## Confidence

**High** for the global gate leak: the production code and an explicit unit test demonstrate that tracked settlement remains pending after disconnect, while the gate demonstrably releases only on settlement.

**High** for the older-Git whole-repo failure: the branch diff directly changes non-`ENOENT` probe behavior from ignore to throw on both local and relay fallbacks, and removes the normalization catch in both implementations.

**High** for lost local dedupe and interactive starvation: the call graphs and timeout values are explicit.

**Medium-high** for user impact frequency. The affected conditions—SSH reconnects, Windows kill races, Git 2.25–2.35, network/permission errors, and visible repos without a connected PTY—are realistic, but this review did not reproduce them against real hosts.
