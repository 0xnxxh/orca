# Review: `fix-p2-c2-worktree-scan` vs `origin/main`

**Reviewer:** Grok  
**Mode:** Review-only (no product source changes)  
**Base:** `e1f0e7689c5346b5778c678514f8c7251ea0b04f` (merge-base with `origin/main`)  
**Head:** `03f351a8d5` (`fix(runtime): close the scan acquisition handoff`)  
**Scope of commits (5):**

1. `25d8636cf5` — bound worktree scan fan-out and back off dead repos  
2. `c44595cee6` — settle and back off worktree scans  
3. `529dca3918` — close worktree scan settlement races  
4. `3dbad6ddaf` — probe scan groups before escalation  
5. `03f351a8d5` — close the scan acquisition handoff  

---

## Summary

This branch correctly attacks the C2 spawn storm: it caps concurrent worktree scans at 8, derives idle-repo TTLs from a global 60/min budget, negative-caches missing/failed repos, and holds the scan gate until process-tree (local) or relay (SSH) settlement. Those are real, well-tested improvements over unbounded `Promise.all` + flat 30s TTL.

The settlement model introduces **gate-slot permanent ownership** failure modes. On Windows, `taskkill` non-zero/`error` never resolves the settlement promise. On SSH disconnect, `SshChannelMultiplexer.dispose` intentionally leaves `trackedSettlementWaiters` unresolved (covered by unit test). Because `WorktreeScanGate` is a **single global limit of 8** shared by all repos, a handful of stuck settlements can freeze **all** subsequent worktree scans until runtime restart. That is the dominant residual risk of this branch.

Secondary issues: WSL never classifies `missing_repo_path`; “active” fleet membership is only connected PTYs; local scans use `listWorktreesStrict` (throws) instead of lenient `listWorktrees` (returns `[]`); abort signals cancel gate waiters but not already-started git; past-deadline sweep still *invokes* `listRepoWorktreesForResolution` before the fallback wins.

---

## Scope

| Area | Files | Reviewed for |
|------|--------|--------------|
| Runtime scan orchestration | `src/main/runtime/orca-runtime.ts`, `worktree-scan-gate.ts` | Fan-out, TTL/budget, backoff, in-flight dedupe, sweep timeout, authority/prune |
| Local git exec settlement | `src/main/git/runner.ts`, `worktree.ts` | `settleProcessTree`, tree kill wait, strict listing, path normalization |
| SSH / relay settlement | `ssh-channel-multiplexer.ts`, `ssh-git-provider.ts`, `relay/dispatcher.ts`, `relay/git-handler.ts`, `git-handler-worktree-list.ts`, `subprocess-tree-termination.ts` | Tracked RPC, `rpc.settled`, cancel/timeout, missing-root classification |
| Tests | `orca-runtime.test.ts`, gate/runner/relay tests | Coverage gaps around permanent gate ownership |

**Out of scope for this review:** unrelated IPC `listRepoWorktrees` call sites (cleanup, hosted-review, etc.) except where they share settlement helpers; UI/renderer consumers.

---

## Findings (severity-sorted)

### P0 — Global scan gate can permanently dead-lock after SSH dispose mid-scan

**Where:**  
- `src/main/ssh/ssh-channel-multiplexer.ts` — `requestTracked` / `dispose`  
- `src/main/runtime/worktree-scan-gate.ts` — release only on `settled`  
- `src/main/runtime/orca-runtime.ts` — `listRepoWorktreesForResolution` → `worktreeScanGate.runTracked` → `provider.listWorktreesTracked`

**Call chain:**  
`computeResolvedWorktrees` / `listDetectedManagedWorktrees`  
→ `listRepoWorktreesForResolution`  
→ `worktreeScanGate.runTracked`  
→ `startRepoWorktreesForResolution` → `listWorktreesTracked`  
→ `mux.requestTracked` (settled waiter registered)  
→ connection loss → `mux.dispose()` rejects `result` but **does not** resolve `trackedSettlementWaiters`  
→ gate `release()` never runs  

