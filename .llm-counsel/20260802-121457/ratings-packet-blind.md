# Blind ratings packet

Rate reports A–D only. Do not guess authors.

## Report: A

# Review: stop-keep-reconnecting-to-remote (SSH auto-reconnect budget)

**Seat:** [reviewer]  
**Scope:** `0ae91744086a3195e9a92e585dae6d814bedf808`..HEAD + all uncommitted/untracked changes  
**Claim:** Stop endless SSH auto-reconnect to remote via a target-scoped wall-clock auto-reconnect budget  
**Mode:** Review-only (no production edits)

## Executive summary

The change introduces a process-wide, **target-scoped** 60s wall-clock budget that (a) caps `SshConnection.scheduleReconnect` loops and (b) parks `initiator: 'auto'` `ssh:connect` calls once exhausted. That correctly addresses the core desktop failure mode where `SshConnectionManager.connect()` discards a non-connected connection and a pane remount restarts a fresh ladder forever.

However, the stop is **not complete across all auto-connect surfaces**, and the 60s budget **materially shortens** prior multi-minute retry behavior. Highest risks: web/runtime/RPC paths always default to `initiator: 'user'` (re-arming the budget), budget windows never open on cold/failed `connect()` paths (so remount storms can resume after a failed user Connect), and slow hosts get only ~2 timeout-sized attempts before permanent pause.

## What changed (map)

| Area | Change |
|------|--------|
| `ssh-auto-reconnect-budget.ts` (new) | Singleton `Map<targetId, startedAt>`; 60s budget; reset/clear |
| `ssh-connection.ts` | Open/check budget in `scheduleReconnect`; reset on successful handshake |
| `ipc/ssh.ts` | `connectTarget(targetId, initiator)`; auto parks when exhausted; power-monitor skip; test clear |
| Preload types/API | Optional `initiator?: 'user' \| 'auto'` (default `'user'`) |
| Renderer auto call sites | App startup, `pty-connection`, automation dispatch pass `initiator: 'auto'` |
| Tests | Budget unit tests; connection give-up rewritten; IPC park/re-arm tests |

## Branch claim — what holds

1. **Target-scoped budget survives connection replacement**  
   `SshConnectionManager.connect()` disconnects non-connected instances and builds a new `SshConnection` (fresh ladder). Budget lives on `sshAutoReconnectBudget` keyed by `targetId`, not on the connection object. Covered by test “keeps the give-up after the connection object is replaced”.

2. **Desktop auto IPC park after exhaustion does zero SSH work**  
   `connectTarget(..., 'auto')` short-circuits before `doConnect` / `connectionManager.connect` when exhausted. IPC test asserts `mockConnectionManager.connect` is not called.

3. **Pane remount no longer re-arms budget (desktop Electron)**  
   `pty-connection.waitForSshConnection` and App startup pass `initiator: 'auto'`. User UI Connect paths omit initiator → default `'user'` → re-arm. Correct split for those surfaces.

4. **False “connected” on parked auto connect is fixed**  
   Park returns `{ status: 'reconnection-failed' }` without throwing. `waitForSshConnection` now treats failed statuses as `connected: false` instead of reattaching a PTY to a dead host.

5. **Power resume respects exhaustion**  
   Resume path skips `manager.reconnect` when budget exhausted (wake is not a user ask).

---

## Findings (proven)

### 1. High — Web / runtime RPC always re-arms budget (initiator dropped)

**Impact:** On web client and any runtime RPC `ssh.connect`, every connect is treated as **user-initiated**, so `sshAutoReconnectBudget.reset(targetId)` runs and the give-up can never stick for those clients. Undermines the branch claim outside pure desktop Electron IPC.

**Evidence:**

```3238:3243:src/renderer/src/web/web-preload-api.ts
    connect: async (args) => {
      const { state } = await callRuntimeResult<{ state: SshConnectionState | null }>(
        'ssh.connect',
        { targetId: args.targetId }  // initiator stripped
      )
```

```27:37:src/main/runtime/rpc/methods/ssh.ts
  defineMethod({
    name: 'ssh.connect',
    params: SshTarget, // only { targetId }
    handler: async (params) => {
      try {
        return { state: getPublicSshState(await connectRegisteredSshTarget(params.targetId)) }
```

```99:103:src/main/ipc/ssh.ts
export async function connectRegisteredSshTarget(targetId: string): Promise<SshConnectionState> {
  ...
  return registeredConnectSshTarget(targetId) // second arg omitted → initiator defaults to 'user'
}
```

