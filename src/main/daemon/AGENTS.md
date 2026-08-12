# AGENTS.md — Terminal Daemon

## Endpoint Ownership: Who May Touch the Socket Path

Two invariants govern the daemon's canonical socket path. Read this before changing anything that
links, renames, unlinks or stats it — or that treats its existence as evidence a daemon is running.

> **Only a daemon publishing itself onto the canonical endpoint may mutate that directory entry,
> and only by replacing an entry it has itself just proven dead.**
>
> **No actor removes a name it did not create.**

**Why it exists.** `net.Server.close()` unlinks the pathname it bound with no ownership check, so a
departing daemon deleted whichever socket then sat at the canonical path — including a live
replacement's. The replacement stayed alive hosting PTYs no client could reach, which reads to the
user as terminals that accept keystrokes and never run them. Seven review rounds against the older
"launcher reclaims a dead process's name" shape produced twenty-three defects, all the same
interleaving: a third party observing liveness at T and acting on the directory entry at T+1.

**The protocol** (`daemon-endpoint-ownership.ts`): bind a private `.p<hex>` name → try an exclusive
`link` → on `EEXIST` prove the incumbent dead by connecting → re-check the entry hasn't changed
hands → probe once more → `rename` in one syscall → verify we kept it.

## Traps That Already Cost Us

- **Never collapse "can't tell" into "dead."** Only `connected` means occupied; only
  `refused`/`missing` prove death. A timeout or `EPERM` proves nothing and must decline — treating
  it as death deletes an endpoint still serving every terminal on the host.
- **"Can't tell" does not license a kill at launch either.** When the launcher cannot establish
  what a health-check-failing daemon is hosting, it holds it in degraded mode rather than
  replacing it. Only the daemon itself can prove it is empty, over IPC; the process table may
  only ever *raise* a verdict toward "occupied", never lower one toward a kill.

  Two exclusions apply **to that residual only** — not to a daemon already proven occupied:
  an endpoint that is proven dead (a cold start has nothing to hold), and `rejected` (it
  answered and refused, so it can never be adopted and its sessions can never be reattached).

  A `rejected` daemon that process evidence shows *is* hosting live PTYs is still held, because
  the choice there is between unreachable-but-running agents and dead ones. Restart recovers it
  at the documented cost.

  The cost is deliberate and known: a wedged-but-empty daemon is no longer replaced at launch,
  so #8689 degrades to "restart it from Manage Sessions" instead of being handled automatically.
  And an endpoint held by something that accepts connections but never speaks the protocol — a
  foreign process, or our own permanently wedged daemon — reads as an incumbent on *every*
  launch, so it stays degraded with no auto-recovery. `killStaleDaemon` only kills a process
  whose identity matches the pid record, so Restart cannot clear that one; the degraded message
  says so and points at quit-and-relaunch.

  Two pieces exist only to keep that cost from growing, and both have been proposed for deletion
  on the reasoning that "'unknown' and 'occupied' now behave the same". They do not. The process-
  table evidence read is what holds a daemon whose socket entry vanished while it still hosts
  agents — the occupied branch has no proven-dead check and the unknown hold does. And the
  grace-retry loop is worth *more* since the hold landed, because a counted `occupied` reaches
  full adoption where the alternative is a degraded hold.
  That was chosen over the alternative, which was killing daemons whose live agents we had
  merely failed to observe — unrecoverable, versus one click.

  **Do not try to fix this by tuning the classification budget.** Ten review rounds each found a
  different timing band where a bounded classification kills a session an unbounded one keeps.
  Matching the old tolerance for a single probe costs more clock than the 60s startup fail-open
  leaves once the kill ladder and the fork are paid for. The budget is a latency bound, not a
  correctness parameter, and it must stay that way.
- **`link` first, never an unconditional `rename`.** `rename` replaces whatever it finds, so it
  would let a starting daemon destroy a healthy one. `link` fails loudly and forces the liveness
  question.
- **`rename`, never `unlink`-then-`link`.** The latter leaves the name absent between two calls;
  measured across a live handover it gapped on essentially every observation, where `rename` gapped
  on none in ~14,500 probes.
- **Do not identify an entry by `birthtimeMs`.** Node documents it as sometimes holding the ctime,
  filesystems without a birth time report the epoch, and its granularity is often coarser than the
  events it must separate. Three attempts to patch around this produced three more defects; inode
  recycling is now settled by asking whether anything is *serving*.
- **Do not add a sweeper.** Deciding whether someone else's leftover is safe to delete is the
  question this design retired; the last one produced five defects, including deleting a live
  listener's only pathname. Every actor removes its own scratch name on each non-crash path.
- **Scratch namespaces must stay out of released builds' patterns.** Shipped versions sweep
  `^\.b[0-9a-f]{10}$` on age alone with no liveness check, which is why the bind name is `.p`.
  Deleting our sweeper does not un-ship theirs.
- **Never remove the endpoint on shutdown.** A departing daemon leaves a dead entry; the next
  publisher replaces it in one rename.

**Residual risk.** The final probe and the `rename` are two syscalls, and POSIX has no
rename-if-target-is-inode-X. The harm is separately unreachable: a daemon never creates a session
on an endpoint it no longer holds (`daemon-server.ts`), and it drains rather than serving on.
