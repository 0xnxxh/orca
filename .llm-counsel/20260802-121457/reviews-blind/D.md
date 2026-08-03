# Anonymized report D

# Review: stop endless SSH auto-reconnect (auto-reconnect budget)


## Verdict

The core mechanism is sound and well-tested for the desktop happy path: the budget is
correctly target-scoped (so it survives `SshConnectionManager` rebuilding the connection —
the exact hole that made the old ladder give-up unreachable), it resets on every successful
handshake and on user-initiated connects, the IPC-layer park is genuinely zero-cost, and the
relay-lost loop keeps its own separate bound. All 181 main-process SSH tests, all 538
pty-connection tests, and `typecheck` (node/cli/web projects) pass.

However, the branch claim ("stop keep reconnecting") is **falsified for paired/web clients**
(F1: the runtime RPC drops `initiator`, so every remote pane remount re-arms the budget and
launches a full connect storm), and two design consequences look like real functional
regressions against today's behavior: sleep/wake recovery is lost whenever an outage brackets
a sleep (F2), and the pause never self-heals after the host recovers, which permanently breaks
unattended flows like automation dispatch until a human clicks Connect (F3/F4).

## Findings

### F1 — HIGH (functionality regression / claim falsified): runtime RPC drops `initiator`, paired clients reset the budget and re-launch full connect storms
- **Files:** `src/renderer/src/web/web-preload-api.ts:3238-3244`, `src/main/runtime/rpc/methods/ssh.ts:28-37`, `src/main/ipc/ssh.ts:99-104`, `src/main/ipc/ssh.ts:982-993`
- **Evidence:** The web client's `window.api.ssh.connect` implementation forwards only
  `{ targetId: args.targetId }` over runtime RPC — the `initiator` field the shared renderer
  code now sends (`pty-connection.ts:854`, `useAutomationDispatchEvents.ts:171`) is silently
  dropped. The RPC schema (`z.object({ targetId })`) can't carry it either, and the handler
  calls `connectRegisteredSshTarget(targetId)` → `connectTarget(targetId)` whose default is
  `'user'` → `sshAutoReconnectBudget.reset(targetId)` at `ssh.ts:993`.
- **Failure scenario:** Host goes down; desktop correctly parks after 60s. A paired web/mobile
  client is open on the same workspace. Its SSH pane remount calls `ssh.connect` with
  `initiator: 'auto'` → arrives at the hub as `'user'` → budget reset → full
  `SshConnection.connect()` with `INITIAL_RETRY_ATTEMPTS = 5` × `CONNECT_TIMEOUT_MS = 30s`
  against the dead host, every remount, forever. The desktop's parked
  `'reconnection-failed'` broadcast is also overwritten by the new `'connecting'` states, so
  the desktop UI flips out of the paused state the branch is supposed to guarantee. The
  endless-reconnect loop this branch exists to kill is fully alive whenever any paired client
  is attached.
- **Fix direction:** add `initiator` to the RPC schema + `connectRegisteredSshTarget`
  signature, and thread it in `web-preload-api.ts`. Internal main-process callers
  (`ephemeral-vm-runtime-ssh.ts:31`) should pass an explicit value too.

### F2 — HIGH (functionality regression): wall-clock budget counts time asleep; resume handler hard-skips, reversing #7773 wake recovery
- **Files:** `src/main/ssh/ssh-auto-reconnect-budget.ts:34-37`, `src/main/ipc/ssh.ts:576-580`, `src/main/ssh/ssh-connection.ts:1283-1285`
- **Evidence:** `isExhausted` compares raw `Date.now()` deltas, so time during which no retry
  could possibly run (system sleep) consumes the budget. The new resume-handler guard
  (`ssh.ts:578`) then `continue`s without even running `isRelayLinkAliveAfterResume`, and any
  pre-sleep `reconnectTimer` that fires at wake gets exactly one attempt
  (`runReconnectAttempt` has no budget check) racing NIC bring-up before
  `scheduleReconnect` parks at `ssh-connection.ts:1283`.
- **Failure scenario:** Wifi drops (or the user closes the lid mid-outage) → `close` fires →
  `scheduleReconnect` opens the 60s window → machine sleeps 10 minutes → wake on a working
  network. Budget reads exhausted purely from sleep time; the resume path skips the target;
  the one leftover timer attempt typically fails because wifi hasn't re-associated yet; every
  SSH workspace is parked with "The SSH host is unreachable" even though the host is fine.
  Before this branch, the #7773 resume probe + ladder reconnected automatically. Same shape:
  budget exhausted pre-sleep, host recovers during sleep → wake does nothing at all.