**Evidence:** Unit test *documents* the hang:

```488:501:src/main/ssh/ssh-channel-multiplexer.test.ts
    it('does not claim remote settlement when a tracked connection is disposed', async () => {
      ...
      mux.dispose()
      ...
      expect(settled).toBe(false)
      expect(getMuxInternals(mux).trackedSettlementWaiters.size).toBe(1)
    })
```

`dispose()` clears `pendingRequests` only; it never drains `trackedSettlementWaiters` (lines ~296–347).

**Failure mode:** Each in-flight tracked scan at disconnect leaks one of 8 global permits. After ≤8 such leaks (or one bad multi-repo sweep), **local and SSH scans both queue forever**. App appears “stuck” refreshing worktrees; only restart recovers.

**Why “intentional unconfirmed ownership until restart” is wrong here:** On dispose the remote session is gone—there is no process tree left for the main process to protect. Holding the *local* global gate does not protect remote resources; it only poisons the client.

**Suggested direction (not implemented):** On dispose/timeout-without-settled, resolve `settled` (or race with a max ownership TTL, e.g. 30–60s) so the gate cannot be bricked.

---

### P0 — Windows settlement never completes when `taskkill` fails or exits non-zero

**Where:**  
- `src/main/git/runner.ts` — `terminateSpawnedCommandTreeAndWait` (win32 branch)  
- `src/relay/subprocess-tree-termination.ts` — same pattern  

**Evidence:**

```379:401:src/main/git/runner.ts
    return new Promise((resolve) => {
      let childClosed = leaderAlreadyClosed || hasSpawnedCommandExited(child)
      let treeKilled = false
      const finish = (): void => {
        if (childClosed && treeKilled) {
          resolve()
        }
      }
      ...
      killer.once('close', (code) => {
        treeKilled = code === 0
        finish()
      })
      killer.once('error', () => {
        // An unconfirmed tree remains gate-owned until runtime restart.
      })
```

Also `if (!pid) return new Promise(() => {})` — never resolves (runner + relay).

**Failure modes:**

1. `taskkill` exits non-zero (common when the process is already gone → often 128/1) → `treeKilled` stays false → **hang**.  
2. `taskkill` fails to spawn → empty `error` handler → **hang**.  
3. Missing `pid` → **hang**.

Local scans set `settleProcessTree: true` on every resolution path (`listLocalRepoWorktreesForResolution`), so timeout/abort/maxBuffer *and* normal settle-after-exit paths (when group still alive) all funnel here. One bad Windows kill permanently burns a gate slot.

**Severity:** P0 on Windows for scan liveness; same bug exists on the relay side for SSH hosts running Windows.

---

### P1 — POSIX settlement can poll forever after SIGKILL

**Where:** `terminateSpawnedCommandTreeAndWait` (POSIX branch) in `runner.ts` and `subprocess-tree-termination.ts`.

After the 1s grace, SIGKILL is sent and `poll()` runs every 25ms until `process.kill(-pid, 0)` returns ESRCH. There is **no max wait**. Unkillable / zombie process-group edge cases (or wrong PID/group after `detached` quirks) leave the gate held indefinitely.

**Suggested direction:** Cap settlement wait (e.g. 5–10s), then force-release the gate and log; do not brick concurrency forever.

---

### P1 — Sweep deadline does not stop starting scans; abort only cancels gate waiters

**Where:** `computeResolvedWorktrees` in `orca-runtime.ts`.

```24804:24866:src/main/runtime/orca-runtime.ts
    const sweepDeadline = Date.now() + RESOLVED_WORKTREE_REPO_TIMEOUT_MS
    const acquisition = new AbortController()
    const abortTimer = setTimeout(() => acquisition.abort(), RESOLVED_WORKTREE_REPO_TIMEOUT_MS)
    ...
        const scan = await withTimeoutFactory(
          this.listRepoWorktreesForResolution(
            repo,
            projectRuntimeByRepoId,
            fleet,
            acquisition.signal
          ),
          Math.max(0, sweepDeadline - Date.now()),
          () => this.buildCurrentWorktreeScanFallback(repo)
        )
```