```991:993:src/main/ipc/ssh.ts
    if (initiator === 'user') {
      sshAutoReconnectBudget.reset(targetId)
```

`connectRuntimeEnvironmentSshTarget` also invokes RPC with only `{ targetId }` (overlay “Connect” may be intentional user; other auto runtime traffic still hits the same default).

**Failure scenario:** Dead remote host, budget exhausts on desktop main process, mobile/web/runtime auto-connect arrives via RPC → reset → new full connect / reconnect cycle resumes.

**Suggested fix direction (not applied):** Plumb `initiator` through RPC schema + web preload + `connectRegisteredSshTarget`; default RPC callers that are machine-driven to `'auto'`.

---

### 2. High — Budget window only opens in `scheduleReconnect`; cold auto-connect and post–user-fail remounts remain unbounded

**Impact:** The wall-clock stop only applies **after a successful connection has dropped** and entered the reconnect ladder. Cold failures and “user clicked Connect, still dead” do not open a budget window, so `initiator: 'auto'` remounts keep running full `connect()` / `INITIAL_RETRY` forever.

**Evidence:**

- Window open site is only `deadlineFor` inside `scheduleReconnect`:

```1280:1288:src/main/ssh/ssh-connection.ts
    const nowMs = Date.now()
    if (sshAutoReconnectBudget.isExhausted(this.target.id, nowMs)) {
      this.setState('reconnection-failed', AUTO_RECONNECT_PAUSED_MESSAGE)
      return
    }
    const deadlineMs = sshAutoReconnectBudget.deadlineFor(this.target.id, nowMs)
```

- `isExhausted` is **false** when no window is open:

```34:37:src/main/ssh/ssh-auto-reconnect-budget.ts
  isExhausted(targetId: string, nowMs: number): boolean {
    const startedAt = this.windowStartedAtMs.get(targetId)
    return startedAt !== undefined && nowMs - startedAt >= this.budgetMs
  }
```

- Initial `connect()` does 5 transient retries (`INITIAL_RETRY_ATTEMPTS=5`, `INITIAL_RETRY_DELAY_MS=2000`, `CONNECT_TIMEOUT_MS=30_000`) and on failure sets `error` / throws — **never** calls `deadlineFor` / `scheduleReconnect` (reconnect is only wired after a live transport drops).

- User Connect **clears** the window **before** success:

