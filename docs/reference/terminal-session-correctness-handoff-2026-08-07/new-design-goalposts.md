# New design — goalposts

Tracks the design approved on 2026-08-09 (`design-explained.html`, detail in
`counsel-design.html`). Updated as work lands. Progress in every status update
is reported against this file.

## How to read a status

| Status | Means |
| --- | --- |
| **PROVEN** | An oracle asserts the behaviour, removing the production guard **reddens** that oracle, and the mutation was verified to actually land before the result was believed. |
| **ORACLE RED** | The oracle is written and currently fails for the right reason. The production change is not written yet. This is the intended pre-implementation state. |
| **NOT STARTED** | No oracle. |
| **BLOCKED** | Waiting on another goalpost or an owner decision. |

A green test is **not** a status. This program shipped three guards that passed
their tests while sitting off the route production takes; "PROVEN" exists to
make that impossible to claim by accident.

---

## Scoreboard

| | Count |
| --- | --- |
| Step goalposts proven | **3 of 7** (one deleted as unreachable) |
| Global goalposts proven | **2 of 6** |
| Scope removed by evidence | S7 (death rule) — never built |
| Oracle clauses green | 12 |
| Oracle clauses red (awaiting implementation) | 14 |
| Net production lines so far | **−24** |
| Net test lines so far | +116 |

---

## Step goalposts

### S1 — An identity mismatch is never read as death · **PROVEN**

*Guarantee.* The relay reports a pane-identity mismatch by saying the pty was
not found. It found it — comparing is how it noticed. That must never reach a
respawn decision as proof of death.

- Oracle: `src/main/providers/ssh-pty-identity-mismatch-is-not-death.test.ts`,
  `src/renderer/src/components/terminal-pane/reattach-failure-classification.test.ts`
- Clauses: 7 + 3
- Mutations proven: restoring the destructive wrap reddens 2 clauses; deleting
  the classifier guard reddens 1 — clause-selective, each proven separately.
- Landed: `e2524b0472f`

### S2 — Pane identity is not sent on reattach · **PROVEN**

*Guarantee.* Moving a pane to another tab must never make its terminal
unreachable.

- Oracle: same file, `reattach does not ask the relay to police pane identity` (2 clauses)
- Also inverted an existing test that pinned the removed behaviour, so the new
  intent stays covered rather than silently dropped.
- Works against **already-deployed relays**: the relay's comparison is
  presence-guarded, so not sending the fields disarms it everywhere. No wire
  change, no redeploy.
- Landed: `c51be8072ba`

### S3 — A failed reattach never fabricates an exit · **ORACLE RED**

*Guarantee.* On an unproven not-found, the pane is not told the program exited,
ownership is not deleted, provider state is not cleared, and the lease is not
expired. The case routes into the non-destructive recovery branch that already
exists.

- Oracle: `src/main/ssh/ssh-relay-reattach-exit-proof.test.ts` — 6 red, 2 green
- Ships with S7 (the disconnected-pane affordance), since panes now stay visible
  instead of silently respawning.

### S4 — One partition per (target, pane) · **ORACLE RED**

*Guarantee.* A pane that re-leases under a new relay id across reconnects ends
with exactly **one** live claim; the predecessor is superseded, not left live.

- Oracle: `src/main/ssh-pane-binding-partition.test.ts` — 6 red
- This is the highest-value goalpost: it is the mechanism behind the reported
  2 → 19 → 20. Bindings are written to two partitions today, so supersession
  silently no-ops.

### S5 — The superseded-pane fence is live on the reattach path · **ORACLE RED**

*Guarantee.* After a relay-driven reattach binds a pane, a stale write aimed at
the superseded predecessor is **refused**. Today it is permitted, because the
fence's bookkeeping is only written by spawn.

- Oracle: `src/main/ssh/ssh-relay-session-reattach-pane-fence.test.ts` — 2 red, 1 green
- Directly closes a defect in already-shipped work.

### S6 — Settle whether the 30s recovery grant executes at all · **PROVEN — it is dead code**

*Result.* It cannot execute for a real SSH pane. Verified personally:

- The lease stores a **relay-native** pty id, normalized on write
  (`persistence.ts:7184`, comment: "app ids are global").
- The caller passes the **app-form** id (`orca-runtime.ts:16478` ← `toAppSshPtyId`).
- The comparison is raw `lease.ptyId === ptyId` (`orca-runtime.ts:6310`) with no
  normalization, so the two forms can never be equal.
- The branch is also unreachable for a local pane, since it requires an SSH lease.
- Its covering test seeds both sides as the same literal with a null
  connectionId — a shape production cannot produce.

### S7 — The death rule · **DELETED on S6's evidence**

Not built. The arbitration machinery existed to referee a branch that never
executes. Per the design: "if E-1 shows the grant branch unreachable, E-2 is
deleted and the marker simply never fires, which is the safe end state."

### S8 — Remove the dead recovery-grant path · **NOT STARTED**

*Guarantee.* Deleting it changes no behaviour, because it has none. Needs a
characterisation oracle first: assert the branch is unreachable via the
production id shapes, so the deletion is provably inert rather than assumed to be.

---

## Global goalposts

### G1 — Net production code is negative · **ON TRACK (−24)**

Counted from the pre-work merge base, production only. Tests are expected to
grow and are counted separately.

### G2 — No redeploy required for the user-visible fixes · **PROVEN for S1–S2**

Fixes must work against relays already installed on people's hosts. S1 and S2
both do. Any future step that needs a new relay must say so explicitly here.

### G3 — Wire compatibility · **NOT YET EXERCISED**

Clients and hosts update independently. A new optional response field is safe; a
new opcode must be capability-negotiated. S4's orphan projection adds one
optional field and must be checked against
`docs/reference/remote-wire-compatibility.md` when it lands.

### G4 — Cross-platform · **NOT YET EXERCISED**

macOS, Linux, Windows, WSL. No `echo $$` / `ps` assumptions in oracles. No rule
in this design may depend on whether shells survive a hard relay death, because
that differs on Windows and is unresolved.

### G5 — Every guard is proven live on the production route · **PROVEN for S1–S2**

For each new guard, an oracle must redden when the **producer** is removed — not
only when the guard itself is removed. Asserting "the guard behaves correctly
when reached" is not evidence that it is reached.

This exists because it has now failed three times here: an inert `mayCreate`, a
keystroke fence inert on reattach, and a respawn gate on a minority path. S5 is
the remediation of the second.

### G6 — No `max-lines` disables · **HOLDING**

Per AGENTS.md. No per-file bumps either.

---

## Definition of done

1. S1–S5 and S7 PROVEN, or S7 deleted on S6's evidence.
2. G1–G6 satisfied, each with its evidence recorded here.
3. The reported failures are covered by an oracle that reddens without the fix:
   pane cardinality growth on reconnect, and duplicate agent resume.
4. No guard shipped without a producer-side mutation proving it is reachable.

## Deliberately out of scope

- The data-plane work (transport delivery guarantee, binary payloads, one credit
  ledger). Real and separately justified, but independent of these goalposts.
- Rebuilding the authority architecture rejected earlier at +60,903 lines.

## Owner decisions

| | Decision | Status |
| --- | --- | --- |
| D1 | An unverifiable pane becomes visibly disconnected with two actions, instead of silently respawning | **Approved 2026-08-09** (implicit in approving the design; flagged for correction if not intended) |
| D2 | Whether the older gate/journey framing is rescoped or retired now that this design supersedes it | **Open** |
