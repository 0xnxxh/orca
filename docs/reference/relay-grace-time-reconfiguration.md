# Relay grace-time reconfiguration

How an SSH relay's shutdown grace is decided, and what the host-sleep
reconfiguration path (`prepareForHostSleep`) does and does not change. Written
for finding E of the P1 review; line numbers are as of that change.

## What decides the grace window

`startGrace` (`src/relay/relay.ts:1140`) samples
`ptyHandler.configuredGraceTimeMs` and takes the **first** branch below that
matches (`decideRelayGrace`, `src/relay/relay-grace-branch.ts`), always passing
an explicit `timeoutMs`. Listed in that precedence order:

- `shutdown-deferred` — a refused kill left the PTY pooled, so the idle branch is
  unreachable; this branch supplies its own bound or a `grace=0` default would
  arm no retry at all.
- `startup-empty-detached` — a detached relay that never accepted a client, so
  it has no PTY state to preserve. Capped at `EMPTY_DETACHED_STARTUP_GRACE_MS`.
- `idle-no-ptys` — zero PTYs *and* zero pending creations
  (`isRelayIdle`, `src/relay/relay.ts:1175`) under the unlimited default only.
  Capped at `IDLE_RELAY_GRACE_MS` (`src/relay/relay.ts:74`, 15 min, overridable
  via `ORCA_RELAY_IDLE_GRACE_MS`).
- `configured` — the configured value verbatim, never clamped.

The zero-only gate is load-bearing: the idle cap bounds *only* the unlimited
default, never a grace the user configured. That is why the branch selector
reads the live configured value rather than the launch-time `--grace-time`
closure — a gate reading a stale zero would be zero-at-launch-only.

The absent/default grace is zero (unlimited) end to end:
`DEFAULT_SSH_RELAY_GRACE_PERIOD_SECONDS = 0` (`src/shared/ssh-types.ts:7`),
persistence drops an unset field (`src/main/persistence.ts`),
`relayGracePeriodForTarget` returns `undefined` (`src/main/ipc/ssh.ts`), and
`normalizeRelayGracePeriodSeconds` maps that to `0`
(`src/main/ssh/ssh-relay-session.ts:219`).

## Host-sleep caller chain

1. `src/main/ipc/ssh.ts:567` — the `powerMonitor` `suspend` handler; `:536`
   calls `session.prepareForHostSleep()` for every active session.
2. `src/main/ssh/ssh-relay-session.ts:378` — `prepareForHostSleep()` sends the
   `relay.configureGraceTime` notification with `graceTimeSeconds: 0` (`:383`).
   `:925` sends the same method on every establish/reconnect, which is why a
   re-assert of an unchanged value must not restart a running grace window.
3. `src/relay/relay.ts:683` — `configureRelayGraceTime` calls
   `ptyHandler.setGraceTimeMs(...)` and replies with the readback.
4. `src/relay/pty-handler.ts:471` — `setGraceTimeMs` writes `this.graceTimeMs`,
   exposed by the `configuredGraceTimeMs` getter (`:494`).

## What the notification does and does not reach

It does **not** reach the grace timer. `startGraceTimer`
(`src/relay/pty-handler.ts:2038`) takes `timeoutMs = this.graceTimeMs` as a
default parameter, but its only production caller is `startGrace`, which always
passes `timeoutMs` explicitly — so that default is never evaluated.

It **does** reach the branch selector, because `startGrace` reads the value back
through `configuredGraceTimeMs`. Two consequences worth stating plainly:

- **Behavior change on the sleep path.** A host-sleep relay holding zero PTYs is
  now told `graceTimeSeconds: 0`, which selects `idle-no-ptys`, so it exits after
  `IDLE_RELAY_GRACE_MS` instead of living forever. This is consistent with the
  rule that zero PTYs means nothing left to preserve; a relay holding live PTYs
  is unaffected, since `isRelayIdle()` is false. Pinned by test.
- **A raise now takes effect at the next arm.** `configureRelayGraceTime`
  re-arms an already-running grace when the value actually changed, so raising
  the grace while the idle timer runs no longer fires at the old deadline.

Whether to also honor the value inside `startGraceTimer` itself — removing the
unused default parameter, or wiring it — remains out of scope; this record
exists so the next owner does not re-derive the chain.