Issues:

1. **No `onTimeout` abort** on the per-repo `withTimeoutFactory` (unlike `listDetectedManagedWorktrees`, which aborts). Caller returns fallback while the underlying `listRepoWorktreesForResolution` continues.  
2. **`acquisitionSignal` is only wired into gate acquisition**, not into `listWorktreesStrict` / git `signal`. Once a scan starts, the 5s sweep abort does **not** kill git.  
3. `mapWithConcurrency` still *calls* `listRepoWorktreesForResolution` for every repo even when `sweepDeadline - Date.now()` is 0, racing a 0ms timeout with real work.

**Impact:** Under slow git/WSL/SSH, a “5s sweep” can leave 8 long-lived git processes holding the gate well past the UI timeout, delaying user-triggered scans and the next sweep’s useful work. Not a correctness bug for cache finalization (late success still caches), but a performance regression relative to “budget” intent and a source of retry pile-ups.

---

### P2 — WSL missing directories never get `missing_repo_path` backoff

**Where:** `classifyLocalWorktreeScanFailure`:

```25337:25350:src/main/runtime/orca-runtime.ts
  private async classifyLocalWorktreeScanFailure(...): Promise<WorktreeScanFailureKind> {
    if (options.wslDistro) {
      return 'scan_failed'
    }
    try {
      await lstat(repoPath)
      ...
```

Deleted WSL project roots escalate 30s → 60s → … → 5min as `scan_failed` instead of jumping to 5min `missing_repo_path`. Still bounded, but WSL dead-repo installs keep paying `wsl.exe` + git spawn cost more often. Native/SSH get the fast missing-path path (SSH via relay `worktreeScanRootMissing`).

---

### P2 — “Active” repos are only connected PTY owners

**Where:** `resolveWorktreeScanFleet`:

```25004:25018:src/main/runtime/orca-runtime.ts
    for (const pty of this.ptysById.values()) {
      if (!pty.connected) {
        continue
      }
      const repoId = splitWorktreeId(pty.worktreeId)?.repoId
```

Repos with open UI / selected worktree / disconnected-but-visible panes, but no **connected** PTY, share the idle budget (up to 5 min TTL). External `git worktree add/remove` on those repos can lag the resolved snapshot. User-triggered `listDetectedManagedWorktrees` still uses eager 30s TTL (no fleet) and bypasses backoff—mitigation for explicit UX, not for background resolution.

---

### P2 — Lenient → strict local listing changes failure semantics

**Before:** `listRepoWorktrees` → `listWorktrees` **swallows** most errors and returns `[]` with the old path wrapping as `{ ok: true, worktrees }`.  
**After:** `listWorktreesStrict` **throws**; runtime maps to `{ ok: false, failureKind }`.

| Case | Old | New |
|------|-----|-----|
| Missing path | often `[]` + ok | `missing_repo_path` + backoff (good) |
| Not a git repo | `[]` + ok | `scan_failed` + backoff |
| Transient git error | `[]` + ok, **could prune lineage** if treated ok | no prune; stale fallback if cache exists (good) |
| separate-git-dir + rev-parse fail | unnormalized list (readRepoLocation swallowed) | full scan throws (`readRepoLocation` no longer catch-all) |

Net: better lineage safety (no false-authoritative empty ok), but more repos enter failure backoff and empty UI until a successful scan—especially “registered path isn’t a repo yet.”

---

### P2 — Relay prunable existence probe fails the entire list on non-ENOENT stat errors

**Where:** `annotatePrunableWorktreesByExistence` (`git-handler-worktree-list.ts`).

Old: only marked ENOENT as prunable; other stat errors ignored.  
New: EACCES/EIO/etc. set `probeError` and **throw**, failing the whole `git.listWorktrees` for Git &lt;2.31 fallback path.

