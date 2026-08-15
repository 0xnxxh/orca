# STA-4407 — Independent reproduction: unbounded pending-handle poll

**VERDICT: REPRODUCED.** Measured, not inferred.

A focused, foregrounded mobile session whose active tab is a `pending-handle` terminal
issues `session.tabs.list` **every 2 seconds forever** — no age cap, no attempt cap, no
backoff, no give-up. Measured: **1800 requests over a simulated hour, first at t=2000ms,
last at t=3,600,000ms, every gap exactly 2000ms, zero decay.**

## The measured run

Harness: `mobile/src/session/sta-4407-unbounded-pending-handle-poll.test.ts` (committed on
branch `brennanb2025/sta-4407-repro` in the repro worktree).

Command (from `mobile/`):

```
./node_modules/.bin/vitest run --config vitest.config.ts sta-4407-unbounded-pending-handle-poll --reporter=verbose
```

Output:

```
 ✓ src/session/sta-4407-unbounded-pending-handle-poll.test.ts > STA-4407: unbounded pending-handle poll (controller) > fires session.tabs.list every 2s for a full simulated hour with zero decay 48ms
 ✓ src/session/sta-4407-unbounded-pending-handle-poll.test.ts > STA-4407: unbounded pending-handle poll (controller) > parks the poll once a list response materializes the handle 58ms
 ✓ src/session/sta-4407-unbounded-pending-handle-poll.test.ts > STA-4407: unbounded pending-handle poll (hook wiring) > fires session.tabs.list every 2s for a full simulated hour with zero decay 47ms
 ✓ src/session/sta-4407-unbounded-pending-handle-poll.test.ts > STA-4407: unbounded pending-handle poll (hook wiring) > stops the cadence once a stream update materializes the handle 60ms
 ✓ src/session/sta-4407-unbounded-pending-handle-poll.test.ts > STA-4407: unbounded pending-handle poll (hook wiring) > parks immediately when the active terminal already has a handle 30ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Anti-vacuousness guards (all real code, no stubbed `true`):

- `hasRecoveryNeed` is the real `hasPendingTerminalHandleRecoveryNeed` fed by real
  `MobileSessionTab` shapes (`terminal: null`, `status: 'pending-handle'`).
- The apply path uses the real `acceptSessionSnapshot` gate (equal versions are
  re-processed, so repeated identical list responses keep the pending state alive — this
  is why the state cannot clear on its own) plus the route's active-tab derivation and
  application-revision tracking.
- `health` is driven `'live'` through real stream payloads (`snapshot` + `updated`),
  asserted via `isCertified()`.
- Counts AND timestamps are asserted: 1800 requests, `times[0] === 2000`,
  `times[1799] === 3_600_000`, every consecutive gap exactly 2000ms.
- Sanity control: same harness with a ready terminal (`terminal: 'term-1'`) → **0**
  requests over an hour while `fetchTerminals` still ticks 1800× (interval alive).
- Flip control: pending → 1 hour (1800 requests) → handle materializes in a list/stream
  payload → exactly **one** more request (to learn the handle) then permanent silence.

## Where the bound is missing

- `mobile/src/session/mobile-session-tabs-stream-health.ts:87-98` — `poll()`.
  The park condition (lines 89-96) requires `!hasRecoveryNeed()`; while the active tab is
  a pending-handle terminal the OR-clause fails and line 97 (`ensureReconciliation()`)
  fires `session.tabs.list` (line 237-239) on every tick. No attempt counter exists
  anywhere in the controller.
- `mobile/src/session/use-mobile-session-tabs-reconciliation.ts:131` —
  `const interval = setInterval(() => refresh(false), 2000)` with no cap;
  `refresh` (111-123) calls `controller.poll()` unconditionally while foregrounded.
- `mobile/app/h/[hostId]/session/[worktreeId].tsx:2283-2296` (line 2290) — ORs
  `hasPendingTerminalHandleRecoveryNeed(sessionTabsRef.current, activeSessionTabIdRef.current)`
  into `hasRecoveryNeed`, and `applySessionTabs` (1677-1832) keeps the pending tab and its
  active id in refs, so the need persists across every accepted response.

## Boundary conditions the fix must preserve (what stops it today)

Verified by existing tests plus this harness:

1. **Backgrounding** — `AppState.currentState !== 'active'` →
   `controller.setReconciliationActive(false)` (use-mobile-session-tabs-reconciliation.ts:112-114);
   also the AppState change listener (124-130) and focus cleanup (133-137).
2. **Route blur / unmount** — focus-effect cleanup sets reconciliation inactive (line 134).
3. **Handle materialization** — a snapshot/list/stream payload where the active terminal
   has `terminal: <string>` flips the predicate false → `poll()` parks. (One trailing
   request to learn the handle, then silence — measured.)
4. **Tab switch away** from the pending terminal — active id changes → predicate false.
5. **Disconnect** — `connState !== 'connected'` disables the effect and subscription.

None of these bound the *duration* of polling — they only stop it when the situation
changes. While the pending-handle tab stays active and foregrounded, the loop is infinite.

## Notes

- The optional end-to-end iOS-simulator observation was **not attempted**: it needs a
  paired live host plus the emulator QA skill; the counted harness is the required
  deliverable and is complete. No code was fixed; no PR opened; the fixer's branch
  untouched.
- The bug is a regression of the STA-4256 fix (PR #14623): the recovery-need predicate
  added there is never bounded, so a host that never mints the handle (or mints it without
  republishing) leaves the phone polling `session.tabs.list` every 2s indefinitely.
