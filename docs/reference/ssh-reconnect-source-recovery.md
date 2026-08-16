# SSH reconnect: why the pane retry gets a byte tail, and what would actually change it

Status: investigation result. The obvious follow-up to PR #14844 was traced and **rejected**; this
records why, so nobody re-proposes it, and points at the question worth answering instead.

## The shape of the problem

A reconnect remounts the pane (`tab.generation` is its React key), so the xterm is disposed with its
buffer and something must repaint it. Today that is a **byte tail**: `reattachSshPtySession` sends
`requireReplay: true` and the relay returns `RecentPtyOutputBuffer.read()` — the last 100KB, read
non-destructively, with no notion of what this client already consumed.

Two costs follow. Main's `@xterm/headless` model never sees those bytes (the tail bypasses
`onPtyData`), so it is stale by exactly the outage — which is what forces
`sshReconnectPaintsFromModel` to restrict the grid repaint to the alternate screen. And a shell loses
outage output past 100KB permanently.

## The proposal that does not work

"Make the pane-retry path request source recovery like `reattachKnownPtys` does." Mechanically this
is trivial — `sourceRecovery` is already an optional `pty.attach` param the relay parses, Path C
already calls the same `requestSshPtyAttach` helper and already parses the response field. The
required checkpoint state also survives a transport drop, in the module-level `recoveryByTarget` map
(`ssh-pty-consumer-recovery.ts:17`), reachable from `connectionId` because `connectionId === targetId`.

It still fails, three ways:

1. **The relay answers `'existing'` before it looks at the recovery argument.**
   `relay-pty-source-publication.ts:99-109` short-circuits on a same-`clientId` attach; the
   reconnecting client has already rotated the delivery onto its id (`:132-136`). There is no
   "resend from checkpoint on an already-open delivery" primitive — adding one *is* a relay change.
2. **A failed `reattachKnownPtys` deletes the checkpoint on purpose** (`ssh-relay-session.ts:3006-3007`)
   and detaches the lease (`:3008`). The pane retry runs *after* that, so it would present
   `checkpointUnavailable`, which the relay converts to `restoreRequired`
   (`relay-pty-source-publication.ts:124-130`) and the provider converts to
   `SSH_SESSION_EXPIRED_ERROR` (`ssh-pty-provider.ts:103-107`). We would trade a blank-pane-with-tail
   for a **killed session**.
3. **Wrong payload shape.** Recovery replays only the post-checkpoint delta
   `(acceptedSourceEndSu → receivedEndSu]`. The byte tail is a screen snapshot for a *fresh, empty*
   xterm. Even a successful recovery returns roughly nothing in the common case, and the pane stays
   blank.

These two mechanisms answer different questions. Recovery keeps main's model whole; the tail repaints
a new terminal. Substituting one for the other is a category error.

## A correction worth recording

The motivating argument was "`requireReplay` is optional, so older relays ignore it and still show
blank panes." **That is wrong for the SSH relay.** The client deploys and launches its own relay
build into a version-scoped directory (`ssh-relay-deploy.ts:231`, `:594`), and `validateGrant`
rejects any grant whose `serverBuildId` differs from the expected one
(`ssh-pty-consumer-session.ts:58-65`, rationale in-code: *"client and relay ship in one build"*).
Client and SSH relay are version-locked; mixed versions do not occur on this channel. The
independent-update rule in `remote-wire-compatibility.md` still governs remote *runtime* hosts — just
not this one.

So there is no old-host population to rescue, and the urgency that argument created was false.

## The question actually worth answering

Source recovery is hard-gated on the `outputFlowControl` grant (`ssh-relay-session.ts:2692-2694`,
plus `deliveryMode === 'legacy-owner'` on the relay). Separately, `activate()` returns `'existing'`
whenever the attaching client presents the **same `clientId`** as the open delivery.

We have empirical evidence that this is exactly what happens on a real reconnect: the blank-pane bug
existed *because* the relay decided this client already held the stream, and the shipped fix
(`requireReplay`) works by bypassing that same early return at `pty-handler.ts:1747-1756`.

If the reconnecting client keeps its id, then `reattachKnownPtys`' source recovery would hit the same
`'existing'` short-circuit — meaning **checkpointed recovery may not be functioning for SSH
reconnects at all**, and the byte tail is not a fallback but the only path that ever runs.

That hinges on whether the relay runs as a daemon (new `clientId` per connection, `relay.ts:992`) or
as an stdio primary that keeps its id across `setWrite` (`dispatcher.ts:149-157`). **UNVERIFIED.**
Answer this before designing anything else — it decides whether the work is "make recovery apply to
one more path" or "recovery has never run here, and that is the bug."

## Do not start at `onClientDetached`

Three attempts failed there, each plausible until run:

- Retiring the delivery on `dispatcher.onClientDetached` **breaks checkpoint recovery** (10 tests).
  A delivery outliving its client is deliberate — it is what lets a client resume from a checkpoint.
- Retiring without `session.cancelDelivery()` orphans the credit ledger's one-upstream-owner slot;
  the next open throws `PTY source delivery already has an upstream owner`. Seen live as a toast and
  a blank pane.
- Comparing `record.identity.clientGeneration` to the request is impossible: that value is
  client-supplied via `pty.openClient`, and `RequestContext` carries no generation of its own.

## The lead that survives

`reattachRejectedPty` (`ssh-relay-session.ts:1957-2004`) is an existing **single-PTY** entry point
into the `reattachKnownPtys` machinery, taking `(relayPtyId, mux, providerGeneration, mode)` and
driving recovery with `targetedDeliveryRecovery`. If per-pane recovery is wanted, that is the hook —
and it does not involve the pane-retry path at all. Unverified whether it is reachable at the moment
the renderer retries.

## Preconditions, unchanged

The SSH e2e lane must be green and triggering on **source** changes before any of this is attempted.
It was skipping for 15 specs; four regressions reached a user during that window.