One unreadable linked worktree path can mark the whole SSH repo as `scan_failed` and engage backoff.

---

### P2 — Cursor rotation advances by concurrency, not by “attempted”

```24818:24822:src/main/runtime/orca-runtime.ts
    this.worktreeScanSweepCursor =
      scannableRepos.length > 0
        ? (sweepStart + WORKTREE_SCAN_CONCURRENCY) % scannableRepos.length
        : 0
```

Fairness for which repos sit first in the 5s window is good. Combined with idle TTLs, cold-start full fleet warm-up is intentionally multi-sweep. Not a bug, but large fleets remain partially metadata-fallback for several seconds after launch—acceptable if documented; surprising if product expects full git authority immediately.

---

## Performance regressions

| Issue | Severity | Notes |
|-------|----------|--------|
| Gate permanent leak (SSH dispose / Windows taskkill / infinite POSIX poll) | **P0/P1** | Turns concurrency cap into a **zero-throughput** failure; worse than pre-branch unbounded fan-out once stuck |
| In-flight git not cancelled on sweep timeout | **P1** | 8 workers can outlive 5s deadline; user scans wait behind settlement |
| WSL missing path = soft failure backoff | **P2** | Extra WSL spawns vs native 5min missing backoff |
| `settleProcessTree` on every local scan | **Low / intentional** | Successful path usually one `kill(-pid,0)` ESRCH; cost is small vs spawn storm fixed |
| Sweep still walks all repos every ~1s (`RESOLVED_WORKTREE_CACHE_TTL_MS`) | **Low** | Mostly cache hits; CPU not git. Pre-existing shape, now safer |
| Double limiter (`mapWithConcurrency(8)` + `WorktreeScanGate(8)`) | **None** | Gate is the real process budget; map limits callback fan-out. Redundant but not harmful |
| Sparse-checkout annotation (8-way) still on every strict list | **Pre-existing** | Still N path probes per scan; not introduced but remains in hot path |

**What improved (do not regress away):**

- Uncapped `Promise.all` over all repos → concurrency 8.  
- Flat 30s TTL (~2 execs/repo/min) → budgeted idle TTL (target ~60 scans/min fleet-wide).  
- Dead missing dirs no longer re-spawn forever at full rate (native/SSH).  
- Failure exponential backoff to 5 min.  
- Explicit user scans skip backoff read/write (commented intent, correct).

---

## Functionality regressions

| Issue | Severity | Notes |
|-------|----------|--------|
| Global scan stall after stuck settlement | **P0** | Missed worktrees *and* stuck scans; false “empty” fallbacks while gate is full |
| SSH disconnect mid-scan | **P0** | Settled intentionally never fires; same stall |
| Strict listing / throwy normalize | **P2** | More `ok: false` empty results; lineage prune correctly gated by authority (improvement vs false prune) |
| Authority prune window fixed at 30s | **Low** | `pruneLineageForAuthoritativeWorktreeScan` rejects cache older than `WORKTREE_SCAN_CACHE_TTL_MS` even if idle TTL is 5m—prune runs on the successful scan itself, so OK; cache-hit re-entry won’t re-prune |
| Idle-but-visible repos | **P2** | Up to 5 min stale git view without connected PTY |
| Folder workspaces | **OK** | Still in-memory via `listRuntimeFolderWorkspaces`; not gated |
| Provider-missing SSH | **OK** | Bypasses gate (`buildBackedOffWorktreeScanResult` / stored meta); tested |
| In-flight join + `consumedBySweep` backoff attribution | **OK** | Failures from user-started scans can back off only after a sweep joins—intentional |
| Invalidate clears backoff/cache/inFlight/generation | **OK** | `invalidateWorktreeScanCacheForRepo` / SSH target invalidation |

**Settlement acquisition handoff (commits 3–5):** The gate’s abort-on-waiter path and `runTracked` deferred `startOperation` look correct for “don’t start after abort; release if aborted after acquire.” Tests cover saturated gate + timed-out active scans remaining gate-owned until settle—good for resource honesty, bad when settle never comes (see P0).

