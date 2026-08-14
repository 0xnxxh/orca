# SSH host key verification (STA-4319)

## The defect

`src/main/ssh/ssh-connection.ts` installs a `hostVerifier` that records a SHA-256 fingerprint and
then `return true`. Every ssh2 connection accepts every host key. There is no `known_hosts` consult,
no trust-on-first-use record, and no change detection anywhere in `src/main/ssh/`.

Scope is per-connection, not per-feature: one `SshConnection` per target serves exec, SFTP, port
forwarding, the filesystem watcher and relay deploy, and they all ride that one handshake.
Connections that take the system `ssh` binary are already verified by OpenSSH; the ssh2 path is the
exposed one. The worst case is a jump host — ssh2 has no native ProxyJump, so we spawn the proxy and
hand ssh2 a socket, which means the final hop, on the topology most likely to cross untrusted
network, is the unverified one.

What is lost is the defence against an active attacker who can redirect the connection. Traffic is
still encrypted, so a passive observer gets nothing. An attacker who can redirect gets the password
or keyboard-interactive response, use of the forwarded agent while the session lives, and control of
the relay binary we upload and execute.

## Decisions

### D1. Read the user's `known_hosts`; write only to our own store

We consult the user's real `known_hosts` as a trust source — most developers already have their hosts
there from `ssh` and `git`, so the majority upgrade silently, which is the whole migration story. We
do **not** write to it. Appending to a file the user and other tools own means line-ending and
permission handling, concurrent writers, and a corruption mode whose blast radius is every SSH tool
on the machine. Accepted keys persist to our own per-target store instead.

The cost is a second place trust can live, and a user who removes an entry from `known_hosts` and
expects us to re-prompt. That is why the changed-key notification has to name *which* source
disagreed (see D5).

### D2. Ask `ssh -G`, do not reimplement config resolution

`ssh -G` already reports `userknownhostsfile`, `globalknownhostsfile`, `stricthostkeychecking`,
`checkhostip`, `hostkeyalgorithms`, `fingerprinthash`, `hashknownhosts` and `updatehostkeys`, with
`Match` blocks and `Include` already applied. `resolveWithSshG` exists; it simply does not read those
fields yet.

`userknownhostsfile` is a **space-separated list on one line** and may contain `~` and
double-quoted paths with spaces. Parse it as a list, expand via `resolveSshConfigHomePath`.

`ssh -G` returns null when `ssh` is absent, exits non-zero, or exceeds its 5s timeout. That must
degrade to `~/.ssh/known_hosts` + `~/.ssh/known_hosts2`, never to accept.

### D3. Five outcomes, not three

`match | mismatch | revoked | ca-only | unknown`.

- **`revoked`** is resolved in a separate first pass so the verdict cannot depend on line order.
- **`ca-only`** exists because ssh2 advertises no `*-cert-v01@openssh.com` algorithms. Without it, a
  host protected by a CA entry gets an ordinary first-contact prompt, which trains users to click
  through the exact dialog that is supposed to mean something.
- **Mismatch is scoped to the same key type.** A host with only an RSA entry that presents ed25519 is
  `unknown`, not `mismatch`. This is the single most important detail in the design: ssh2 negotiates
  ed25519 first, so without type scoping we would fire a change-of-key alarm at nearly every existing
  user on their first upgraded connect — training them to dismiss the one warning that matters.

### D4. Unknown prompts; changed hard-fails

- **unknown** → prompt (trust-on-first-use), showing host, port, key type and the `SHA256:` fingerprint
  exactly as `ssh-keygen -lf` prints it. Accept persists; Cancel fails the connect. Cancel is default.
- **match** → connect silently.
- **mismatch** → **hard fail. No "trust anyway" button.** This is the MITM-shaped case and a button
  makes the warning worthless. Recovery is an explicit, separate action (D5).
- **revoked** → hard fail, no override, ever.
- **ca-only** → hard fail with a message saying certificate-authority hosts are not supported on this
  transport, rather than a first-contact prompt.

