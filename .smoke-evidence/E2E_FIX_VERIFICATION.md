# Adversarial verification — 6 e2e fixes (branch fix-e2e-tests-2, uncommitted)

Independent review. All 66 unit tests across the 3 changed unit-test files PASS
(`vitest run` on worktree-teardown / focus-existing-window / terminal-parked-tab-watchers).

Overall: **SHIP.** 4 CORRECT, 2 RISKY-but-safe. No fix masks a real product bug or
weakens a real invariant. One PR-note on #6.

---

## #1 worktree-teardown selector_not_found tolerance — VERDICT: CORRECT (ship)

Root cause independently confirmed: `stopPtysForDestructiveWorktreeRemoval`
(orca-runtime.ts:2725, `requirePhysicalStop:true`) → `killAllProcessesForWorktree`
→ runtime sweep → `stopTerminalsForWorktree(worktreeId)` which INTERNALLY re-resolves
via `resolveWorktreeSelector('id:'+id)` (line 20355). That resolve legitimately throws
`selector_not_found` for a worktree already unlisted by git during removal — the very
case `resolveWorktreeRemovalTarget` already anticipates and treats as benign (line
18128-18139, falls back to persisted metadata). Old predicate only tolerated
`runtime_unavailable`, so the sweep fail-closed and the whole removal returned
ok:false. This IS the failure.

Not masking a real teardown: the runtime sweep is the renderer-graph path and is
NON-authoritative. Provider sweep + registry sweep run independently in the same
Promise.all, keyed on the RAW worktreeId (prefix `${id}@@` / session.worktreeId / cwd),
not on selector resolution. Under `requirePhysicalStop`, sweepProviderByPrefix calls
`listProcesses()` un-caught (fails closed on throw) and the final `stopAttempts` check
(line 140-145) still throws if any discovered PTY couldn't be physically stopped. So
real live PTYs are still caught and can still block removal. When selector_not_found
is thrown the runtime sweep did nothing anyway (throws before iterating leaves/ptysById),
so swallowing it only drops a spurious block, not a real one.
New unit test validates the tolerance (rejects selector_not_found, empty provider/registry,
requirePhysicalStop:true → runtimeStopped:0, no throw).

Narrow note (not blocking): SSH path passes `includeLocalRegistry:false`, so provider
sweep is the sole net there. It still runs + fails closed, but a hypothetical SSH pty in
ptysById whose provider row lacks prefix/worktreeId/cwd would be uncovered — an extreme,
pre-existing edge, not introduced here.

## #2 worktree-scroll-to-current 3-rows-vs-2 — VERDICT: CORRECT / pollution (no code change; transitive)

Mechanism confirmed but the task's "shared Electron instance" wording is imprecise. Each
test gets a FRESH Electron + fresh userDataDir (orca-app.ts:133-167), so it is NOT store
pollution. The real vector is the **worker-scoped on-disk seed git repo** (testRepoPath,
scope:'worker'). `createIsolatedWorktree` materializes a real git worktree on that shared
repo (worktree-lifecycle.spec.ts:82-86 says so explicitly). When #1's removeWorktree
returns ok:false, both the test body AND the afterEach best-effort cleanup fail, leaking
a git worktree on the shared repo. The scroll test (runs later — "lifecycle" < "scroll"
alphabetically, same shard) disables all sidebar filters and attaches the same seed repo,
so git lists the leaked worktree → 3 rows vs 2. Matches CI (memory: shard10 root-caused to
selector_not_found teardown). Fixing #1 makes both removals succeed → no leak. RECOMMEND a
combined shard run to confirm empirically (only proof not run here).

## #3 parked-tab-watchers branch reorder — VERDICT: CORRECT (ship)

Reorder puts `disposersByPtyId.size > 1` (surviving sibling leaf) BEFORE the `hadPrimary`
short-circuit, so a parked split's dead leaf is collapsed out of the persisted store even
when hadPrimary=true. Sound: `hadPrimary` (pty-exit-delivery.ts:38) just means a primary
handler was registered; detach() retains it (pty-transport.ts:979-993) but the PaneManager
is destroyed while parked, so its manager.closePane writes nothing to the store — the old
hadPrimary-first path disposed without collapsing → dead PTY binding survived to reveal →
ghost pane. Exactly failure #3 (stuck 2 panes, deadPtyStillBound).