---

## Residual risks / open questions

1. **Is permanent gate ownership on SSH dispose product-intentional?** The test says yes; ops impact says no. Needs an explicit product decision: prefer brief double-spawn risk vs bricked scans.  
2. **Windows `taskkill` exit codes in the wild** — confirm non-zero-on-already-dead is common; if yes, P0 is not theoretical.  
3. **Should sweep pass `signal` into `listWorktreesStrict` / SSH tracked request?** Would allow true budget enforcement; needs care so settlement still runs on abort.  
4. **Active fleet signals** — expand beyond `pty.connected` (focused worktree, recent listDetected, mobile session)?  
5. **WSL missing-path probe** — `lstat` on UNC vs `wslpath` may be why classification was skipped; still worth a WSL-side existence probe for dead-repo backoff.  
6. **Hydration / other `listRepoWorktrees` paths** still use lenient listing outside this gate—fleet storm is fixed for resolved-worktree sweep only; confirm no second uncapped fan-out remains (hydrate-local-pty was pre-existing).  
7. **Relay `rpc.settled` after client timeout:** cancel is sent; finally should still emit settled. If cancel is lost, client waiter hangs until dispose (then permanent leak)—another path into P0.

---

## Confidence

| Claim | Confidence |
|-------|------------|
| Fan-out + TTL + missing-repo backoff fix the measured C2 storm | **High** — code + commit message measurements + extensive unit tests |
| SSH dispose / Windows taskkill can permanently exhaust the gate | **High** — direct code paths + explicit unit test for dispose; Windows finish condition is strict `code === 0` |
| Sweep timeout does not cancel in-flight git | **High** — signal only on gate acquire |
| WSL missing-path classification gap | **High** — early return in classifier |
| Active=connected-PTY only is a product gap | **Medium** — may be intentional |
| Production frequency of permanent leaks | **Medium** — depends on disconnect rate and taskkill codes |

**Overall review confidence:** **High** on correctness of the main failure modes; the branch is a strong fix for the spawn storm but the settlement ownership model needs a hard upper bound before it is safe for multi-hour Electron sessions with flaky SSH/Windows.

---

## Suggested fix priority (for implementers; not done here)

1. **P0:** Always resolve tracked `settled` on mux dispose (and optionally on request timeout after cancel + grace).  
2. **P0:** Windows settle: treat taskkill `error` / non-zero / missing pid as settled (or timeout-bound), never open-ended.  
3. **P1:** Cap POSIX settle poll; pass abort into local/SSH scan exec; don’t start new gate work after sweep deadline.  
4. **P2:** WSL missing-path classification; richer “active repo” set; soft-fail prunable probe errors.

---

## Appendix: Key constants

| Constant | Value | Role |
|----------|-------|------|
| `WORKTREE_SCAN_CONCURRENCY` | 8 | Gate + sweep map concurrency |
| `WORKTREE_SCAN_GLOBAL_BUDGET_PER_MIN` | 60 | Idle TTL budget |
| `WORKTREE_SCAN_CACHE_TTL_MS` | 30_000 | Eager / active TTL |
| `WORKTREE_SCAN_IDLE_TTL_CAP_MS` | 5 min | Max idle TTL |
| `WORKTREE_SCAN_MISSING_REPO_RETRY_MS` | 5 min | Missing path backoff |
| `WORKTREE_SCAN_FAILURE_RETRY_CAP_MS` | 5 min | Soft failure cap |
| `RESOLVED_WORKTREE_REPO_TIMEOUT_MS` | 5_000 | Per-sweep wall clock |
| `RESOLVED_WORKTREE_CACHE_TTL_MS` | 1_000 | Resolved snapshot cache |
| `REQUEST_TIMEOUT_MS` (SSH mux) | 30_000 | Tracked listWorktrees result timeout |
| `POSIX_TREE_KILL_GRACE_MS` | 1_000 | SIGTERM→SIGKILL |