```991:993:src/main/ipc/ssh.ts
    if (initiator === 'user') {

...(truncated if longer)...

## Report: B

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

...(truncated if longer)...

## Report: C

# [reviewer] review: SSH auto-reconnect budget

Reviewed `0ae91744086a3195e9a92e585dae6d814bedf808..HEAD` plus all uncommitted and untracked changes, with emphasis on reconnect admission, timers, connection replacement, renderer/RPC contracts, SSH flaps, and automation dispatch.

## Findings

### High — Paired/web clients discard `initiator: 'auto'`, so their automatic reconnects re-arm the budget

- Files/lines: `src/renderer/src/web/web-preload-api.ts:3238-3242`, `src/main/runtime/rpc/methods/ssh.ts:11-13,28-32`, `src/main/ipc/ssh.ts:99-103,982-994`; affected new callers include `src/renderer/src/App.tsx:1024-1028`, `src/renderer/src/components/terminal-pane/pty-connection.ts:850-857`, and `src/renderer/src/hooks/useAutomationDispatchEvents.ts:168-174`.
- Impact: automatic startup reconnect, pane remount, and automation dispatch in the web/paired renderer can continue creating SSH work after the target's budget should be exhausted. The branch claim holds only for the Electron preload path, not for another supported renderer using the same `PreloadApi` contract.
- Evidence: the changed callers pass `initiator: 'auto'`, but `createSshApi().connect` forwards only `{ targetId: args.targetId }`. The runtime RPC schema contains only `targetId`, and its handler calls `connectRegisteredSshTarget(targetId)` without an initiator. That reaches `connectTarget` through a wrapper whose omitted second argument takes the new default `'user'`; line 993 then deletes the target's budget on every web automatic connect. The existing web preload test at `src/renderer/src/web/web-preload-api.test.ts:3417` even pins the lossy `{ targetId }` RPC payload, so the new native-preload tests cannot catch this path.
- Concrete scenario: a paired/web session remounts an SSH pane for a dead host. `waitForSshConnection` labels the call automatic, the web adapter drops that label, main resets the budget as a user connect, and the next remount repeats indefinitely.

### High — Initial automatic connection failures never open the budget window

- Files/lines: `src/main/ipc/ssh.ts:982-1009`, `src/main/ssh/ssh-connection.ts:605-655`, `src/main/ssh/ssh-connection-manager.ts:27-55`, `src/renderer/src/components/terminal-pane/pty-connection.ts:840-878`.
- Impact: if Orca has no established connection object (the common cold-start/dead-host case), startup or pane-driven automatic connects can run the five-attempt initial retry loop on every remount forever. This directly preserves the endless reconnect behavior the branch is meant to stop, and each round may perform up to five 30-second connection attempts plus retry sleeps.
- Evidence: `connectTarget(..., 'auto')` only asks `isExhausted`; it never calls `deadlineFor`, so a target with no existing window is admitted. `SshConnection.connect()` performs `INITIAL_RETRY_ATTEMPTS` and, on terminal failure, does not open or charge the global budget. `SshConnectionManager.connect()` then removes the failed connection object. The renderer deletes its per-target promise in `finally`, so the next pane remount creates a fresh automatic call. The only production call to `deadlineFor` is `scheduleReconnect()` at `src/main/ssh/ssh-connection.ts:1287`, a path reached after an already-connected transport drops, not after an initial connect fails.
- Concrete scenario: Orca restores a tab while its host is offline. The App startup call times out/deferred-connects, main eventually exhausts its initial attempts and deletes the connection, and focusing/remounting that tab starts a new five-attempt sequence because `isExhausted` remains false forever.

### High — Every momentary SSH handshake resets the target budget, so a rapid flap storm is still endless

- Files/lines: `src/main/ssh/ssh-connection.ts:615-620,1255-1272,1310-1322`; existing stability semantics are in `src/main/ssh/ssh-reconnect-ladder.ts:4-5,37-43,63-66` and the still-present flap test at `src/main/ssh/ssh-connection.test.ts:638-659`.
- Impact: a host/proxy that repeatedly completes SSH setup and immediately closes can reconnect forever, retaining the timer/SSH/relay churn this change claims to bound. This is not a hypothetical classification gap: the existing code already distinguishes a momentary handshake from a stable 60-second connection when deciding whether an outage is over.
- Evidence: after `attemptConnect()` resolves, `runReconnectAttempt()` immediately calls `sshAutoReconnectBudget.reset()`. If the socket then emits `end`, `close`, or `error`, `setupDisconnectHandler()` opens a brand-new 60-second window. Repeating that sequence always resets before exhaustion. By contrast, `SshReconnectLadder` only treats a connection as stable after `STABLE_CONNECTION_MS`; its test drives 12 post-handshake drops spaced 45 seconds apart and expects reconnecting to continue, which demonstrates the new budget currently has no effect on sustained flapping.
- Concrete scenario: an SSH server accepts authentication but a proxy, policy, or broken relay-side transport closes the channel a few seconds later. Every handshake is counted as a full recovery even though none survives the existing stability threshold, so Orca retries without end.

### Medium — The deadline clamp schedules one more SSH attempt at the exact exhaustion boundary

- Files/lines: `src/main/ssh/ssh-connection.ts:1280-1307`; timeout bound at `src/main/ssh/ssh-connection-utils.ts:35-38`.
- Impact: even on the failed-handshake path that does exhaust, Orca performs SSH work after the advertised 60-second bound. The final attempt can remain active for up to the 30-second connection timeout; after suspend/resume, an already-armed timer can likewise dial a dead host despite the new resume admission guard.
- Evidence: `delayMs` is clamped to `deadlineMs - nowMs`, which makes the last timer fire exactly at the deadline. Its callback checks only `disposed` and unconditionally calls `runReconnectAttempt()`; it does not re-check `isExhausted`. With fast failures, the delays reach 43 seconds and the next 30-second ladder step is clamped to 17 seconds, causing a new handshake to start at 60 seconds. The changed test at `src/main/ssh/ssh-connection.test.ts:559-592` only asserts fewer than all nine ladder attempts, so this extra boundary attempt still satisfies the test.

## Verification

- `git diff --check` passed.
- Targeted Vitest execution could not start because this worktree's installed dependencies do not contain the `vitest` binary (`pnpm exec vitest` returned `Command "vitest" not found`). Findings above are based on traced production call paths and the existing tests/contracts cited inline.
- No production or test files were edited; only this review report was created.

...(truncated if longer)...

## Report: D

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

...(truncated if longer)...
