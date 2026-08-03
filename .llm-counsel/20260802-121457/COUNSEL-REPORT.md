# LLM Counsel Report — stop-keep-reconnecting-to-remote @ 0ae9174408

- Run: `20260802-121457`
- Base: `0ae91744086a3195e9a92e585dae6d814bedf808` (equals HEAD — **all work is uncommitted**, including 2 untracked budget files)
- Seats: grok | codex gpt-5.6-sol high | claude opus high | claude fable high
- Date: 2026-08-02T19:31:36Z
- Mandate: **0 functional or performance regressions**

## Executive verdict

**Do not ship as-is.** Four independent reviewers and a coordinator spot-check agree this branch does **not** deliver “zero functional or performance regression,” and it only **partially** delivers the branch claim (stop endless SSH auto-reconnect).

The core idea is sound and well-tested for the **desktop Electron IPC happy path after a live connection drops**: a **target-scoped** 60s wall-clock budget survives `SshConnectionManager` connection replacement, parks zero-cost on exhausted auto connects, and no longer re-arms on pane remount when `initiator: 'auto'` reaches main.

But multi-seat agreement (plus code verification) shows **merge-blocking functional regressions and claim holes**:

1. **Paired/web runtime RPC drops `initiator`**, so auto remounts re-arm the budget as `'user'` and can restart connect storms (claim falsified off pure desktop IPC).
2. **Cold / never-connected targets never open the budget window** — only `scheduleReconnect` opens it — so remount-driven dead-host storms remain unbounded in the most common “host was never up this session” case.
3. **60s wall-clock vs 30s connect timeouts ≈ ~2 black-hole retries**, then a **pause that never self-expires** until a human clicks Connect — this is a deliberate policy shift, but it is a large functional change vs the prior 9-step ladder and breaks unattended recovery (automations, overnight sleep, host reboots &gt;60s).
4. **Sleep/wake**: budget burns wall-clock during suspend, and resume hard-skips exhausted targets — undoing #7773-style wake recovery when the outage brackets sleep.

**Ship risk: High.** Recommend fix consensus High items before merge; treat parameter/policy (60s + never-expire) as an explicit product decision if retained.

## Consensus findings

### C1 — High — Runtime RPC / web preload drops `initiator` → auto reconnect re-arms budget


|                    |                                                                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | High (functionality / claim falsified for paired clients)                                                                                                                                                 |
| **Files**          | `src/renderer/src/web/web-preload-api.ts:3238-3245`, `src/main/runtime/rpc/methods/ssh.ts:11-37`, `src/main/ipc/ssh.ts:99-104,982-993`                                                                    |
| **Agreeing seats** | grok, codex, claude-fable (all High); claude-opus noted related path but under-weighted web adapter vs desktop                                                                                            |
| **Coordinator**    | **Verified.** Web `connect` sends only `{ targetId }`; RPC schema is `{ targetId }` only; `connectRegisteredSshTarget(targetId)` omits initiator → defaults to `'user'` → `sshAutoReconnectBudget.reset`. |


**Impact:** Shared renderer paths that correctly pass `initiator: 'auto'` (pane remount, automation, startup) still re-arm the budget when they run over web/runtime RPC. Desktop park can be overwritten by a paired client’s full connect storm.

**Smallest fix:** Plumb `initiator` through RPC schema + web preload + `connectRegisteredSshTarget`; default only true user UI to `'user'`.

---

### C2 — High — Initial / cold `connect()` never opens the budget window


|                    |                                                                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | High (claim only half-delivered; endless reconnect remains)                                                                                                                                                                                                                      |
| **Files**          | `src/main/ssh/ssh-connection.ts:605-656` (`connect`), `:1287` (only production `deadlineFor`), `src/main/ipc/ssh.ts:991-1008`                                                                                                                                                    |
| **Agreeing seats** | All four (High)                                                                                                                                                                                                                                                                  |
| **Coordinator**    | **Verified.** `deadlineFor` is only called from `scheduleReconnect`. Failed initial `connect()` throws and never opens a window; `isExhausted` stays false forever for never-connected targets. IPC park tests hand-synthesize the window with `deadlineFor(..., now - budget)`. |