`StrictHostKeyChecking` is honoured: `no`/`off` accepts an unknown key but **never persists** it and
still hard-fails changed and revoked; `accept-new` persists without prompting; `yes` denies unknown
without prompting.

### D5. Recovery for a legitimately changed key

Reprovisioned dev boxes and rebuilt VMs are common here, so a hard fail needs a documented way out.
An explicit "forget this host key" action, offered **only when our own store is the source that
disagreed**. When `known_hosts` is what disagrees, forgetting our record would not unblock the
connect, so the message must instead tell the user to fix their `known_hosts` — pointing at the wrong
remedy is worse than none.

### D6. Never prompt on a background reconnect

A prompt is only meaningful when a human initiated the connect. An automatic reconnect that hits an
unknown key **denies**; it must not raise a dialog the user cannot place in context, and must not
train click-through. The request carries whether it was user-initiated.

### D7. Fail closed, everywhere

Any exception while gathering evidence denies. An aborted or superseded connect sweeps its pending
verification and calls `verify(false)` so ssh2 is never left waiting on a promise nobody will settle.
The handshake deadline is extended while a human is in the loop, then restored.

## Traps

These are the ways this fix silently does nothing, all confirmed in our tree:

1. **`async` verifier defeats the fix entirely.** ssh2 does
   `const ret = hashCb(key, verify); if (ret !== undefined) verify(ret)`. An `async` function returns
   a Promise, which is `!== undefined` and truthy, so ssh2 accepts immediately and the callback we
   later invoke is ignored. The verifier must be a plain function that returns `undefined` and calls
   `verify(bool)` later.
2. **Do not set ssh2's `hostHash`.** It hands the callback a hex digest and discards the raw key blob
   we need in order to compare against a `known_hosts` line.
3. **The existing test mock calls `hostVerifier(key)` with one argument** and ignores the return
   (`ssh-connection.test.ts`). Under an async verifier every connect test in that file would call
   `verify` on `undefined`. The mock has to change — flagged deliberately, not rewritten silently.
4. **Validate the blob.** The algorithm name embedded in the key must match the line's key-type
   field; reject empty decodes, empty salts, and hashed entries whose hash is not 20 bytes. Read the
   type from the blob's length prefix with bounds checks and refuse a malformed key rather than
   prompting about one we cannot identify.
5. **`ssh-relay-live-connect.test.ts` constructs a connection with no credential callback.** Headless
   behaviour with no prompt channel must be defined: deny, do not hang.

## Not in scope

- **`CheckHostIP`** and IPv6 literal handling. Candidates are formed from the configured hostname
  only, never the resolved IP.
- **WSL.** `src/main/ssh/` has no WSL awareness at all today; a distro's `~/.ssh/known_hosts` is not
  reachable. Windows uses `%USERPROFILE%\.ssh\known_hosts` via `os.homedir()`. Naming this as out of
  scope rather than discovering it later.
- **Certificate-authority hosts**, beyond refusing them clearly (D3).
- **Moving SFTP to the system transport.** Correct direction, separate change.

## Test plan

Parser, against the file format rather than our code's shape: plain lines, `host,host2` lists,
`[host]:port` (bracket form only when port ≠ 22), hashed `|1|salt|hash` HMAC-SHA1 lookup, `@revoked`
and `@cert-authority`, `*`/`?` globs, `!` negation vetoing a whole line, unrecognised `@marker`
skipping the line, malformed lines skipped not fatal, multiple keys per host, CRLF.

Decision function: the five outcomes, key-type scoping, revocation resolved before match, each
`StrictHostKeyChecking` value, and that `no`/`off` never persists.

Wiring: an unknown key prompts and persists on accept; a matching key never prompts; a changed key
fails with no accept path; a background reconnect denies without prompting; an aborted connect
settles the pending verify as false; a connection with no prompt channel denies rather than hangs;
and — the one that catches the worst regression — **the verifier must not return a value**, so a
refactor to `async` is caught by a test rather than by a user.
