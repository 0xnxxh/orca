# SSH host key verification (STA-4319)

Revised after security and migration review. Where a first draft was wrong, the correction is kept
visible rather than quietly edited out — the reasoning matters for anyone changing this later.

## The defect

`src/main/ssh/ssh-connection.ts:1184` installs a `hostVerifier` that records a SHA-256 fingerprint
and then `return true`. Every ssh2 connection accepts every host key. There is no `known_hosts`
consult, no trust record, and no change detection anywhere in `src/main/ssh/`. There is exactly one
ssh2 `Client` construction site, so the fix has a single chokepoint.

Scope is per-connection, not per-feature: one `SshConnection` per target serves exec, SFTP, port
forwarding, the filesystem watcher and relay deploy.

### Threat model, corrected

Traffic is still encrypted, so a passive observer gets nothing. The exposure is an **active**
attacker who can redirect the connection — ARP/DNS spoofing, hostile Wi-Fi, a hijacked internal name.

Three corrections to the first draft:

- **Jump hosts are NOT the worst case; they are already safe.** `shouldUseSystemSshTransport`
  (`ssh-transport-selection.ts:71-91`) returns true for exactly the conditions under which
  `resolveEffectiveProxy` (`ssh-proxy-command.ts:17-38`) returns a proxy — the two branch on the same
  inputs in the same order — and `attemptConnect` returns unconditionally after the system probe
  (`ssh-connection.ts:670-673`). So ProxyJump/ProxyCommand go through OpenSSH and are already
  verified. The ssh2 proxy-spawn at `:697` is effectively unreachable. Good news for migration, and
  the first draft's motivating example was simply wrong.
- **Agent forwarding was overstated.** `agentForward` is gated on the user's `ForwardAgent yes`
  (`ssh-connection-utils.ts:203-205`). `config.agent` is always set, but that is agent *auth*, whose
  signatures bind the session id and cannot be replayed onward. The risk applies to users who opted
  into `ForwardAgent`, not everyone.
- **Credential theft was understated, and the relay claim was backwards.** `isAgentFallbackError`
  treats *any* auth error as agent fallback (`ssh-connection-utils.ts:59-61`), so a MITM that rejects
  publickey walks the user to the password prompt (`ssh-connection.ts:844`) and the private-key
  **passphrase** prompt (`:834`), and `cachedPassword` is replayed without prompting on every
  reconnect (`:709`). Meanwhile the relay upload matters less than assumed — the attacker already
  owns their machine. The real client-side impact is the **return** direction: the attacker becomes
  the host our workspace trusts, driving relay protocol frames, landing SFTP content in local
  worktrees, and feeding agent-hook payloads in.

## Decisions

### D1. Read the user's `known_hosts`; write only to our own store

Consult the user's real `known_hosts` as a trust source — most developers already have their hosts
there from `ssh` and `git`, which is the entire migration story. Do **not** write to it: that file is
shared with every other SSH tool on the machine, and appending brings line-endings, permissions,
concurrent writers, and a corruption blast radius well beyond us.

Two consequences to own rather than discover:

- **Revocation does not propagate.** `ssh-keygen -R host` clears `known_hosts` but not our store, so
  our acceptance outlives the user's own remediation and is invisible to `ssh`. The "forget" action
  (D5) is the only cure, so it must be discoverable, and mismatch messaging must name which source
  disagreed.
- **`ssh -G` on the HOME-divergent `-F` path suppresses `/etc/ssh/ssh_config`**
  (`ssh-g-config-resolution.ts:44-52`), hiding site-wide `StrictHostKeyChecking yes` and
  `GlobalKnownHostsFile`. On that path we must fail **strict**, never laxer than `ssh` would.

### D2. Ask `ssh -G`, do not reimplement config resolution

`ssh -G` reports `userknownhostsfile`, `globalknownhostsfile`, `stricthostkeychecking`,
`checkhostip`, `hostkeyalgorithms`, `fingerprinthash`, `hashknownhosts`, `updatehostkeys` and
**`hostkeyalias`** — with `Match` and `Include` already applied. `resolveWithSshG` exists and simply
does not read them yet.

`userknownhostsfile` is a space-separated list on one line, may contain `~`, and may contain
double-quoted paths with spaces. When `ssh -G` is unavailable (no `ssh`, non-zero exit, >5s timeout)
fall back to `~/.ssh/known_hosts` + `known_hosts2` — never to accept.

`HostKeyAlias` must be honoured: users tunnelling bastions through `localhost:port` depend on it and
would otherwise hit spurious mismatches. It appears nowhere in `src/main/ssh/` today.

**Lookup key.** Config resolution uses `configHost || label` (`ssh-connection.ts:660`) while ssh2
dials `effectiveHost` (`ssh-connection-utils.ts:188`). The `known_hosts` lookup must use
`HostKeyAlias` if set, else the **resolved hostname** — keying on the Orca label would miss every
existing entry.