- **Fix direction:** clock the budget in "awake time" (e.g. re-open/extend the window on
  `powerMonitor` resume), or treat resume as a budget reset — waking near a *recovered* host
  is precisely when one cheap probe is worth it.

### F3 — HIGH (stopping too early + never self-healing; product-level): 60s budget yields ~2 real attempts for a black-holing host, and the pause never expires
- **Files:** `src/main/ssh/ssh-auto-reconnect-budget.ts:10`, `src/main/ssh/ssh-connection-utils.ts:35-38`
- **Evidence:** `AUTO_RECONNECT_BUDGET_MS = 60_000` while `CONNECT_TIMEOUT_MS = 30_000` and
  the ladder's delays alone sum to 103s. For an ETIMEDOUT-style outage: attempt 1 at t≈1s
  times out at t≈31s, attempt 2 starts t≈33s and times out past the deadline → parked after
  **2** attempts (the old behavior ran 9). The budget test suite pins that the pause never
  expires (`'does not expire the pause on its own'`), and the only resets are a successful
  handshake or a `'user'` connect.
- **Failure scenario:** Any blip longer than 60s — router reboot, VPN re-auth, ISP flap,
  remote host restart — permanently converts every SSH workspace on that target into a manual
  Connect click. Previously the (buggy but user-visible) remount-driven retry meant Orca
  always eventually reconnected once the host returned. Unattended setups are hit hardest:
  overnight scheduled automations against a host that blipped once at 2am fail until a human
  intervenes (`useAutomationDispatchEvents.ts:171-177` now throws
  "SSH target is unavailable." from the parked state without any SSH work — even when the
  host has long since recovered).
- **Fix direction:** this is the intended trade, but the parameters undermine it: budget
  should exceed one full ladder pass (≥ ~5 min), and/or decay the pause (re-open a window
  after N minutes, or on network-change/resume events) so recovery doesn't require a human.

### F4 — MEDIUM (wrong budget accounting across connection lifecycle): stale exhausted window survives disconnect/removal
- **Files:** `src/main/ssh/ssh-connection.ts:1426-1453` (`disconnect()` — no budget reset), `src/main/ipc/ssh.ts:993` (only `'user'` *connects* reset)
- **Evidence:** Nothing clears a target's window on explicit disconnect, target removal, or
  dispose; the only resets are a successful handshake and a `'user'` connect. `deadlineFor`
  opened the window at the first `scheduleReconnect` of an outage.
- **Failure scenario:** Outage opens the window at t0; user clicks **Disconnect** at t0+30s
  (a clean, deliberate stop — no give-up ever happened); host recovers. Hours later an
  automation dispatch or a reopened workspace's pane remount issues an `'auto'` connect →
  `isExhausted` is true (the 60s elapsed ages ago) → parked with "The SSH host is
  unreachable. Automatic reconnect is paused" — a false statement produced without a single
  probe, and the dispatch fails. The paused broadcast also paints `'reconnection-failed'`
  over a target whose real state is `'disconnected'`, while a later `ssh:getState`
  (`getPublicSshState`, `ssh.ts:391-394`) reports the connection-manager state again —
  the two disagree.
- **Fix direction:** `sshAutoReconnectBudget.reset(targetId)` in `ssh:disconnect`,
  `removeTarget`, and runtime-owned target teardown.

### F5 — MEDIUM (defense-in-depth / claim only holds at the IPC boundary): `reconnect()` and initial `connect()` never consult the budget
- **Files:** `src/main/ssh/ssh-connection.ts:868-882` (`reconnect()`), `src/main/ssh/ssh-connection.ts:605-656` (`connect()`)
- **Evidence:** `reconnect()` calls `runReconnectAttempt()` with no exhausted check — the
  branch's own test pins "one failed try, then parked" for a replacement connection.
  `connect()` runs up to `INITIAL_RETRY_ATTEMPTS = 5` transient retries (each up to 30s) with
  no budget consult and never opens a window (windows only open in `scheduleReconnect`). The
  zero-cost park exists solely in `connectTarget` (`ssh.ts:994`).
- **Failure scenario:** Any caller that reaches the manager without going through
  `connectTarget`'s auto-gate gets the full storm on an exhausted target — today that is the
  runtime RPC path (F1) and `connectRuntimeOwnedSshTarget`; tomorrow it is whatever new
  internal caller someone adds. Also, for a host that is down *from the start* (never
  handshakes), the window never opens at all, so repeated auto connects each burn up to
  5 × 30s of SSH work indefinitely — the "stop" only covers the established-then-dropped
  case.
