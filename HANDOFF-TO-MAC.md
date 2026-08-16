# Handoff — release-blocker pipeline, openclaw → Mac

Written 2026-08-16 by the coordinator on `openclaw` when the pipeline was moved back to
Brennan's Mac. **Assume the reader has none of my context.** Everything below is either
proven with a command I ran, or explicitly labelled as unproven.

Base for everything: `origin/main` @ `93ab6e142e`.

---

## 0. Read this first — five things that will waste your time if you miss them

1. **The "known pre-existing main breakage" briefing is half stale.** The #14738 type-aware
   audit failure was **already fixed on main** by `931cb037c5` (#14755), which is an ancestor
   of `93ab6e142e`. I verified this two independent ways (§7.1). **If a pipeline branch fails
   `audit:code-quality:type-aware`, that failure is its own — do not wave it through as
   inherited.** The other half (the "test vs non-test LoC" job 404) is still open and still
   Neil's / STA-4484; it only posts a PR comment and blocks nothing.

2. **`grok` does NOT work on this account**, despite being told twice that it does.
   `grok -p` returns "Not signed in", no `XAI_API_KEY` is set, and `grok login` needs a
   browser or device code — an interactive step only Brennan can take. I used `codex`
   (v0.147.0, working) as the independent reproducer instead.

3. **Linear only works through the SSH bridge, which I was told is retired.** Plain `orca`
   on PATH reaches this box's paired runtime but returns `linear_not_connected`. The only
   Linear-capable binary is `/home/brennan/.orca-relay/bin/orca`, whose own error text calls
   it the "Orca SSH CLI bridge", and whose `worktree list` returns **Mac** paths
   (`/Users/brennanbenson/...`). I used it for Linear reads/attach/status because there was
   no alternative. **Flagging it rather than hiding it.** On the Mac this conflict disappears.

4. **`mobile/node_modules` is empty in every worktree except `review-4363`.** Confirmed by
   the readiness lane across all 8 worktrees. Any mobile work needs
   `pnpm install --frozen-lockfile` inside `mobile/` first. The pnpm store is warm so it is
   fast.

5. **Never `git stash` in this repo.** Catshark's STA-4448 worktree is a *linked worktree of
   the same repo*, so the stash stack is repo-global and shared with another live agent.
   Revert with `git checkout HEAD -- <path>` instead. Stack depth was 0 at handoff. Note
   that **lint-staged/husky creates its own temporary stash on commit** — it cleaned up
   correctly every time here, but it is why you may see a stash flicker.

---

## 1. Branch inventory

All nine branches below are **pushed to origin**. Head SHAs are the pushed heads at the moment
this table was written. The two lanes still editing at teardown (`fix-4472-4473`,
`fix-glue-cluster`) may have one or two further teardown snapshots on top — **read their real
heads from origin** rather than trusting these two rows:

    git ls-remote origin 'refs/heads/brennanb2025/*'


| Branch | Head | State | Contains |
|---|---|---|---|
| `brennanb2025/fix-4449-4491` | `46294c668d` | **PR #14917 OPEN** — verified | STA-4449 + STA-4491. Squashed, clean single commit, all gates green. |
| `brennanb2025/fix-4471` | `7dd1413a66` | **VERIFIED**, stacked on the above | STA-4471 (P0). Proven non-vacuous by mutation — 4 tests RED across runtime/SSH/local create. |
| `brennanb2025/fix-4472-4473` | `efeec371c8` | Green, not mutation-tested | STA-4472/4473. Head typechecks (exit 0) and its 63 tests pass. Intermediate commits may hold torn writes — do not bisect. |
| `brennanb2025/fix-glue-cluster` | `c30c9890f2` | Mixed | STA-4477 fix (committed by the lane) + **UNVERIFIED WIP** reland tests I snapshotted at teardown. |
| `brennanb2025/fix-4451` | `2d2326e07c` | **UNVERIFIED**, rescued WIP | STA-4451. Predecessor's work. I audited it but never ran it. |
| `brennanb2025/repro-4449-4491` | `e5f7adf8c9` | Reference only | Original repro test + REPRO-FINDINGS.md. Superseded by PR #14917. |
| `brennanb2025/readiness-baseline` | `4413d59810` | Complete | `READINESS-BASELINE.md`, 622 lines. Read it — it is high quality. |
| `brennanb2025/review-4363-scratch` | `c7f5903a10` | Scratch, **NOT FOR MERGE** | PR #14581's head + a 21-mutation review harness. |
| `brennanb2025/blocker-pipeline-coordinator` | latest on branch | Coordination | This file, `PIPELINE-STATUS.html`, `LINEAR-TICKETS.md`, `scripts/runtime-watchdog.sh`. |

> ### ⚠️ My teardown snapshots can contain TORN WRITES — read this before using them
>
> To avoid losing work I committed two still-running lanes' trees myself, repeatedly, while they
> were mid-edit. **That is not a free operation and it demonstrably damaged work once.**
>
> On `fix-glue-cluster`, my snapshot `0eeb30f93c` captured `mobile-native-chat-pending-echo.ts`
> and `use-mobile-native-chat-drafts.ts` in the instant *after* the lane had deleted code and
> *before* it wrote the replacement — a torn write (8 insertions / 19 deletions). The lane
> noticed and repaired it in `c30c9890f2` ("restore reland wiring clobbered by a WIP snapshot").
> I verified the repair: `git diff fae8802099 c30c9890f2` over those two files is **empty**, so
> that pair cancels out cleanly and there is no residue on that branch.
>
> **`brennanb2025/fix-4472-4473` did not get that luck.** It received four teardown snapshots and
> the lane was stopped immediately afterwards, so **no one repaired any torn writes there**. Any
> of those commits may hold a half-written file. Do not read that branch as a coherent sequence
> of intended states. Treat it as a bag of salvaged fragments: diff it, expect breakage, and
> rebuild rather than resume. `git diff origin/main...HEAD` on it is the honest starting point,
> not any individual commit.
>
> **On the `wip(...) — UNVERIFIED WIP` commits.** The two lanes working on STA-4472/4473 and the
> STA-4482 reland were still mid-edit when the box was torn down. Rather than lose that work I
> committed their trees myself, four times, as clearly-labelled teardown snapshots. They were captured
> mid-edit: they are not verified, not proven RED→GREEN, and may not compile. Treat them as
> salvage material, not as a starting point you can trust. Their authors' reasoning did **not**
> survive — only the files did.

**Do not touch** `~/orca-sta-4448-host-qualified-delete` or branch
`sta-4448-host-qualified-delete` — that is catshark's live STA-4448 work.

---

## 2. LANE 1 — STA-4449 + STA-4491 → **PR #14917** (the one finished thing)

Branch `brennanb2025/fix-4449-4491` @ `46294c668d`. One clean commit. Both tickets moved to
**In Review** in Linear with the PR attached.

### What is proven, and exactly how

Reverting the production files to `origin/main` while keeping the tests turns **5 tests RED**:

```
× preserves a Codex-only local retirement across remove and re-add
× preserves a remote retirement when an SSH target id rotates before re-add
× reassigning a target id carries retirements written before endpoint identity
× reassigning a target id carries retirements when the endpoint itself moved
× shares one retirement bucket across SSH repos whose target row is gone
Tests  5 failed | 24 passed (29)
```

A whole-file revert is a weak proof, so I also ran a **7-mutation battery**. Every test has at
least one mutation that kills it and only it:

| Mutation | Kills |
|---|---|
| local repos stop mirroring into the namespace | Codex-only local retirement |
| host identity keys on the target row id | SSH target id rotates |
| `reassignSshTargetId` stops migrating namespaces | written before endpoint identity |
| migration drops the legacy row-id arm | written before endpoint identity |
| migration drops the tombstone arm | endpoint itself moved |
| unresolvable targets stop sharing a bucket | shares one bucket |
| all SSH collapses into the unknown bucket | does not leak to a different endpoint |

### The two defects I found in my predecessor's work (both fixed)

- **The original STA-4491 test was vacuous.** It set `connectionId: 'ssh-old'` / `'ssh-new'`
  with **no SSH target rows in the store**, so both sides resolved to the
  `UNKNOWN_SSH_HOST_IDENTITY` (`ssh:?`) fallback bucket and the test passed for entirely the
  wrong reason. It never exercised endpoint identity, and it never touched
  `reassignSshTargetId` — which is literally what STA-4491's "Action" asks for and which had
  **zero test coverage**. Rewritten to add real `SshTarget` rows.
- **My own first replacement test was also vacuous**, and the mutation battery is what caught
  it: the "endpoint itself moved" case passed via the surviving `repo.id` row rather than the
  migration under test, and no mutation could kill it. It now drops the repo row first. This
  is the concrete argument for mutation-testing rather than revert-testing alone.

### Gates (all on the squashed commit)

| Gate | Result |
|---|---|
| vitest — `persistence`, `ssh`, `orca-profiles`, `worktree`, `shared/worktree` | **2261 passed**, 19 skipped |
| `tsc --noEmit -p config/tsconfig.node.json` | exit 0 |
| oxlint code-quality native `--deny-warnings` | exit 0 |
| oxlint `--type-aware` `--deny-warnings` | exit 0 |
| oxfmt | clean |

### Design decision worth preserving

Keying retirement storage on the namespace instead of `repo.id` is **explicitly rejected in
#14350's own PR body**, and it is still the right rejection: the namespace derives from
`workspaceDir`, `nestWorkspaces`, `worktreeBasePath` and `repo.path`, so keying storage on it
orphans every retirement the moment a user toggles any of those — far more common than
remove/re-add. `repo.id` stays primary, the path-derived namespace is a mirror, and reads
union both. They fail on *different* events, which is the whole point.

### Unproven / next

- No Electron or mobile QA was run against this. It is main-process persistence logic with
  no UI surface, so I judged that acceptable, but it is not the same as having done it.
- The namespace map cap is 256 with insertion-order LRU. I did not write a test that proves
  eviction order under churn.

---

## 3. LANE 2 — STA-4471 (P0), branch `brennanb2025/fix-4471` @ `7dd1413a66`

**Stacked on PR #14917's commit `46294c668d`.** Rebase or land in that order.

`git diff origin/main...HEAD --stat` shows 15 files, of which 8 are PR #14917's — the lane's
own contribution is:

```
src/main/ipc/worktree-remote.ts                    |  71 ++++-----
src/main/ipc/worktrees-ssh-pr-head-fetch.test.ts   |  71 ++++++++-
src/main/ipc/worktrees-windows.test.ts             |  39 +++--
src/main/runtime/orca-runtime.test.ts              |  46 +++++-
src/main/runtime/orca-runtime.ts                   |  44 ++----
src/main/worktree-create-name-plan.test.ts         | 107 ++++++++++++++
src/main/worktree-create-name-plan.ts              |  75 ++++++++++
```

It extracted a new `worktree-create-name-plan.ts` with tests, and touched all three gate
sites. That matches the intended shape.

### The defect (confirmed by code read, by me, before dispatching)

`src/main/runtime/orca-runtime.ts:~22645`:
`shouldRetireGeneratedName = args.nameWasGenerated === true && isGeneratedWorktreeCreateName(...)`.
With the flag absent this is `false` → `retiredNameRegistry` is `null` → `isRetiredName` is
`null` → the `if (isRetiredName?.(...)) continue` skip never fires, and the host creates
straight onto a cwd it knows is retired. Same gate at `worktree-remote.ts:~1566` and `:~2142`.

### The tension, and the intended resolution

#14350 gated on the explicit flag **on purpose**, because the generated-name pool contains
ordinary English words (`orca`, `runner`, `sole`, `emperor`) that people type deliberately.
So you must **not** consult the whole pool. Consult only the **retired set** — names actually
spent. If a typed name really is retired, that cwd holds another workspace's history and
redirecting is correct.

### VERIFIED BY ME after the lane went silent — this is no longer unproven

I reconstructed and then verified this lane's work myself. **STA-4471 is proven.**

The fix extracts `planWorktreeCreateNames()` into `src/main/worktree-create-name-plan.ts`, shared
by all three create paths so a retirement rule cannot hold on one and not the others. Its core
move is to **split the two decisions #14350 conflated**, which the module documents itself:

- *Whether to walk the creature tier ladder* stays gated on the client's `nameWasGenerated` bit,
  so a user-typed name keeps its literal spelling and plain `-2`/`-3` suffixes.
- *Whether a retired cwd may be reused* is decided by the **host alone**.

Consulting the **retired set** rather than the generator pool is what makes host-side enforcement
safe, and the code says why: the pool is ordinary English (`orca`, `runner`, `emperor`) so matching
against it would hijack deliberate names, whereas the retired set only ever names cwds this host
issued. A name outside the pool never even loads the registry.

**Non-vacuity proof.** I restored the exact #14350 defect as a mutation — making the retirement
lookup conditional on the client's flag again (`isPoolShaped` → `usesGeneratedLadder`) — and four
tests went RED, covering all three create paths, which is precisely what the ticket asked for:

```
× refuses a retired cwd even when the client sends no provenance bit
× skips a retired cwd on the SSH create path when the client omits provenance
× skips a retired cwd on the local create path when the client omits provenance
× skips a retired cwd when an older client omits nameWasGenerated
Tests  4 failed | 1182 passed | 1 skipped (1187)
```

Still owed on this one: an independent read against
`docs/reference/remote-wire-compatibility.md`. My read is that it is wire-safe — the host becomes
*stricter* using state it already holds, no request/response field or opcode changes — but that
should be confirmed, not taken from me.

### `fix-4472-4473` is far better than "salvage" — I re-checked it

I wrote earlier in this file that this branch should be treated as salvaged fragments because of
torn-write risk. **I then tested it, and that warning does not apply to its head `efeec371c8`:**

- `tsc --noEmit -p config/tsconfig.node.json` → **exit 0**
- Its six relevant suites → **63 passed, 0 failed**

So the final state is coherent. Individual intermediate commits may still hold torn writes — do
not bisect through them — but the branch **head** is sound and is a real starting point.

What it contains:

- **`worktree-retirement-discovery.ts`** (STA-4472) — routes WSL UNC listings through the existing
  bounded gate (`wslGatedReaddir`) and resolves distro homes via `getWslHomeAsync`, so each
  distro's `<wslHome>/.claude/projects` is included in discovery. It matches leaf names
  *generously* on a stated principle: over-retiring costs one name out of 552; under-retiring
  reissues a path whose agent history is still on disk.
- **`worktree-retirement-backfill-scan.ts`** (STA-4473) — a 15 s scan deadline and a 60 s
  failure backoff replacing the cache-forever Promise. The comments give the real reason the
  backoff matters: an unabortable `readdir` pins a libuv threadpool thread until the OS releases
  it, and four of those cost the whole process its filesystem access.
- Four new suites whose names describe behaviour rather than implementation, e.g.
  *"gives up on a listing that never returns instead of blocking create forever"*,
  *"retries a timed-out namespace once its backoff lapses, rather than wedging until restart"*,
  *"fails the scan when the gate refuses, rather than memoizing a half-read answer"*.

**I did not mutation-test 4472/4473.** They are green and coherent; they are not proven
non-vacuous. That is the next thing to do on this branch.

**STA-4479 and STA-4480 were never started.**

### Not started at all: STA-4472, STA-4473, STA-4479, STA-4480

Intended PR split (agreed, and I still think it is right):
- **PR B** — 4471 alone. Host-side enforcement, different fix site, wire-compat concern,
  overturns a documented decision.
- **PR C** — 4472 + 4473. Both are defects *of the backfill scan itself*: WSL distro coverage,
  plus a deadline, failed-Promise eviction, and routing UNC reads through the existing bounded
  WSL gate.
- **PR D** — 4479 + 4480. Two small mobile suggestion-surface defects. Branch from
  `origin/main`, **not** from the stack — shares no files.

Do not collapse these into one PR (couples unrelated risk) and do not split into five
(fragments one genuine shared cause).

---

## 4. LANE 3 — glue cluster, branch `brennanb2025/fix-glue-cluster` @ `3092531c63`

### Committed: STA-4477 (desktop glue retires a newer queued send)

```
.../native-chat/native-chat-command-marker.ts      | 111 +++++++++++++
.../native-chat/native-chat-pending-occurrence.ts  |  63 ++++++---
.../native-chat/native-chat-pending.test.ts        |  55 +++++++-
.../components/native-chat/native-chat-pending.ts  | 156 +++++----------------
.../src/components/native-chat/NativeChatView.tsx  |  12 +-
```

STA-4477 is the one glue ticket that **should still reproduce on `origin/main` today**, since
#14663 was never reverted. **Do not revert #14663 — that re-opens #14262.**

### STA-4482 reland — in progress, salvaged at teardown

The lane pushed its own work up to `077b276895`, and I snapshotted further rounds of in-flight
edits on its behalf up to `c30c9890f2`. The reland introduced:

```
mobile/src/session/mobile-native-chat-pending-baseline.ts
mobile/src/session/mobile-native-chat-pending-retirement.ts
mobile/src/session/mobile-native-chat-pending-baseline.test.ts
mobile/src/session/mobile-native-chat-pending-retirement.test.ts
```

The new `mobile-native-chat-pending-baseline.ts` suggests it was building an explicit baseline
concept rather than re-applying #14665's `glueBaselineTrusted` flag — which is the right
instinct, since that flag is precisely what STA-4492 says becomes a permanent glue barrier.
**None of it is verified and it may not compile.** The lane's reasoning did not survive.

### STA-4482 / STA-4492 — what you must know before writing any code

- `b8dc393c18` (#14819) reverted #14665 **because it caused a launch-blocking regression**.
  The revert commit message says only "This reverts commit …" — a lane reading `git log`
  alone would conclude it was cosmetic and re-apply verbatim. The PR body gives the reason.
  The two regressions to fix:
  1. a rejected mobile send restored a **trimmed** composer and dropped user draft text —
     restore the *original* composer contents;
  2. sends glued while the transcript was still loading could stay **queued forever**.
- **STA-4492 does not reproduce on current `origin/main`, and that is correct, not
  won't-fix.** `glueBaselineTrusted` appears nowhere in `mobile/` today, and 2 of the ticket's
  4 evidence files were deleted by the revert. The ticket was filed against a pre-revert span
  (its own note: "TARGET `d2ffe1f` still has #14665; #14819 is not in this span"). It returns
  the moment #14665 relands. **Therefore STA-4492 must be fixed as part of the reland, with a
  regression test** — STA-4482's reland ask #2 names this exact defect.
- STA-4482 reads **`Done`** in Linear. That reflects the *revert* landing, not a reland. It is
  genuinely outstanding.

  **Do not test this with `git merge-base --is-ancestor`.** `68ca17e46c` (#14665) *is* an
  ancestor of `origin/main` — the commit is in history — but `b8dc393c18` reverted its effect
  and is also on main. Ancestry answers "was it ever committed", not "is it live". The
  definitive check is the file:

  ```
  $ git cat-file -e origin/main:mobile/src/session/mobile-native-chat-pending-retirement.ts
  → ABSENT
  ```

  I verified all four of these: desktop half `aaa877d2a2` (#14663) is on main and **not**
  reverted; mobile half `68ca17e46c` (#14665) is in history but its file is gone; the revert
  `b8dc393c18` is on main. So **main currently ships the desktop half of a paired fix with the
  mobile half backed out** — desktop and mobile disagree about glued pending bubbles until the
  reland lands. Check the reland for parity against `aaa877d2a2` rather than treating it as
  mobile-only.
- The readiness lane found a **desktop/mobile asymmetry currently shipping on main**: #14665
  was the mobile half of #14262 and is reverted, while the desktop half `aaa877d2a2` (#14663)
  is not. Check the reland for parity against `aaa877d2a2` rather than treating it as
  mobile-only.
- STA-4388 is a related mobile ghost-queued report and is **not** this work.

### RECONSTRUCTED: what #14665 did and how each regression was caused

The lane that did this work went idle without reporting, so I reconstructed the following from
the revert diff and from the code it left behind. **This is my reconstruction, not the lane's
account** — it is evidence-backed but was not confirmed by its author.

**Regression (a) — rejected send drops draft text.** #14665 changed the send entry point from
`sendMessage(text, …)` to `sendMessage(rawText, …)` with `const text = rawText.trimEnd()` as the
first statement. The trim exists for a real reason: the host writes trailing whitespace verbatim
onto the agent's input line, where it glues the next rapid send onto this one (#14262). But the
rejection path then restored the composer from the **trimmed** `text` rather than the original
`rawText`, so a rejected send silently ate whatever the user had typed past the trim point.
Confirmed by `git show b8dc393c18 -- mobile/src/session/use-mobile-native-chat-message-send.ts`.

**Regression (b) — loading-time glued sends stay queued forever (this is STA-4492).** #14665
added a `glueBaselineTrusted: !transcriptLoading` field to each pending record. A send issued
while the transcript was still hydrating got `glueBaselineTrusted: false`, and the retirement
matcher then refused it outright:

```
    return excludedPendingIds.has(item.id) ||
      !item.glueBaselineTrusted ||          // ← permanent disqualification
      item.images?.length ||
      ...
```

Because the flag was captured once at send time and never re-evaluated, the send was
*permanently* untrustworthy — it could never retire, so it stayed a visible queued bubble **and**
acted as a glue barrier for its neighbours for the rest of the session.

### The lane's fix, recovered from its code

**(a) is fixed on the branch.** It renamed the parameter to `draftText`, kept
`const text = draftText.trimEnd()` for the bytes that go out, and restores `draftText` on
rejection, with the contract written down in the code:

> *The host writes trailing whitespace verbatim onto the agent's input line, where it can glue
> the next rapid send onto this one (#14262). Only the bytes that go out are trimmed:
> `draftText` is what the user typed, and a rejected send has to put back exactly that (#14819).*

Note this file is **untouched on `origin/main`** — main carries the pre-#14665 signature. The
`draftText` contract is the lane's own work and exists only on `brennanb2025/fix-glue-cluster`.

**(b) is addressed by replacing the flag, not restoring it.** `glueBaselineTrusted` appears
**nowhere** on the branch. In its place is a new `mobile-native-chat-pending-baseline.ts`
exporting `rebaseMobileNativeChatPendingBaselines(messages, current)`, which *rebases* a
hydration-time send onto the first authoritative read of the session's history instead of
condemning it. Its own docstring states the reasoning:

> *Such a send has no usable baseline at capture time: `messages` was empty, or still the
> previously active tab's, so both its tail and its occurrence count describe somebody else's
> transcript. Rebasing them here — rather than marking the send permanently untrustworthy, which
> stranded it as a queued bubble and as a glue barrier for its neighbours for the rest of the
> session — leaves it matching exactly the rows that arrive from now on.*

It carries a `baselineResolved` flag, recomputes `expectedOccurrence` against the real transcript,
and keeps ordinals relative to the queue so earlier still-pending sends of the same text claim the
earlier rows. **This is the right shape** and directly answers STA-4492. It is **unverified** —
no RED→GREEN proof was ever produced for it.

### Mobile QA: NOT DONE

Never attempted. It must go through `orca emulator` via `/orca-mobile-emulator-qa`.
**Never** computer-use / accessibility / OS-level input automation for Orca UI — the only
permitted exception is the screenshot capture inside that skill. If it cannot be driven,
report mobile QA **BLOCKED** rather than substituting another method.

---

## 5. LANE 4 — STA-4451, branch `brennanb2025/fix-4451` @ `2d2326e07c` — **UNVERIFIED**

I audited this branch but **never ran its tests and never proved RED**. Treat every claim in
its commits as unverified. Its history is messy: two commits with the *identical* message
`fix(workspace): bound snapshot prune tombstones` (`2d2326e07c` and `652070197c`) sitting on
top of two `[rescued]` WIP commits and a repro test. Squash before any PR.

### Safety audit — clean

Every filesystem-touching test uses `mkdtemp(join(tmpdir(), …))` throwaway roots with
`rm(…, {recursive:true, force:true})` scoped to those temp dirs. Nothing references
`/home/brennan/orca` or any registered repo; `workspace-cleanup.test.ts` mocks
`node:fs/promises` entirely. **This lane is safe to run destructively as written.**

### ⚠️ Fence question you must resolve before landing

The branch modifies **`src/main/workspace-snapshot-prune-index.ts` (+84)**. The predecessor's
own spec for STA-4451 recorded that it *"forbids touching the prune index,
`WorkspaceSnapshotPruneTarget`, or the prune key."* The narrower, owner-confirmed fence from
catshark only names `worktree-snapshot-prune-batch.ts` as a tripwire — **which this branch
does NOT touch.** So it satisfies the confirmed fence and violates the predecessor's
self-imposed one. It does not alter `WorkspaceSnapshotPruneTarget` or `workspaceSnapshotPruneKey`;
it extends `WorkspaceSnapshotPruneTombstone`. **Get an explicit ruling before landing.**

### A likely real bug I spotted by reading, unverified

`settleWorkspaceSnapshotPruneProducer` deletes a tombstone as soon as
`pendingProducerIds.size === 0`. A tombstone registered with **no** active producers starts at
size 0, so settling *any unrelated* producer appears to delete it — even while it is still
inside its `prunedAt >= scannedAt` window, which `activeWorkspaceSnapshotPruneKeys` still
treats as active. That would be premature deletion: the inverse of the bug the ticket is
about. **Verify before trusting this branch.**

Also: `expireWorkspaceSnapshotPrunes` and the fence's `activeIds` are defined — check whether
anything actually calls them, or they are dead code.

The ticket also demands an explicit answer the branch does not obviously give: **is the
retained set an unbounded *leak*, or merely long-lived *latency*?** That decides the fix shape.
The readiness lane's independent read (§7, Area 4 of `READINESS-BASELINE.md`) says both
consumers already evict via their own `clearSupersededPrunes`, so there is **no
process-lifetime leak** — which points at "latency", and means any refactor must preserve that
eviction.

---

## 6. LANE 5 — STA-4363 review of PR #14581. Two findings **verified**, verdict NOT given

Branch `brennanb2025/review-4363-scratch` @ `c7f5903a10` — PR #14581's head plus a scratch
commit. **The `zz-` files must never reach a PR**; they are prefixed that way on purpose.

I verified the sabotage restore explicitly:
`git diff 604748f58b HEAD -- mobile/src/session/mobile-native-chat-pending-retirement.ts`
is **empty**, the `isImageRefBlock` guard is back at line 125, and the scratch commit adds
**4 files, all `zz-`, zero product files**.

> **Warning for whoever resumes this.** The predecessor's runtime died with mutation M14
> ("let image turns into the literal landed-count lane") still applied to
> `mobile-native-chat-pending-retirement.ts`. It sat there looking like real work. I reverted
> it and verified byte-identity against the PR head. Before trusting any run on this branch,
> re-verify the same way. This is why "we reverted it" is not evidence.

### Finding 1 — scope is not controlled. CONFIRMED.

PR #14581 is **17 commits / 43 files / +2273 −315** for a **P2 display-only** bug whose ask is
"strip positional markers only from the prompt proven to follow a contiguous image-source run."
Confirmed via `gh pr view` and `git diff --stat origin/main...604748f58b`. Require
per-commit justification; do not accept "the diff is what it is". The lane was previously
stopped having ignored three scope directives.

### Finding 2 — a stray CI commit is riding along. CONFIRMED, and worse than reported.

Commit `824649228d` *"fix(ci): satisfy PR LoC type-aware audit"* touches **only**
`config/scripts/pr-test-loc-summary.test.mjs` — a file introduced by #14738, entirely
unrelated to native-chat image markers.

**And it is now redundant:** it is **byte-identical** to `931cb037c5`
(*"fix(ci): satisfy restrict-template-expressions in pr-test-loc-summary test (#14755)"*),
which is **already an ancestor of `origin/main`**. Both change the same line
`` `unexpected url ${url}` `` → `` `unexpected url ${String(url)}` ``. So it is a stray commit
that duplicates an already-merged fix and will conflict or vanish on rebase. **Drop it.**

### The 21-mutation harness — built, committed, NOT run to completion

`zz-mutate.py` / `zz-mutate2.py` revert one load-bearing production line at a time across
#14581's changed files and report whether the PR's own suites go RED. Mutations cover shared
marker anchoring (M1–M4, M15), transcript lifecycle (M5), the Claude decoder (M6), image-source
wire projection (M7), native-chat RPC (M8), desktop pending occurrence (M16–M19), and mobile
reconcile/echo/retirement (M12–M14, M20–M21). **This is the right instrument for the question
"is a +2273-line diff on a P2 bug actually load-bearing" — run it.**

### The deliverable, still owed

A findings report **plus an explicit SUPERSEDE-or-KEEP call on PR #14581** — not a merge.
Given ~80% of these tickets warrant superseding rather than patching, and given the scope
evidence above, supersede is the likely answer, but I did not do the work to justify it and
**I am not recording a verdict I did not earn.**

---

## 7. Environment findings that contradict the briefings

### 7.1 The #14738 "pre-existing breakage" is already fixed (type-aware half)

Verified twice, independently:
- The readiness lane ran the type-aware audit against
  `config/scripts/pr-test-loc-summary.test.mjs` alone → exit 0.
- I ran the full `audit:code-quality:type-aware` on the fix-4449-4491 branch → exit 0.
- `git merge-base --is-ancestor 931cb037c5 origin/main` → true.

The LoC-job 404 half is a CI-runtime behaviour of a `gh api …?ref=pull/N/head` call, not a
missing file; not locally reproducible, still Neil's / STA-4484, and non-blocking.

### 7.2 Other environment facts

- **Feature-wall asset budget: 10.92 / 11.00 MB — 0.08 MB headroom.** One added asset fails CI.
- **Do not typecheck mobile with bare `npx tsc`** from `mobile/` — it resolves the *root*'s
  TypeScript 7 and emits two bogus errors that look like main breakage. Mobile is deliberately
  on TS 6. Use `pnpm typecheck` from inside `mobile/`.
- **Do not run `pnpm run format` at the repo root** — it is `oxfmt --write .` and will pull 21
  already-drifted unrelated files (mostly Markdown) into your diff. Format by explicit path.
- **No root-unit-test baseline exists.** The readiness lane's root suite ran ~25 min and was
  terminated incomplete; vitest buffers its summary, so it produced *no* signal. Do not read
  it as passing. Run it sharded (`--shard=N/16`, matching CI) on the Mac.
- **No E2E baseline either**, and no packaging, and no Node 24 half of the test matrix (this
  box is Node 26 only). If a pipeline PR touches startup, session restore, or terminal
  behaviour, run a golden E2E subset before landing —
  `pnpm run test:e2e:workspace-session-golden`. It was skipped here only for memory, not
  because it is unavailable.
- A stray local tag `repro-4449-4491-failing-test` sorts ahead of the real release tags in this
  shared repo. Harmless, but anything resolving "latest tag" will pick it up.
- `scripts/runtime-watchdog.sh` (pid 16693 here) is **pipeline infrastructure, not product
  code** — keep it out of every product PR. It only ever touches display `:95`; `:78`/`:79`
  belong to neil and jinjing.

---

## 8. Still owed

- **STA-4472, STA-4473, STA-4479, STA-4480** — not started.
- **STA-4482 / STA-4492 reland** — in progress, uncommitted work at risk (§4).
- **STA-4451** — unverified; resolve the fence question and the likely premature-deletion bug.
- **STA-4363** — findings report + SUPERSEDE-or-KEEP verdict; run the mutation harness.
- **Closing `/readiness-checklist` run**, to be diffed against `READINESS-BASELINE.md`.
- **Mobile QA** for anything touching `mobile/` — never attempted.

## 9. Boundaries that stay in force

- **STA-4448 is catshark's.** Do not start it, do not PR it. Keep STA-4451 off the sidebar
  delete path and the cleanup slice. Its file set is off-limits:
  `removal-host-qualification.ts`, `remove-worktree.ts`, `worktree-operation-route.ts`,
  `worktree-helpers.ts`, `workspace-cleanup.ts`, the five destructive delete callers, and the
  `*removal*` / `*teardown*` tests.
- **Never describe STA-4343 as fully fixed**, and never describe its two-host field validation
  as covered. It is still outstanding: #14731 closed only the cleanup-dialog path, #14606 is
  the full ~4000-line fix and is dirty, the UI proof is an injected render, and the filesystem
  evidence comes only from the test suite.
- The settled STA-4448 design fork, for reference so nobody re-derives it: #14731 had the right
  contract in the wrong location (fails closed, but sits on a *caller*, so the sidebar sails
  past). #14606 has the right location, wrong contract (teardown chokepoint, but
  `requiredExecutionHostId` is *optional*, so any caller omitting it is silently unguarded).
  STA-4448 is right location **and** right contract: qualification mandatory at the teardown
  chokepoint, failing closed on absent or mismatched identity. Never bolt a second parallel
  guard onto the sidebar — two qualification mechanisms drift apart. And it is **not** true
  that "the sidebar has its own delete path": both already share one `createRemoveWorktree`;
  the bug is that the shared action never *required* host identity.
- **Never merge, never close a ticket or PR, no Slack, no pushes to a release branch.**
  Brennan reviews and merges himself. Open PRs and stop.

---

## 10. Method notes worth keeping

Two things earned their cost today and are the reason PR #14917 is trustworthy:

1. **Mutation testing beats revert testing.** A whole-file revert proved 5 tests RED, but it
   could not tell me *which mechanism* each test actually depended on. Targeted mutations found
   two vacuous tests — one my predecessor's, one my own — that the revert proof had passed.
2. **Verify restores by diffing, never by assertion.** The sabotage mutation in `review-4363`
   survived because someone recorded "reverted" without diffing. The harness reports success
   either way.