No regression to the sole-pane / whole-tab-close case: that has size===1, so the new
size>1 branch is skipped and the hadPrimary branch runs unchanged. No double-collapse:
the retained primary is a no-op vs the store (manager destroyed), and collapseParkedExitedLeaf
is idempotent — detachTerminalLayoutLeaf returns null for an already-absent leaf
(terminal-layout-leaf-detach.ts:18-19) and the `if (detached)` guard skips. Sidecar only
exists while parked (started/disposed with park/reveal), and reveal disposes it in the same
effect flush before remount, closing the both-alive window. New unit test asserts exactly
the (size>1, hadPrimary:true) case: store collapsed to the survivor leaf, only the dead
watcher disposed.

## #4 terminal-tab-close-restart-persistence assertion change — VERDICT: CORRECT (ship) [HIGH-scrutiny cleared]

Test-design bug, NOT a persistence regression papered over. The auto-create is real,
intended, established behavior: Terminal.tsx:1225-1251 `useEffect` keyed on
[workspaceSessionReady, activeWorktreeId, createTab, reconcileWorktreeTabModel] (NOT tab
count) calls `shouldAutoCreateInitialTerminal(renderableTabCount===0)` → createTab, and its
own comment says re-running on tab-count changes "would recreate a terminal immediately
after the user intentionally closed the last visible one." That's why the SAME test's
mid-session post-close assertion `toEqual([])` (line 81) still holds (worktree not
re-activated), while post-restart it doesn't (worktree re-activates → fresh "Terminal 1",
new id). Original `toEqual([])`-after-restart coupled to an unintended invariant.

The durable-close guarantee (PR #8958) is closed-tab IDENTITY, not empty list. New
assertions check exactly that on both surfaces: renderer tabs lack `closedTabId`, and
runtime `terminal.list` has no terminal with `tabId===closedTabId`. A genuine resurrection
would carry the persisted `closedTabId` and be caught; a fresh Terminal 1 has a new id and
is correctly ignored. Also more robust to auto-create timing than the old count assertion.

## #5 combined-diff-scroll-restore conditional scrollTop cap — VERDICT: RISKY-but-safe (ship)

Not hiding an anchoring regression. The real visual-anchoring invariant —
`|afterLineClick.top - afterSwitch.top| < 80` — stays UNCONDITIONAL. Only the raw
`scrollTop < 40` cap is now gated on `scrollHeight` being unchanged. Rationale is correct:
when a section above swaps estimated→measured height, Chromium native scroll anchoring
(no overflow-anchor:none here) shifts raw scrollTop specifically to keep the visible row
pinned — so scrollTop moving while `top` holds is correct, not a regression. Mirrors the
pre-existing `getLargestBackwardScrollJump` "at a stable content height" guard in the same
test. A real regression at stable height still hits the strict cap; a real visual jump
(with or without height change) still fails the unconditional `top` check.

Minor nit (non-blocking): the gate is exact `scrollHeight === scrollHeight`, so even a 1px
height delta disables the 40px cap entirely. Safe because `top` remains unconditional, but
slightly coarse; a tolerance band would be tighter. Acceptable.

## #6 focus-existing-window bounded reopen retry — VERDICT: RISKY (ship as defensive + diagnostic; causal link speculative)

Retry logic is CORRECT: `REOPEN_MAX_ATTEMPTS=3` (1 initial + 2 retries), guard
`attempt >= MAX` before scheduling → no infinite loop; 300ms injected timer; single-pane
callers see 'pending' just as before. Test-harness `makeTimer` fix (splice due entries
before invoking) is necessary and right — without it a re-scheduled same-ms entry would be
double-fired by a later run(). Unit tests cover transient-recover and give-up-after-3.

Honest caveats:
- Causation is SPECULATIVE — agent reproduced 0/16 locally. A swallowed openWindow() throw
  is a *plausible* cause of the 60s firstWindow timeout, but the real CI flake may be
  elsewhere (second-instance handler not firing, CDP attach, etc.). The forwarded logs
  (test-side + exported forwardElectronProcessLogs) are the genuine value: next CI failure
  will leave a trail. Change is low-risk and defensive regardless.
- PR-NOTE: confirm `openWindow()` is safe to call again after a throw — if a throwing
  attempt can leave a partially-created/registered window, the retry could double-open
  (openWindowWithRetry re-calls openWindow() directly, not getWindow()). If openWindow is
  idempotent/singleton this is fine.
- Minor: a retry-recovered window skips the win32 moveTop/pulseAlwaysOnTop/retryFocus that
  the synchronous path runs (function already returned 'pending'). Cosmetic on the rare
  retry path.

---

### Ship recommendation per fix
1 CORRECT · 2 CORRECT(transitive; recommend combined shard run) · 3 CORRECT · 4 CORRECT ·
5 CORRECT (minor nit) · 6 SHIP as defensive+diagnostic (verify openWindow re-entrancy at PR).