**Two ordered lookup passes, not one candidate set.** Verified against OpenSSH 10.2p1: a non-default
port looks up `[host]:port` first, and if that finds nothing it retries the **bare** host. Crucially,
on that second pass a wrong key is downgraded to `unknown` rather than reported as changed. So the
passes are `[['[host]:port'], ['host']]`, and the fallback pass can only yield `match` or `unknown`.
Collapsing them into one set would give a spurious first-contact prompt to anyone who has a bare
line and connects on a non-default port; treating the fallback as authoritative would raise a false
change-of-key alarm.

**Hashed entries hash the candidate form, not the bare host** — `[example.com]:2222` is what gets
HMAC'd for a bracketed entry, so each candidate must be hashed separately.

**Multiple files union.** Any exact hit in any file wins; a disagreeing entry in another file does
not make it a mismatch. Confirmed live in both orderings.

**A `@cert-authority` line whose key equals the presented plain host key is not a match** — a CA line
only validates certificates. A normal line alongside it still decides.

### D3. Six outcomes, and type scoping is only safe with algorithm ordering

`match | mismatch | revoked | ca-only | unknown-type-known-host | unknown`.

Mismatch is scoped to the same key type: a host with only an RSA entry that presents ed25519 is not
"changed". Without scoping we would false-alarm nearly every RSA-era user on their first upgraded
connect, training them to dismiss the one warning that matters.

**But scoping alone is a downgrade vector, and this is the correction that most changes the design.**
OpenSSH is safe here only because `order_hostkeyalgs()` reorders the client's proposed host-key
algorithms to put the types already in `known_hosts` first, and RFC 4253 gives the *client's* order
priority — so a server cannot choose a type the client deprioritised. ssh2 negotiates ed25519 first
regardless. An attacker who cannot forge the RSA key on file simply presents ed25519 and receives a
friendly first-contact prompt instead of a hard failure.

Therefore: **set ssh2's `algorithms.serverHostKey` to lead with the key types already known for that
host.** Type scoping without algorithm ordering is not a safe design.

And when the presented type is unknown *while other types are known for this host*, that is
`unknown-type-known-host` — never a plain TOFU prompt. It must say we already hold a different key
for this host.

### D4. Outcomes

- **match** → connect silently.
- **unknown** → trust-on-first-use (see the phasing below for whether that is silent or prompted).
- **mismatch** → hard fail, no override in the failure surface.
- **revoked** → hard fail, always.
- **ca-only** → hard fail with a message naming certificate-authority hosts as unsupported on this
  transport, plus the documented escape (below). These hosts connect today, so this is a live
  functional regression, and without an escape it will generate exactly the support pressure that
  produces the override D4 refuses.
- **unknown-type-known-host** → treat as suspicious, not first contact.

`StrictHostKeyChecking` is honoured: `no`/`off` accepts unknown but **never persists** and still
hard-fails changed and revoked; `accept-new` persists silently; `yes` denies unknown.

**Documented escape for ca-only and any host we cannot verify:** `ORCA_SSH_FORCE_SYSTEM_TRANSPORT=1`
routes through OpenSSH, which handles CA hosts correctly. That is a real answer, not a bypass.

### D5. Recovery must not live in the failure dialog

A "forget this host key" button *in* the mismatch dialog is D4's rejected "trust anyway" with one
extra click. Recovery lives in target settings: a separate, deliberate surface, no auto-retry, and it
shows the stored fingerprint so the user is choosing knowingly.

Offer it only when **our** store is what disagreed; when `known_hosts` disagrees, forgetting our
record cannot unblock the connect. Messages, written to avoid naming internals:

> **Ours disagreed** — "The host key for `build-01` changed since you last connected from Orca. If you
> rebuilt or reprovisioned this machine, this is expected." → *Forget the saved key* / *Cancel*

> **`known_hosts` disagreed** — "The host key for `build-01` does not match the entry in
> `~/.ssh/known_hosts`. `ssh` and `git` will refuse this host too. Run `ssh-keygen -R build-01`." →
> no button, because a button would not help.

### D6. Never prompt on a background reconnect

A prompt only means something when a human initiated the connect. `userInitiated` does not exist on
the connect path today and must be threaded through `connect → attemptConnect → doSsh2Connect`,
defaulting **false**.

Two traps: `useAutomationDispatchEvents.ts:203` and `pty-connection.ts:857` reach `ssh:connect`
without a human click — automation must pass `false`, but **terminal-pane focus reconnects must count
as user-initiated** or terminals die silently. And the denial string must avoid "authentication
failed"/"permission denied", or `isAgentFallbackError`/`isAuthError`
(`ssh-connection-utils.ts:46-61`) misclassifies it and the reconnect ladder retries a decision that
will never change.

### D7. Fail closed — three known fail-open shapes

1. The existing generation/disposed guard at `:1185` has the fail-open shape today: skip recording,
   still `return true`. Post-fix that branch must **deny**.
2. A synchronous throw inside the verifier may not be caught by ssh2 — wrap and `verify(false)`.
3. Any non-`undefined` return accepts immediately (see Traps).

Plus: no prompt channel registered → deny (the load-bearing default lives in `doSsh2Connect`, not in
IPC, so a caller that forgets to wire it cannot accidentally accept); no window → deny; timeout →
deny; dialog dismissed → deny.

