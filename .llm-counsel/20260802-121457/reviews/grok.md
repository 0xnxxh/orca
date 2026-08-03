# Review: stop-keep-reconnecting-to-remote (SSH auto-reconnect budget)

**Seat:** grok  
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
      sshAutoReconnectBudget.reset(targetId)
```

**Failure scenario A (cold host):** Host never answers. Pane remount → `initiator: 'auto'` → not exhausted → `doConnect` → up to ~5×30s timeouts. Repeat forever. Budget never starts.

**Failure scenario B (user re-arm then fail):** Host dropped, budget exhausted, parked. User clicks Connect → `reset`. Connect fails → manager deletes connection, state `error`. Next remount auto-connects again with **no open window** → unbounded retries resume.

This actively falsifies a full reading of “stop keep reconnecting”: the stop is **post-drop ladder only**, not “all automatic SSH dial attempts.”

**Suggested fix direction:** Open the budget window on first auto-initiated failure (or on first auto `connectTarget` entry), and/or treat failed user reconnect as reopening a bounded auto window rather than a fully cleared map entry until success.

---

### 3. High — 60s wall-clock budget is a functional regression vs prior ~9-handshake / multi-minute ladder for slow hosts

**Impact:** Under the mandate “ZERO functional regressions first,” permanent pause after ~60s of wall clock is a deliberate but **user-visible behavior change**. Hosts with 30s connect timeouts get ~**two** handshake attempts, then permanent pause until manual Connect. Prior code guaranteed **9** failed handshakes before `reconnection-failed` (sum of delays alone 103s; with timeouts on order of several minutes).

**Evidence:**

```10:10:src/main/ssh/ssh-auto-reconnect-budget.ts
export const AUTO_RECONNECT_BUDGET_MS = 60_000
```

```35:38:src/main/ssh/ssh-connection-utils.ts
export const INITIAL_RETRY_ATTEMPTS = 5
export const INITIAL_RETRY_DELAY_MS = 2000
export const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 5000, 10000, 10000, 10000, 30000, 30000]
export const CONNECT_TIMEOUT_MS = 30_000
```

Test rewrite removed the pin that protected long retry:

- Old: `expect(connectAttempts).toBe(1 + RECONNECT_BACKOFF_MS.length)` with comment *“giving up early would strand a user on a flaky link”*
- New: stops on budget with `expect(connectAttempts).toBeLessThan(1 + RECONNECT_BACKOFF_MS.length)`

**Failure scenario:** Wi‑Fi / VPN blip of 70–90s. Old ladder kept trying. New budget marks `reconnection-failed` with paused message; auto recovery never resumes even after the network is healthy. User must notice overlay and click Connect.

**Note:** Fast `ECONNREFUSED`-style failures can still pack many attempts into 60s; the regression is sharpest for **timeout-class** unreachability (the common “remote asleep / path dead” case).

---

### 4. Medium — Near-exhaustion auto `ssh:connect` can still spend minutes of SSH work

**Impact:** Park path promises “zero SSH work” only when **already** exhausted. If budget has milliseconds left (or none open — finding #2), auto connect enters `doConnect` → `connectionManager.connect` → full `INITIAL_RETRY` with no mid-flight budget checks.

**Evidence:** Exhaustion checked only at `connectTarget` entry (`ipc/ssh.ts` ~994–1008). `SshConnection.connect()` loop has no `sshAutoReconnectBudget` reads. `runReconnectAttempt` also does not re-check budget before `attemptConnect` (only next `scheduleReconnect` does).

**Failure scenario:** Budget opened at T0. At T0+59s, pane remount fires auto connect → not exhausted → starts 5×30s attempts while the “60s budget” has already conceptually ended mid-flight.

---

### 5. Medium — Successful flap handshakes reset budget forever (claim incomplete for flap storms)

**Impact:** Not a pure regression vs the old ladder (flaps never incremented `consecutiveFailedAttempts` to give-up), but the new budget **does not** stop hosts that briefly complete handshake then drop.

**Evidence:**

```1319:1321:src/main/ssh/ssh-connection.ts
      this.reconnectLadder.markConnected(Date.now())
      sshAutoReconnectBudget.reset(this.target.id)
