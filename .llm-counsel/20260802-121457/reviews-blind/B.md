# Anonymized report B

# Branch review — `stop-keep-reconnecting-to-remote` (seat: [reviewer])

**Scope reviewed:** `0ae9174408..HEAD` (no commits on branch) **plus all uncommitted + untracked changes**.
10 modified files, 2 new untracked files (`src/main/ssh/ssh-auto-reconnect-budget.{ts,test.ts}`).

**Gates run (read-only):**
- `vitest run src/main/ssh/ssh-auto-reconnect-budget.test.ts src/main/ssh/ssh-connection.test.ts src/main/ipc/ssh.test.ts` → **181 passed / 3 files passed**
- `vitest run --config config/vitest.config.ts src/renderer/src/components/terminal-pane/pty-connection.test.ts` → **538 passed**
- `oxfmt --check -c .oxfmtrc.json <9 changed files>` → clean

**Verdict:** the core mechanism is sound and correctly target-scoped (the branch's central insight — that a connection-scoped bound can never stick because `SshConnectionManager.connect()` discards and rebuilds the connection — is right and well-tested). But the branch **does not fully deliver its claim** (the initial-connect path is entirely unbounded, H4) and it **introduces four high-severity recovery regressions**: a 61-second outage permanently disables SSH auto-reconnect for the life of the process, only two attempts survive on the exact failure mode being targeted, and sleep/wake recovery (#7773) is defeated.

**Findings: 4 High, 4 Medium, 4 Low. Top severity: High.**

---

## Key constants (used throughout)

| Constant | Value | Source |
|---|---|---|
| `AUTO_RECONNECT_BUDGET_MS` | **60_000** | `ssh-auto-reconnect-budget.ts:10` |
| `CONNECT_TIMEOUT_MS` | **30_000** | `ssh-connection-utils.ts:38` |
| `INITIAL_RETRY_ATTEMPTS` / delay | **5** / 2_000 | `ssh-connection-utils.ts:35-36` |
| `RECONNECT_BACKOFF_MS` | `[1s,2s,5s,5s,10s,10s,10s,30s,30s]` (9 entries) | `ssh-connection-utils.ts:37` |
| `DEFAULT_BOUNDED_SSH_RELAY_GRACE_PERIOD_SECONDS` | **24 h** | `shared/ssh-types.ts:6` |

---

## H1 — A 61-second outage permanently disables SSH auto-reconnect for the process lifetime (High)

**Files:** `src/main/ssh/ssh-auto-reconnect-budget.ts:34-37`, `src/main/ssh/ssh-connection.ts:1283-1285`, `src/main/ipc/ssh.ts:993-1008`

`isExhausted()` has no expiry, and the only two things that clear the window are (a) a successful `attemptConnect` and (b) a `'user'`-initiated `ssh:connect`. Once paused, **nothing in the product ever retries**, so (a) can never happen. The branch's own test pins this as intentional (`ssh-auto-reconnect-budget.test.ts:46-52`, "does not expire the pause on its own", asserted at 24 hours).

**Failure scenario (routine, not exotic):** a remote host reboots (typically 30–120 s), sshd is restarted, a VPN re-establishes, or Wi-Fi roams between APs. At T+60 s Orca gives up. The host is back at T+90 s. Every SSH workspace, terminal, agent pane and automation on that host stays dead until a human opens the desktop app and clicks Connect — **for as long as the app runs** (Orca desktop sessions run for days/weeks).

**Why this is a regression, not just a policy choice:** it contradicts the surrounding system's own design assumptions.
- The remote relay defaults to a **24-hour** bounded grace (`shared/ssh-types.ts:6`) precisely so a user can lose the link and come back to live remote PTYs. Orca now stops trying 60 seconds into an outage the remote side is prepared to survive for a day.
- `SshReconnectLadder` deliberately caps flap delays at `FLAP_DELAY_CAP_MS` so a reconnect lands *inside* relay grace (`ssh-reconnect-ladder.ts:12-20`). That machinery is now moot past 60 s.
- Previously the ladder gave 9 handshake failures before `reconnection-failed`.

**Suggested fix:** keep the pause (it is the right idea) but re-arm it on a slow schedule — e.g. a single long-interval, zero-cost TCP/`connect`-probe every 5–15 min, or expire the window after N minutes. That preserves "no busy loop" while not requiring a human to be sitting at the machine.

---

## H2 — Only **two** reconnect attempts survive on the exact failure mode this targets (High)

**Files:** `src/main/ssh/ssh-connection.ts:1277-1307` (budget check + delay clamp), `ssh-connection-utils.ts:37-38`

An unreachable host (packet black hole — `ETIMEDOUT`, the case named in the branch's own test at `ssh-connection.test.ts:572`) fails each attempt only after `CONNECT_TIMEOUT_MS` = 30 s. Trace against a 60 s budget:

```
t=0      drop → scheduleReconnect → window opens, deadline = 60_000; delay = min(1000, 60000) = 1000
t=1_000  attempt #1 → times out at t≈31_000 → not exhausted (31k<60k); delay = min(2000, 29_000) = 2000
t=33_000 attempt #2 → times out at t≈63_000 → 63k ≥ 60k → EXHAUSTED → paused permanently
```

**Two** retries, versus **nine** before. Anything that takes longer than ~63 s to come back is never auto-recovered. (For a *fast*-failing host — instant `ECONNREFUSED` — ~8 attempts still fit, so the effective retry count now silently depends on how the host fails.)

**Evidence of lost coverage:** the branch replaced the exact-count assertion with an inequality:
```diff
-      expect(connectAttempts).toBe(1 + RECONNECT_BACKOFF_MS.length)
+      expect(connectAttempts).toBeLessThan(1 + RECONNECT_BACKOFF_MS.length)
```
(`ssh-connection.test.ts:582-590`). The old assertion's comment — "Counting a failure twice, or giving up early, would strand a user on a flaky link" — was the guard against exactly this. Nothing now pins how many attempts a user actually gets; a future `CONNECT_TIMEOUT_MS` bump to 40 s would silently reduce this to **one** attempt with all tests still green.

---

## H3 — Sleep/wake: the budget burns while the process is suspended, and the resume handler now skips reconnect entirely (High)

**Files:** `src/main/ipc/ssh.ts:576-579`, `src/main/ssh/ssh-connection.ts:1280-1285`

`isExhausted` compares raw `Date.now()` deltas, so **wall-clock time in which Orca made zero attempts still spends the budget** — including time the process is suspended by the OS.

**Failure scenario:** Wi-Fi drops as the lid closes → the `close`/`error` handler (`ssh-connection.ts:1259-1274`) calls `scheduleReconnect()`, which **opens the window at T** and arms a 1 s timer. The machine suspends. It resumes 8 hours later:
1. The pending `setTimeout` fires immediately on wake; `runReconnectAttempt` runs before the network stack is up and fails — which is exactly why `RESUME_PROBE_ATTEMPTS = 2` with a retry exists (`ssh.ts:546-547`, #7773). `scheduleReconnect` then sees 8 hours of "spent budget" → **permanent pause**.
2. The new guard at `ssh.ts:576-579` makes the `powerMonitor` `'resume'` handler `continue` for that target, so `isRelayLinkAliveAfterResume()` + `manager.reconnect(targetId)` — the whole #7773 wake-recovery path — never runs either.

Net effect: **after any overnight/lunch sleep where the drop was noticed before suspend, every SSH workspace is parked and needs a manual click.** The comment on the guard ("a laptop that wakes near a dead host does no SSH work at all") is true, but so is the inverse: a laptop that wakes near a *healthy* host also does no SSH work.

**Suggested fix:** treat a wake as a new outage epoch — call `sshAutoReconnectBudget.reset(targetId)` in `onResume` before the liveness probe (or measure attempts / active retry time rather than raw `Date.now()` deltas).

---

## H4 — The initial-connect path is completely unbounded: the branch claim is only half delivered (High)

**Files:** `src/main/ssh/ssh-connection.ts:604-655` (`connect()`), `:1287` (`deadlineFor` — the only production call site), `src/main/ipc/ssh.ts:991-1008`

The budget window is opened **only** by `scheduleReconnect()`. `SshConnection.connect()` fails by *throwing* (`ssh-connection.ts:653-655`) and never calls `scheduleReconnect()`; there is no `setupDisconnectHandler` on a client that never reached `ready`. Therefore **a target that has never connected in this app session never opens a budget window, and `isExhausted` is permanently `false` for it.**

**Failure scenario — the most common "Orca keeps reconnecting to a dead remote":** the remote host is gone (VM deleted, laptop off the corp network, host decommissioned) and Orca is restarted, or the target simply never came up this session. Then:
- App startup auto-reconnect (`App.tsx:1024-1029`) → `connectTarget(..., 'auto')` → not exhausted → full `doConnect`.
- `connectionManager.connect()` → `SshConnection.connect()` → `INITIAL_RETRY_ATTEMPTS = 5` attempts, each up to `CONNECT_TIMEOUT_MS = 30 s`, plus 2 s sleeps ≈ **160 s of SSH work per call**.
- Every SSH pane remount (`pty-connection.ts:852-856`), every automation dispatch (`useAutomationDispatchEvents.ts:171`), every renderer reload repeats it, forever. `connectInFlight` dedupes only *concurrent* calls.

**Evidence:** the new IPC test cannot reach the parked branch through product behavior — it has to synthesize the window by hand:
```ts
sshAutoReconnectBudget.deadlineFor('ssh-1', Date.now() - AUTO_RECONNECT_BUDGET_MS)
```
(`ssh.test.ts:598`, `:624`). No production path opens a window on a failed connect.

**Suggested fix:** charge the window on failed connects too — e.g. call `sshAutoReconnectBudget.deadlineFor(targetId, Date.now())` at the top of the `initiator === 'auto'` branch in `connectTarget` (opening the window on the first automatic connect), and/or in `SshConnection.connect()`'s terminal failure path.

---

## M1 — Unattended automations become permanently unavailable with no re-arm path (Medium)

**File:** `src/renderer/src/hooks/useAutomationDispatchEvents.ts:168-186`

The dispatch connect is now marked `'auto'`, so after a give-up it returns the paused state and the handler throws `'SSH target is unavailable.'` → `markDispatchResult({ status: 'skipped_unavailable' })`. **Nothing in the automation path can ever re-arm the budget** (only a desktop `'user'` connect or a successful connection can, and per H1 no connection will be attempted). A 61-second blip at 03:00 kills every remaining scheduled run against that host until a human opens the app. Combined with H1/H3 this is the most user-visible consequence of the branch.

At minimum this is a behavior change that should be called out in the PR body; ideally scheduled automations get their own re-arm (a scheduled run is arguably closer to "the user asking" than a pane remount is).

---

## M2 — The paused state is broadcast-only, and its message never reaches the user (Medium)

**Files:** `src/main/ipc/ssh.ts:993-1008`, `src/main/ipc/ssh.ts:392-395`, `src/renderer/src/components/terminal-pane/TerminalSshReconnectOverlay.tsx:38-53`

(a) **Not authoritative.** The early return `broadcastSshState(...)`s a `reconnection-failed` state but never writes it into `connectionManager`. A subsequent `ssh:getState` / `getPublicSshState` returns whatever the connection object holds — which is `'disconnected'`, or `undefined` if the manager deleted the connection after a failed connect (`ssh-connection-manager.ts:50-53`). A renderer that re-reads state (new window, paired client sync, `useAutomationDispatchEvents.ts:167`) sees a different status than the one that was pushed.

(b) **Message is dropped by the pane UI.** `TerminalSshReconnectOverlay` derives its copy purely from `status` and ignores `state.error` entirely (`:47-52`): a paused target renders *"The SSH connection to X failed. Connect again to continue this terminal session."* — identical to any other error, with no hint that Orca has **stopped trying**. `AUTO_RECONNECT_PAUSED_MESSAGE` is the branch's whole UX premise and it never reaches the primary surface.

---

## M3 — The exhausted check runs before the live-connection fast path, so a stale window can park a healthy session (Medium)

**File:** `src/main/ipc/ssh.ts:991-1008` (runs before `awaitTargetLifecycle` and before `doConnect`'s live-session fast path at `:1078-1090`)

The parked branch fires purely on `isExhausted`, with no check that the target is actually down. It also actively `clearRelayLostBackoff` + `clearRelayStateOverride` and publishes `reconnection-failed`, so a false positive doesn't just fail a connect — it tears the pane's reattach out from under a live relay and wipes the relay's own recovery state.

The budget is only cleared at two sites (`ssh-connection.ts:619`, `:1321`), both of which require a successful `attemptConnect`. Paths that leave a **stale open window**:
- `runReconnectAttempt` succeeds but is superseded — `:1315-1317` returns **before** `markConnected`/`reset`.
- `SshConnection.disconnect()` (`:1425-1450`) resets the ladder but **not** the budget; likewise `ssh:resetRelay` and `ssh:terminateSessions`. A user-driven reset while a window is open leaves it armed; 60 s later an automatic pane remount is parked.

Cheap defenses: return early only when there is no live `connected` session for the target, and call `sshAutoReconnectBudget.reset()` from the disconnect/reset-relay paths.

---

## M4 — Contract gap: paired clients (mobile, `orca serve`, runtime environments) cannot mark a connect as `'auto'` (Medium)

**Files:** `src/main/runtime/rpc/methods/ssh.ts:28-38`, `src/main/ipc/ssh.ts:99-104`, `src/renderer/src/runtime/runtime-environment-ssh-state.ts:178-196`

`connectRegisteredSshTarget(targetId)` takes no initiator and therefore uses the `'user'` default — it **resets the budget**. Every `ssh.connect` RPC from a paired mobile client, a `orca serve` web client, or a nested runtime environment re-arms automatic retries. Today the only mobile caller is user-driven (`mobile/src/components/NewWorktreeModal.tsx:536`), so this is latent rather than live — but the preload contract grew an `initiator` param while the RPC schema (`params: SshTarget`) did not, so the give-up is silently defeatable on paired setups and will drift the first time a client adds an automatic reconnect.

---

## L1 — The ladder's give-up arm is now dead code (Low)

`ssh-connection.ts:1288-1292` (`'Max reconnection attempts reached'`) is unreachable with a 60 s budget: nine consecutive failed handshakes cannot fit (the delay table alone sums to 103 s). `SshReconnectLadder`'s documented contract — "`reconnection-failed` stays reachable exactly after `RECONNECT_BACKOFF_MS.length` failed handshakes" (`ssh-reconnect-ladder.ts:26-31`) — is no longer exercised end to end. Either delete the arm or state that it is a lower bound retained for a configurable budget.

## L2 — Unthrottled broadcast fan-out on the "costs nothing" path (Low)

`ssh.ts:1006` broadcasts on **every** parked auto-connect: `webContents.send('ssh:state-changed')` plus `currentRuntime?.notifySshStateChanged` to every paired client, each going through `withSshRemotePlatform` (authority + platform lookups). A window restore or layout change that remounts N SSH panes emits N identical `reconnection-failed` pushes. Negligible next to the SSH work it replaces, but the branch's stated goal for this path is "zero cost" (`ssh.test.ts:606`), and this is the one thing it still does per call. A cheap dedupe (skip the broadcast if the last published state for the target is already this paused state) would make that claim literal.

## L3 — Budget entries are never removed on target deletion (Low)

`ssh:removeTarget` does not call `sshAutoReconnectBudget.reset(targetId)`, so `windowStartedAtMs` retains an entry per target id ever seen (trivial memory, but unbounded across a long session with many ephemeral/runtime-owned targets). More concretely: a target removed while paused and later re-adopted under the same id (`ssh:importConfig({ reAdopt: true })`) comes back **already paused**.

## L4 — The new pane-side failure gate changes behavior beyond the branch's scope, asymmetrically (Low)

`pty-connection.ts:815-819` + `:857-863`. `doConnect` returns `getPublicSshState(targetId)` (`ssh.ts:1214`), which **prefers `relayStateOverrides`**. `setOnTerminalRelayError` publishes status `'error'` (`ssh.ts:717-727`) and can land between the `connected` broadcast and that return. In that race the pane now aborts the reattach (`reportError`) instead of proceeding as it always has. Conversely a relay-lost `'reconnecting'` override is *not* in `SSH_CONNECT_FAILED_STATUSES`, so the pane still reattaches into a relay that is mid-redeploy. If the intent is only to catch the new paused state, gating on `status === 'reconnection-failed' && error === AUTO_RECONNECT_PAUSED_MESSAGE` (or a dedicated field) would avoid changing the relay-error path at all.

---

## What I checked and found clean

- **No new timers, listeners or unbounded buffers.** The budget is one `Map<string, number>` with one entry per target; `reset()` deletes on success. No new `setTimeout`/`setInterval`, no new IPC channels, no listener registration.
- **No busy reconnect loop from the delay clamp.** `Math.min(decision.delayMs, Math.max(0, deadlineMs - nowMs))` (`ssh-connection.ts:1295`) cannot produce a 0 ms delay: `isExhausted` uses `>=`, so a non-exhausted window guarantees `deadline - now ≥ 1` ms, and the clamp only ever *lowers* the delay. Worst case is one final attempt fired up to 30 s early — one extra attempt, not a loop.
- **No double-reconnect storm.** The parked path returns before `connectInFlight`/`awaitTargetLifecycle`, so it cannot interleave with an in-flight connect; the `'user'` reset happens before any await, so it cannot be lost to a race.
- **Dispose path unchanged.** `scheduleReconnect`'s `this.disposed || this.reconnectTimer` guard, the timer-clear in `disconnect()`, and generation fencing are untouched; the budget check is a pure read added ahead of them.
- **Relay-lost loop still terminates.** `'reconnection-failed'` is already in `TRANSPORT_TERMINAL_STATUSES` (`ssh.ts:322-327`), so a paused transport clears the relay redeploy loop rather than leaving it re-arming at `RELAY_LOST_MAX_DELAY_MS`.
- **Preload/IPC contract is backward compatible.** `initiator` is optional at every layer and defaults to `'user'` (`ssh.ts:1060`, `preload/index.ts:4398-4404`, `api-types.ts:3409-3413`), so unmarked callers keep the pre-existing behavior. All 11 renderer `ssh.connect` call sites were checked: the 9 left unmarked are genuinely user-initiated (Connect buttons, add-repo, composer send, workspace create, settings pane, status row, disconnect dialog) and correctly re-arm the budget; the recovery affordance exists for `reconnection-failed` (`TerminalSshReconnectOverlay.tsx:35`, `SshDisconnectedDialog.tsx:76`).
- **Test-isolation hazard handled.** The process-wide singleton is cleared in both `resetSshHandlerStateForTests` (`ssh.ts:1537`) and `ssh-connection.test.ts:352-354`; without those, one test's exhausted window would suppress reconnects in every later test on the same target id. Good catch by the author.
- **Formatting/tests:** `oxfmt --check` clean on all 9 changed files; 181 + 538 tests pass. Two unrelated formatting-only hunks in `ssh-connection.test.ts:1853-1915` are noise but harmless.

---

## Recommended minimum before merge

1. **H4** — open the budget window on failed automatic connects, or the branch does not fix its headline case (dead host + app restart / pane remounts).
2. **H3** — `reset()` on `powerMonitor` `'resume'`; do not count suspended wall-clock as spent budget.
3. **H1/H2** — either raise the budget above `CONNECT_TIMEOUT_MS × 3` (so the "unreachable host" case gets more than two tries) or add a slow re-arm so the pause is recoverable without a human. As written, a 61-second outage is a permanent, human-only-recoverable failure.
4. **M2(b)** — surface `AUTO_RECONNECT_PAUSED_MESSAGE` in `TerminalSshReconnectOverlay`; otherwise the user is never told that Orca stopped trying.