**Impact:** Dead host from app start / restored tab never connected: each auto remount can still run up to `INITIAL_RETRY_ATTEMPTS=5` × `CONNECT_TIMEOUT_MS=30s` (~160s SSH work per call), forever.

**Smallest fix:** Open the window on first `'auto'` admission in `connectTarget` (and/or on terminal failure of `connect()`), then enforce `isExhausted` on subsequent auto connects.

---

### C3 — High — 60s budget ≈ ~2 timeout attempts; pause never self-heals


|                    |                                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | High (functional behavior change / recovery regression)                                                                                                                                             |
| **Files**          | `src/main/ssh/ssh-auto-reconnect-budget.ts:10,34-37`, `src/main/ssh/ssh-connection-utils.ts:35-38`, `src/main/ssh/ssh-connection.ts:1277-1307`                                                      |
| **Agreeing seats** | grok, claude-opus, claude-fable (High); codex focused on related flap/boundary but not this product recovery frame                                                                                  |
| **Coordinator**    | **Verified.** `CONNECT_TIMEOUT_MS=30_000`, `AUTO_RECONNECT_BUDGET_MS=60_000`, ladder delays sum to 103s. Black-hole trace ≈ 2 attempts then permanent pause. Test suite pins pause does not expire. |


**Impact:** Host reboot / VPN / Wi-Fi flap &gt;60s permanently parks the target until a human clicks Connect. Unattended automations (`useAutomationDispatchEvents` with `initiator: 'auto'`) stay skipped forever after one blip. Prior ladder allowed 9 failed handshakes.

**Note: If product explicitly wants “stop after ~1 minute and require manual Connect,” document it -&gt; yes let's go for this one.** Under the mandate **0 functional regression**, this is still a regression vs prior recovery behavior.

**Smallest fix options (pick product intent):** (a) raise budget ≥ full ladder (~5+ min), and/or (b) slow self-heal (re-open window every N minutes / on network or resume), and/or (c) pin attempt-count tests so future timeout bumps don’t silently go to 1 attempt.

---

### C4 — High — Sleep/wake: wall-clock budget + resume hard-skip undoes wake recovery