### D8. Store shape and scope

Accepted keys are scoped to **host + port + key type**, not target id — aliases point at different
machines, two targets can name one machine, and a re-created target must not lose trust.

The store is a **dedicated file**, not the main persistence blob (`persistence.ts:7088`): a settings
restore or rollback must not silently reset trust. Accept and mismatch events are logged.

`hostKeyFingerprint` is now security-relevant *and* wire-relevant — it is an isolation namespace sent
to the host (`ssh-relay-session.ts:1298`, `managed-hook-owner-identity.ts:187`). It is `undefined` on
the system transport, so **no trust logic may key off it**, and its format must not change (see
Traps).

## Phasing — ship the defence before the dialog

Review made the case that the riskiest part of this change is not the security model but the modal.
Startup restore fires eager connects for *all* previously-active targets in parallel (`App.tsx:1041`)
with a 15s timeout, while a prompt would live 120s — N unknown hosts means N stacked dialogs
outliving the timeout that already deferred them. Runtime-owned ephemeral VMs
(`ephemeral-vm-runtime-ssh.ts:31`) dial a freshly provisioned host with a brand-new key on every
launch. Paired-web connects run on the *host desktop* (`runtime/rpc/methods/ssh.ts:32`), so the
dialog would open on someone else's screen while the web user watches a spinner.

**Phase 1 — no new modal.** Consult `known_hosts` + our store. `match` connects. `unknown` persists
silently with `accept-new` semantics and a passive notification naming the host and fingerprint.
`mismatch` (same type) and `revoked` hard-fail. This is the entire MITM defence with zero prompts,
zero startup storms and zero web hang.

**Phase 2** — the TOFU dialog, `StrictHostKeyChecking` honouring, `ca-only`, `userInitiated`
plumbing, and the D5 settings surface.

Carve-outs required before Phase 1 ships: runtime-owned ephemeral targets are exempt from persistence
(new key every launch is expected, not suspicious); RPC-originated connects are non-interactive and
fail fast with a message naming the desktop app.

## Traps

Each of these makes the fix silently do nothing. All confirmed in our tree.

1. **An `async` verifier defeats it entirely.** ssh2 does
   `const ret = hashCb(key, verify); if (ret !== undefined) verify(ret)`. An async function returns a
   Promise — not `undefined`, and truthy — so ssh2 accepts before our callback settles.
2. **Do not set ssh2's `hostHash`.** It hands the callback a hex digest and discards the raw blob we
   must compare — and it would change `hostKeyFingerprint`'s format, which is a cross-version state
   break, not a local refactor.
3. **The existing test mock calls `hostVerifier(key)` with one argument** and ignores the return
   (`ssh-connection.test.ts:86-91`). Under an async verifier every connect test there breaks. The
   mock must change — flagged deliberately, not rewritten silently.
4. **Validate the blob**: embedded algorithm name must match the line's key-type field; reject empty
   decodes, empty salts, and hashed entries whose hash is not 20 bytes.
5. **`ssh-relay-live-connect.test.ts:59`** constructs a connection with no credential callback —
   headless with no prompt channel must deny, not hang.

## Scope

**In scope, corrected:** IPv6 literals and `[host]:port` bracket parsing. Review was right that this
is a *parser* requirement, not a scope call — getting it wrong means hosts `ssh` knows come back
`unknown`, which is the prompt-training harm D3 exists to avoid.

**Out of scope, with consequences stated:**
- **`CheckHostIP`** — OpenSSH defaults it off; we form candidates from the hostname only.
- **WSL** — `src/main/ssh/` has no WSL awareness; a distro's `known_hosts` is unreachable, so WSL
  users get first-contact treatment for hosts they already verified.
- **`UpdateHostKeys`** — we read it and use nothing, so we never learn a rotated key, which makes D5
  the routine path for key rotation rather than an exception.
- **Moving SFTP to the system transport** — correct direction, separate change.

## Test plan

**Parser** (against the file format, not our code's shape): plain lines, `host,host2` lists,
`[host]:port` used only when port ≠ 22, IPv6 literals, hashed `|1|salt|hash` with a real computable
vector, `@revoked`, `@cert-authority`, `*`/`?` globs, `!` negation vetoing a whole line, unrecognised
`@marker` skipping the line, malformed lines skipped not fatal, multiple keys per host, CRLF, blank
lines, comments, user file and global file disagreeing.

**Decision function**: all six outcomes; type scoping; revocation resolved before match regardless of
line order; every `StrictHostKeyChecking` value; `no`/`off` never persists.

**Algorithm ordering**: `algorithms.serverHostKey` leads with types on file — the test that makes D3
safe rather than merely scoped.

**Wiring**: unknown persists (Phase 1) without a prompt; match never notifies; mismatch fails with no
accept path; revoked fails; background reconnect denies; aborted connect settles pending verify
false; no prompt channel denies; runtime-owned targets are exempt; the denial string does not match
`isAuthError`; and — catching the worst regression — **the verifier returns nothing**, so a refactor
to `async` reddens a test rather than reaching a user.