```

Same reset on initial successful `connect()` (~618–619).

**Failure scenario:** Host accepts TCP/SSH every few seconds then dies. Each success resets the 60s window → continuous reconnect CPU/network; power-monitor and remount keep participating.

---

### 6. Low — Runtime-owned target IDs can retain exhausted budget across lifecycle

**Impact:** `removeTarget` / disconnect do not call `sshAutoReconnectBudget.reset/clear` for that id. Runtime-owned IDs are stable (`getRuntimeOwnedSshTargetId(runtimeId)`). A later re-upsert of the same runtime id may inherit an exhausted window until a user-classified connect resets it. Manual targets mint new ids on add (`ssh-${Date.now()}-...`), so less exposed.

**Evidence:** `sshAutoReconnectBudget.clear()` only in `resetSshHandlerStateForTests`; production resets only on user connect / successful handshake / full test clear. `removeRegisteredSshTarget` does not touch the budget map.

---

### 7. Low — User-facing overlay may not show the paused message body

**Impact:** Main sets `error: AUTO_RECONNECT_PAUSED_MESSAGE`, but `TerminalSshReconnectOverlay.messageForStatus` uses generic translated copy for `reconnection-failed`, not `state.error`. User may not learn that Connect is required to re-arm auto retry (status bar / other surfaces may still show raw error depending on wiring).

**Evidence:** Overlay switch for `reconnection-failed` → fixed translate string; park message constant is more specific.

---

## Correctness / lifecycle checks (no issue or pre-existing)

| Check | Result |
|-------|--------|
| Dispose + timer cleanup | `disconnect` clears `reconnectTimer`; timer callback bails if disposed |
| Double `scheduleReconnect` | Guard `if (this.reconnectTimer) return` retained |
| Delay clamp past deadline | `delayMs = min(decision.delayMs, max(0, deadlineMs - nowMs))` avoids sleeping past budget; last attempt may still fire at boundary (acceptable) |
| User Connect re-arm | Default initiator + explicit reset; overlay Connect omits initiator → user |
| Automation dispatch | Uses `initiator: 'auto'`; non-connected after park → `skipped_unavailable` |
| Relay override mask on park | Clears relay lost backoff + override before broadcasting paused state |
| Performance (hot path) | O(1) Map ops; no new per-byte stream work; no extra listeners; timers only existing reconnect path |
| Unbounded buffers | Budget map grows with distinct target ids only (small); `clear()` in tests only |

## Performance

- **Win:** After exhaustion, desktop auto remounts and power-resume skip SSH work (primary goal).
- **Risk:** Finding #2/#4 still allow long INITIAL_RETRY storms (CPU + remote sshd load) when the window is not open or not yet exhausted.
- **No new render/stream path cost** beyond one extra status check in `waitForSshConnection`.

## Test gaps

1. No test that cold auto `ssh:connect` (never connected / never dropped) eventually stops.  
2. No test that user Connect → fail → auto remount remains bounded.  
3. No test that RPC/web connect preserves `initiator: 'auto'`.  
4. Removed exact 9-attempt guarantee; no assertion documenting intended max attempts under 30s timeouts (~2).  
5. No integration test that power-monitor + exhausted budget leaves connection untouched (unit-level only via code read).

## Verdict on branch claim

| Claim piece | Verdict |
|-------------|---------|
| Stop endless ladder after drop (desktop) | **Mostly true** (60s hard stop; survives connection replace) |
| Stop endless pane-remount restart after give-up (desktop Electron) | **True** when window already open/exhausted |
| Stop all automatic remote reconnect forever | **False** — web/RPC re-arm (#1); cold/post-user-fail paths (#2); flaps (#5) |
| Zero functional regression | **False** — shorter retry window (#3) |

**Top severity: High**  
**Findings count: 7** (3 High, 2 Medium, 2 Low)

## Recommended priority order (for implementer, not this seat)

1. Plumb `initiator` through RPC + web preload + `connectRegisteredSshTarget`.  
2. Open budget on auto connect failures (not only post-drop `scheduleReconnect`); define semantics after user-reset failure.  
3. Revisit 60s vs CONNECT_TIMEOUT (e.g. budget that counts failed attempts, or ≥ ladder delay sum + N timeouts) if “no functional regression” is hard requirement.  
4. Optionally re-check budget inside `connect()` / `runReconnectAttempt` before each attempt.