- **Fix direction:** consult/park inside `SshConnection.connect()`/`reconnect()` (or in
  `SshConnectionManager.connect`) so the bound holds regardless of entry point, and open the
  window on failed initial connects too.

### F6 — LOW (UX): user recovery actions other than Connect don't re-arm
- **Files:** `src/main/ipc/ssh.ts:1323-1330` (`ssh:resetRelay`), `src/main/ipc/ssh.ts:1218` (`ssh:disconnect`)
- **Evidence:** Only `ssh:connect` with default initiator resets the budget. "Reset relay" —
  an explicit user recovery gesture on the target — leaves the target parked; the follow-up
  auto connect from the pane still returns the paused state. Overlaps F4's fix.

### F7 — LOW (message/i18n consistency): `AUTO_RECONNECT_PAUSED_MESSAGE` is raw English in the state channel
- **File:** `src/main/ssh/ssh-auto-reconnect-budget.ts:12-13`
- **Evidence:** The string rides `SshConnectionState.error` into renderer overlays and
  automation errors untranslated. Pre-existing errors on this channel ("Max reconnection
  attempts reached") have the same shape, so this matches local convention — noting only
  because this one is a *directive* ("use Connect to retry") the UI surfaces prominently,
  including on clients (mobile/web) that may not render a Connect affordance for hub targets.

## Explicitly checked and found sound

- **Park is zero-cost at the IPC layer:** exhausted auto `connectTarget` returns before
  `awaitTargetLifecycle`/`connectInFlight`/`doConnect`; no manager call, no session churn
  (`ssh.ts:994-1009`). The ipc test asserts `connect` is never called.
- **Budget resets on both success paths** (`connect()` at `ssh-connection.ts:619`,
  `runReconnectAttempt` at `:1321`) and reset placement is after a real handshake, so the
  system-ssh probe's cosmetic 'connected' can't re-earn budget. `connectViaSystemSsh` skips
  the reset but has no production callers.
- **No double-reconnect storms:** single `reconnectTimer` guard unchanged; delay clamp
  (`Math.min(decision.delayMs, remaining)`) can shorten only the final wait, producing at
  most one tail attempt — no busy loop at the deadline (verified against fast-failing
  ECONNREFUSED: ~8 bounded attempts, then park).
- **Relay-lost loop independence:** the relay redeploy loop keeps its own bounded
  attempts/backoff and calls `session.reconnect`, never `connectTarget`, so it neither
  bypasses nor re-arms the budget; the parked path clears its backoff + override so the
  paused state isn't masked (`ssh.ts:999-1000`, matching the `getPublicSshState` precedence).
- **All user-facing Connect surfaces default to `'user'`** (reconnect overlay, SshPane,
  status row, disconnected dialog, composer, automations-page source connect) — correct
  re-arm semantics; renderer callers that are genuinely automatic (startup reconnect,
  pane remount, automation dispatch) are marked `'auto'`.
- **Renderer failed-status handling:** `ssh:connect` rejects on real connect failures
  (`doConnect` throws), so the new `SSH_CONNECT_FAILED_STATUSES` check in
  `waitForSshConnection` only intercepts resolved terminal states (chiefly the parked one) —
  in-flight `'connecting'`/`'deploying-relay'` still resolve to a reattach as before, and the
  connect promise is deleted in `finally`, so a later user Connect lets panes retry.
- **Test isolation:** singleton cleared in `resetSshHandlerStateForTests` and in the
  connection suite's `beforeEach`; ipc suite resets in `beforeEach` (line 344).
- **No leaks/timers added:** no new listeners; one extra Map lookup + a longer `console.warn`
  per schedule — negligible.
- **Gates:** `vitest` — ssh-auto-reconnect-budget + ipc/ssh + ssh-connection: 181 passed;
  pty-connection (project config): 538 passed. `npm run typecheck` (node, cli, web): clean.

## Summary ranking

| # | Severity | One-liner |
|---|----------|-----------|
| F1 | High | Runtime RPC drops `initiator`; paired clients re-arm the budget + full connect storm (claim falsified) |
| F2 | High | Budget counts sleep time; resume handler skips → wake recovery regressed vs #7773 |
| F3 | High | 60s budget ≈ 2 attempts vs old 9; pause never expires → any >60s blip needs a human, breaks unattended automations |
| F4 | Medium | Exhausted window survives clean disconnect/removal → false "host unreachable" parks hours later |
| F5 | Medium | Budget enforced only at the IPC gate; `connect()`/`reconnect()` and never-connected hosts bypass it |
| F6 | Low | Reset-relay/disconnect don't re-arm; only Connect does |
| F7 | Low | Paused directive string untranslated / shown on clients without a Connect affordance |