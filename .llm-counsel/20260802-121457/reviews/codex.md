# Codex review: SSH auto-reconnect budget

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