|                    |                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | High (functionality regression vs #7773 wake path)                                                                                                               |
| **Files**          | `src/main/ssh/ssh-auto-reconnect-budget.ts:34-37`, `src/main/ipc/ssh.ts:576-580`, `src/main/ssh/ssh-connection.ts:1283-1285`                                     |
| **Agreeing seats** | claude-opus, claude-fable (High); grok framed resume skip as holding; codex did not elevate                                                                      |
| **Coordinator**    | **Verified.** `isExhausted` uses raw `Date.now()`; resume handler `continue`s when exhausted and never runs `isRelayLinkAliveAfterResume` / `manager.reconnect`. |


**Impact:** Outage starts → window opens → laptop sleeps → wakes on a healthy network: budget already exhausted from sleep time; resume path skips; SSH workspaces stay parked needing manual Connect.

**Smallest fix:** On `powerMonitor` resume, re-open or reset budget for targets (or measure only awake/active retry time) before the liveness probe.

---

### C5 — Medium — Successful handshake immediately resets budget (flap storms unbounded)


|                    |                                                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | Medium (claim incompleteness; not a pure new regression vs old ladder)                                                                                                                         |
| **Files**          | `src/main/ssh/ssh-connection.ts:615-620,1310-1322`; contrast `SshReconnectLadder` / `STABLE_CONNECTION_MS`                                                                                     |
| **Agreeing seats** | grok, codex (High severity framing); peers noted pre-branch ladder also never stopped flaps                                                                                                    |
| **Coordinator**    | **Verified reset-on-handshake.** Severity demoted to Medium: old ladder already continued flaps; this is incomplete bounding of the branch claim, not a newly introduced endless loop vs main. |


**Smallest fix:** Reset budget only after stable connection (align with `STABLE_CONNECTION_MS`), not on every handshake.

---

### C6 — Medium — Stale exhausted window survives clean Disconnect / dispose


|                    |                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | Medium                                                                                                                                          |
| **Files**          | `disconnect` / removal paths; budget only reset on success handshake or `'user'` connect                                                        |
| **Agreeing seats** | claude-fable (F4); peers elevated as unique strong finding                                                                                      |
| **Coordinator**    | **Verified directionally.** Clean disconnect does not clear the map entry; later auto connect can park with “host unreachable” without probing. |


**Smallest fix:** `sshAutoReconnectBudget.reset(targetId)` on explicit disconnect / removeTarget / intentional user stop.

---

### C7 — Medium — Parked state is broadcast-only; UI may not show pause message


|                    |                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | Medium (UX / state consistency)                                                                                                                                                             |
| **Files**          | `src/main/ipc/ssh.ts` early park return + `broadcastSshState`; `getPublicSshState` / overlay copy paths                                                                                     |
| **Agreeing seats** | claude-opus (M2), grok/fable partial                                                                                                                                                        |
| **Coordinator**    | **Plausible / partially verified.** Park returns a synthetic state without writing into connection manager; later `getState` can disagree. Overlay message path needs product confirmation. |


---

### C8 — Low/Medium — Deadline clamp can start one attempt at exact exhaustion


|                    |                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **Severity**       | Low–Medium (one tail attempt, not a loop)                                                                                    |
| **Files**          | `src/main/ssh/ssh-connection.ts:1280-1307`                                                                                   |
| **Agreeing seats** | codex (Medium); others: tail attempt / no loop                                                                               |
| **Coordinator**    | **Verified.** Timer callback does not re-check `isExhausted`; can dial after nominal deadline for up to one connect timeout. |


**Smallest fix:** Re-check `isExhausted` at the start of `runReconnectAttempt` / timer fire.

## High-signal unique findings


| Finding                                                                                                                    | Seat               | Status                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------- |
| User Connect `reset()`s **before** success → failed user Connect leaves no open window → next auto remount unbounded again | grok (scenario 2B) | **Verified** in code (`reset` on initiator user before attempt). Important interaction with C2. |
| Near-exhaustion auto connect can still enter full initial-retry loop                                                       | grok               | Related to C2/C8; credible                                                                      |
| `SSH_CONNECT_FAILED_STATUSES` gate may newly abort PTY reattach on relay-error races                                       | claude-opus        | **Unverified** — needs targeted test; mark residual                                             |
| Paired storm overwrites desktop parked broadcast UI                                                                        | claude-fable       | Credible second-order of C1                                                                     |
| Reset Relay / non-Connect recovery actions don’t re-arm                                                                    | claude-fable       | Credible product gap                                                                            |


## Performance surface

**Checked:** reconnect timers, connect retry loops, IPC short-circuit, relay-lost backoff (separate), renderer remount / automation call sites, power resume.


| Agreed                                                                                    | Residual                                                  |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Desktop park path is zero-cost once window exhausted and `initiator: 'auto'` reaches main | Web/RPC path undoes that (C1) → full connect cost storms  |
| Cold path still allows multi-minute SSH work per remount (C2)                             | Hot path: flap handshake resets keep churn unbounded (C5) |
| 60s cap reduces ladder work after drop (good for dead-host CPU/network)                   | But only after drop; initial connect path not capped      |


**No multi-seat evidence of render-loop or unbounded buffer regressions** from this diff. Performance risk is **SSH reconnect storms**, not UI frame cost.

## Functionality / regression surface


| Agreed breaks / claim holes                  | Disputed / demoted                                         |
| -------------------------------------------- | ---------------------------------------------------------- |
| C1 web/RPC re-arm                            | Flap reset severity (claim gap vs new regression)          |
| C2 cold connect unbounded                    | Deadline clamp as High (only one tail attempt)             |
| C3 permanent pause after ~2 timeout attempts | claude-opus “park healthy live session” overstated (peers) |
| C4 sleep/wake recovery regression            |                                                            |
| Automation permanently skipped after park    |                                                            |


**Residual gaps:** no long-running integration against real sleep/wake; no paired-client e2e for initiator; vitest for renderer/main passed on some seats (opus/fable: 181 main SSH + 538 pty tests) but not re-run by coordinator.

## Peer ratings (blind)

**Peer ratings were blind (anonymized labels A–D).** Mapping was coordinator-only:


| Label | Seat         |
| ----- | ------------ |
| A     | grok         |
| B     | claude-opus  |
| C     | codex        |
| D     | claude-fable |


### Aggregate mean scores (unblinded)

Overall = mean of (evidence, regression_catch, false_positive_risk, actionability).  
`false_positive_risk`: **5 = trustworthy / low FP**.


| Seat             | evidence | regression_catch | false_positive_risk | actionability | **overall** |
| ---------------- | --------: | ----------------: | -------------------: | -------------: | -----------: |
| **claude-fable** | 5.00     | 4.75             | 4.50                | 4.75          | **4.75**    |
| **claude-opus**  | 5.00     | 4.75             | 4.00                | 5.00          | **4.69**    |
| **grok**         | 5.00     | 4.25             | 4.50                | 4.50          | **4.56**    |
| **codex**        | 4.50     | 3.25             | 4.25                | 3.25          | **3.81**    |


### Trust callouts

- **Most trusted this run:** claude-fable (tight FP discipline, C1 second-order UI overwrite, F4 disconnect lifecycle) and claude-opus (deepest recovery regressions: sleep/wake, 60s math, permanent pause).
- **Strong evidence, slightly narrower product frame:** grok (best on user-Connect-before-success hole; missed sleep/wake as High).
- **Most rigorous per-finding but narrowest coverage / least actionability:** codex (excellent C1 test pin + deadline clamp; missed sleep/wake and permanent-pause product framing; no fix directions).

## Seat scorecards


| Seat             | Strengths                                                                                                 | Blind spots                                                                                                       | Trust weight |
| ---------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------ |
| **grok**         | Concrete code cites; user-Connect reset-before-success; web/RPC + cold path                               | Missed sleep/wake as High; some severity on pre-existing flaps                                                    | High         |
| **codex**        | Sharpest C1 evidence (existing web test pins lossy payload); deadline clamp; flap vs STABLE_CONNECTION_MS | Narrow (4 findings); under-weights product recovery / never-expire; no fix directions; couldn’t run vitest in env | Medium       |
| **claude-opus**  | Best timelines; sleep/wake; 60s≈2 attempts; automation unattended; ran full test gates                    | Under-weighted live web adapter (treated as more latent); a few Medium edges slightly overstated                  | High         |
| **claude-fable** | Claim falsified for paired clients; disconnect stale window; gates + typecheck; clear fix directions      | Missed overlay dropping pause message; some future-caller speculation                                             | Highest      |


## Recommended next actions

Ordered smallest-first; **no drive-by refactors**.

1. **Plumb `initiator` end-to-end** through web preload + runtime RPC + `connectRegisteredSshTarget` (fixes C1).
2. **Open budget window on first auto connect / failed cold connect** so remount storms actually stop (fixes C2; interacts with user-reset-before-success).
3. **Product decision on 60s + never-expire** (C3): either raise budget / add slow self-heal, or document intentional permanent park + manual Connect; pin attempt-count tests either way.
4. **Resume path:** re-arm or extend budget on wake before #7773 probe (fixes C4).
5. **Reset budget on explicit Disconnect / removeTarget** (fixes C6).
6. **Re-check exhausted at timer fire / `runReconnectAttempt`** (fixes C8).
7. Optional: reset budget only after stable connection (C5); make park state authoritative + show pause message (C7).

**Do not merge** until at least (1)+(2) land if the claim is “stop keep reconnecting.” Treat (3)+(4) as required for **zero functional regression** under the counsel mandate.

## Artifacts


| Path                                                                | Contents                                                   |
| ------------------------------------------------------------------- | ---------------------------------------------------------- |
| `.llm-counsel/20260802-121457/COUNSEL-REPORT.md`                    | This report                                                |
| `.llm-counsel/20260802-121457/reviews/`                             | `grok.md`, `codex.md`, `claude-opus.md`, `claude-fable.md` |
| `.llm-counsel/20260802-121457/reviews-blind/`                       | Anonymized A–D copies                                      |
| `.llm-counsel/20260802-121457/ratings-blind/`                       | Raw peer ratings (letter keys)                             |
| `.llm-counsel/20260802-121457/ratings/`                             | Coordinator-unblinded rating copies                        |
| `.llm-counsel/20260802-121457/blind-map.json`                       | Coordinator-only label→seat map                            |
| `.llm-counsel/20260802-121457/base.txt` / `head.txt` / `branch.txt` | Scope pins                                                 |


