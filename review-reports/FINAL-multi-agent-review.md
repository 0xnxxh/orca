# Multi-Agent Branch Review: `fix-p2-c2-worktree-scan`

**Date:** 2026-07-26  
**Branch:** `fix-p2-c2-worktree-scan` (`03f351a8d5`)  
**Base:** merge-base with `origin/main` (`e1f0e7689c`)  
**Commits reviewed (5):**

1. `25d8636cf5` — bound worktree scan fan-out and back off dead repos
2. `c44595cee6` — settle and back off worktree scans
3. `529dca3918` — close worktree scan settlement races
4. `3dbad6ddaf` — probe scan groups before escalation
5. `03f351a8d5` — close the scan acquisition handoff

**Process:**


| Phase              | Agents                                                                     | Artifacts                     |
| ------------------ | -------------------------------------------------------------------------- | ----------------------------- |
| Independent review | Grok · Codex `gpt-5.6-sol` high · Claude Opus medium · Claude Fable medium | `01`–`04-*.md`                |
| Peer rating        | Same four agents (each rates the other three)                              | `ratings/01`–`04-*-rates.md`  |
| Synthesis          | Coordinator (this document)                                                | `FINAL-multi-agent-review.md` |


All work was review-only; no product source was modified by the agents.

---

## Executive summary

The branch **correctly attacks** the C2 worktree-scan spawn storm: global concurrency cap (8), fleet idle TTL budget, dead-repo backoff, and settlement-aware gate release are real improvements over unbounded `Promise.all` + flat 30s TTL.

It also introduces a **structural failure mode**: gate permits release only when a settlement promise resolves, and several paths leave settlement pending forever. Because the gate is **one process-wide pool of 8**, those leaks can freeze **all** worktree scanning (local, WSL, every SSH host) until app restart.

### Ship recommendation

**Do not ship as-is.** Treat the settlement / gate-leak family as a **merge blocker**. Direction of the branch is right; fix settlement terminal states (and preferably host-scope the gate) before merge.

**Adjudicated severity of the top issue:** **P0** (3 of 4 reviewers; Codex labeled the same terminal state P1 / “no P0”). Terminal state is permanent, silent, cross-host, and restart-only recoverable from routine disconnects / kill races.

---

## Peer scoreboard

Each agent rated the other three reports (1–10 overall). Averages exclude self-scores.


| Report           | Scores received | Average  | Peer ranking notes                                                                       |
| ---------------- | --------------- | -------- | ---------------------------------------------------------------------------------------- |
| **Codex** (`02`) | 9, 9, 8         | **8.67** | Highest average; only agent that ran typecheck + tests; severity under-call on gate leak |
| **Opus** (`03`)  | 8, 7, 9         | **8.00** | Broadest inventory; some severity inflation / speculative tail items                     |
| **Fable** (`04`) | 8, 8, 8         | **8.00** | Best unique bugs (`hasSpawnedCommandExited`, unguarded caller audit)                     |
| **Grok** (`01`)  | 7, 8, 8         | **7.67** | Best evidence packaging on consensus P0s; thinner on second-tier findings                |


**Per-rater rankings of peers (best → worst):**


| Rater | 1st   | 2nd   | 3rd   |
| ----- | ----- | ----- | ----- |
| Grok  | Codex | Fable | Opus  |
| Codex | Fable | Grok  | Opus  |
| Opus  | Codex | Fable | Grok  |
| Fable | Opus  | Grok  | Codex |


**How to read this:** No single report dominates. Codex is the best validated evidence base; Fable adds unique hard bugs; Opus maximizes coverage; Grok calibrates the core blockers cleanly. A **union of findings** is required for a ship decision.

---

## Consensus findings (must address)

### C1 — Permanent global `WorktreeScanGate` wedge (P0) — **unanimous mechanism**

**What:** `WorktreeScanGate(8)` releases only when `operation.settled` settles. Several settlement paths never complete.

**Primary sub-paths (independent, compounding):**


| #   | Path                                                                      | Evidence                                                                                                                                                           | Cited by          |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| C1a | SSH mux `dispose()` never drains `trackedSettlementWaiters`               | `ssh-channel-multiplexer.ts` dispose walks `pendingRequests` only; unit test **asserts** pending settled after dispose (`ssh-channel-multiplexer.test.ts:488-502`) | All 4             |
| C1b | Windows `taskkill` requires exit code `0`; nonzero/`error` never resolves | `runner.ts` + `subprocess-tree-termination.ts`; ordinary “pid already gone → exit 128” race                                                                        | All 4             |
| C1c | `if (!pid) return new Promise(() => {})` never settles                    | Same terminate helpers                                                                                                                                             | All 4             |
| C1d | POSIX post-SIGKILL poll has no wall-clock cap                             | Same helpers                                                                                                                                                       | Grok, Codex, Opus |


**Failure mode:** ≤8 leaked permits → every subsequent scan (any host) fails acquisition → permanent `metadata-fallback` until restart.

**Fix direction (consensus shape):**

1. Drain / resolve settlement waiters on dispose, timeout, abort, and error delivery.
2. Bound all terminate-and-wait paths (Windows treat “not found” as settled; never return bare forever-promises; cap POSIX poll).
3. Prefer **host-/generation-scoped gates** (Codex) so one dead SSH connection cannot starve local scans.
4. Last-resort gate ownership TTL / reaper.

---

### C2 — Strict auxiliary probes erase whole-repo graphs (P1) — **unanimous**

**What:** Previously best-effort enrichment now throws and fails the entire listing:

- `annotatePrunableByExistence` / relay twin: non-`ENOENT`/`ENOTDIR` stat → whole-list failure  
- `normalizeMainWorktreePath` / `readRepoLocation`: failed secondary `rev-parse` → throw

**Impact:** One unreadable linked worktree (TCC, NFS, EPERM) or transient `rev-parse` → `scan_failed` + exponential backoff up to 5 min blindness. Hits **Git 2.25–2.35** `-z` fallback path hard (repo’s documented baseline).

**Fix direction:** Keep settlement/cancellation strict; keep enrichment best-effort; mark row-level unknown rather than discarding the graph.

---

### C3 — Interactive / sweep starvation on shared FIFO gate (P2) — **strong consensus**

Background sweeps and explicit user refreshes share the same 8-slot FIFO gate. Explicit path has a 5s acquisition abort → can return stale/metadata without spawning git while 8 slow background scans hold permits.

**Fix direction:** Priority lane or reserved capacity for user-triggered scans; separate background vs interactive budgets with an aggregate host bound.

---

## High-value non-consensus findings (verified / high confidence)


| ID  | Severity       | Finding                                                                                                                                                                  | Source         | Peer validation                                                               |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ----------------------------------------------------------------------------- |
| U1  | **P1**         | `hasSpawnedCommandExited` misclassifies signal-killed children (`exitCode` stays `null` after signal; `signalCode` branch dead) → maxBuffer settle path can hang forever | **Fable only** | Spot-checked true by Grok, Codex, Opus                                        |
| U2  | **P1**         | Runtime switched to `listWorktreesStrict`, losing module-level `inFlightWorktreeScans` cross-caller dedupe + generation coupling                                         | Codex, Opus    | Confirmed by Fable on re-read                                                 |
| U3  | **P1/P2**      | Relay `listWorktrees` no longer swallows to `[]`; ~10 unguarded callers (e.g. `canCheckoutExistingLocalBranchSsh`) change behavior                                       | **Fable**      | Confirmed unguarded site by Opus                                              |
| U4  | **P1?**        | Agent-scratch 5 min TTL: active-PTY path checked first → scratch repos **with running agents** get 30s TTL                                                               | Opus           | Grok/Codex: real but overstated as “fully disabled”; idle scratch still 5 min |
| U5  | **P2**         | Idle TTL 5 min cap ⇒ advertised “~60 scans/min” fails for fleets **&gt; ~300** repos (~`repoCount/5` per min)                                                            | Codex          | Accepted by others                                                            |
| U6  | **P2**         | WSL missing roots never get `missing_repo_path` fast backoff (always `scan_failed`)                                                                                      | Grok           | Unchallenged                                                                  |
| U7  | **P2/cond.**   | Old relay never emits `rpc.settled` → systematic leak if version skew possible                                                                                           | Opus, Fable    | Codex: check deploy/handshake invariant before treating as ship-blocker       |
| U8  | **P3/hygiene** | Commit `25d8636cf5` claims `listReposMissingOnDisk` surface that does not exist in tree                                                                                  | Opus           | Confirmed by Fable                                                            |
| U9  | **P2**         | Deleted repos can serve stale cached worktrees indefinitely (`scannedAt` ignored on backoff path)                                                                        | Opus           | Noted by peers                                                                |
| U10 | **P2**         | “Active” = connected PTY only → visible-but-idle repos up to ~5 min external discovery lag                                                                               | All            | Product trade; document or add visibility signal                              |


---

## What the branch gets right (do not regress)

- Unbounded all-repo `Promise.all` → concurrency-capped sweep (`WORKTREE_SCAN_CONCURRENCY = 8`).  
- Flat 30s TTL spawn storm → fleet-budgeted idle TTL + exponential failure backoff.  
- Dead missing-path backoff for native/SSH (when classified).  
- In-flight runtime dedupe for resolution scans; generation / runtimeKey identity for provider reconnect.  
- Settlement concept (don’t release permit while remote/local process tree may still live) is sound **if** settlement is always terminal.

Codex ran validation: focused Vitest (190), large `orca-runtime` suite (902), `typecheck:node` — all passed on this branch. That does **not** cover the permanent hang paths (several are locked in by unit tests that assert non-settlement).

---

## Adjudicated decisions for the author


| Question                        | Decision                          | Rationale                                                                                                    |
| ------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Gate wedge severity             | **P0 merge blocker**              | 3/4 reviewers; permanent cross-host liveness loss; unit test documents intentional non-settlement on dispose |
| Codex “no P0”                   | **Reject as ship signal**         | Same terminal state as others; under-labels for release triage                                               |
| Old-relay skew                  | **Verify deploy invariant first** | If handshake hard-pins relay version, demote; if not, treat as P0 amplifier                                  |
| Agent-scratch TTL               | **Policy call, not pure bug**     | Idle scratch still 5 min; active-agent 30s may be intentional freshness                                      |
| Fable remote “no timeout” claim | **Partially wrong**               | Mux has 30s request timeout + cancel; hang risk is still real via settlement defects                         |
| Permanent ownership philosophy  | **Must be bounded**               | Resource-honest uncertainty cannot live on a process-global 8-slot gate                                      |


---

## Recommended fix order

1. **P0 — Settlement always terminates**
  - Dispose drains `trackedSettlementWaiters` (resolve).  
  - Windows: treat taskkill not-found / nonzero appropriately; never hang on `error`.  
  - Never return `new Promise(() => {})` for `!pid`.  
  - Cap POSIX poll.  
  - Fix `hasSpawnedCommandExited` (`exitCode !== null || signalCode !== null`).  
  - Tests that **prove** connection-loss and kill-race release the gate (invert today’s dispose test).
2. **P0/P1 — Contain blast radius**
  - Scope gate by execution host / provider generation.  
  - Gate ownership TTL reaper as belt-and-suspenders.
3. **P1 — Strictness rollback for enrichment**
  - Row-level best-effort prunable/normalize probes.  
  - Audit relay error propagation to non-scan callers.
4. **P1 — Restore cross-module dedupe**
  - Either route runtime through `listWorktrees` again or port `inFlightWorktreeScans` + generation into strict path.
5. **P2 — Interactive priority + budget honesty**
  - Reserved/priority capacity for explicit scans.  
  - Fix budget math for large fleets / active-repo denominator.  
  - WSL missing-path classification.

---

## Per-agent report digests

### Grok — `review-reports/01-grok.md`

- **Headline:** Fan-out cap / TTL / backoff fix the storm; **P0 gate leaks** via SSH dispose + Windows taskkill.  
- **Strengths:** Sharp P0 framing, unit-test evidence for intentional dispose non-settlement, actionable fix list.  
- **Gaps:** Missed `hasSpawnedCommandExited`, lost cross-caller dedupe, relay caller blast radius.  
- **Peer trust:** High on blockers; partial as sole ship doc (completeness).

### Codex (`gpt-5.6-sol` high) — `review-reports/02-codex-gpt-5.6-sol-high.md`

- **Headline:** Two P1s — global unsettled gate wedge; Git 2.25–2.35 fatal probes; four P2s (interactive starvation, lost dedupe, discovery lag, non-binding budget).  
- **Strengths:** Only executed validation; precise lines; budget math; host-isolation fix direction.  
- **Gaps:** Severity under-call (“no P0”); missed signal-exit hang; weak on relay version skew.  
- **Peer trust:** Highest average score; re-grade top issue to P0 before using summary as merge signal.

### Claude Opus medium — `review-reports/03-claude-opus-medium.md`

- **Headline:** Three permanent wedge paths as P0; agent-scratch TTL precedence; lost dedupe; fleet-wide 5s deadline starvation; many second-order findings (18 total).  
- **Strengths:** Completeness, compounding analysis (relay hang → no `rpc.settled` → desktop gate leak).  
- **Gaps / nits:** Some inflated P2→P1 rhetoric; agent-scratch “disabled” overstated; wrong line refs on small gate file.  
- **Peer trust:** Best exhaustive inventory; adjudicate tail items carefully.

### Claude Fable medium — `review-reports/04-claude-fable-medium.md`

- **Headline:** 12 findings — P0 mux dispose; P1 signal-exit hang; hung remote / old-relay / Windows race; strictness + unguarded callers.  
- **Strengths:** Unique hard bugs with correct Node semantics reasoning; call-site audit.  
- **Gaps:** Looser line refs; one overstated “no remote timeout” claim; softer Windows severity.  
- **Peer trust:** Highest unique signal density; must be merged into fix list.

---

## Artifact index

```
review-reports/
  01-grok.md
  02-codex-gpt-5.6-sol-high.md
  03-claude-opus-medium.md
  04-claude-fable-medium.md
  ratings/
    01-grok-rates.md
    02-codex-rates.md
    03-opus-rates.md
    04-fable-rates.md
  FINAL-multi-agent-review.md   ← this file
```

### Orchestration task IDs (reference)


| Phase  | Agent | Task ID             |
| ------ | ----- | ------------------- |
| Review | Grok  | `task_06e4fa561fc6` |
| Review | Codex | `task_c1c75b6b6d31` |
| Review | Opus  | `task_4f1bcc01444c` |
| Review | Fable | `task_255535d752ff` |
| Rating | Grok  | `task_6848fe8e1985` |
| Rating | Codex | `task_824d89091cf4` |
| Rating | Opus  | `task_e93ecd09634e` |
| Rating | Fable | `task_6bf620619692` |


---

## Bottom line

Four independent reviews converge on the same story: **the C2 fix works as a concurrency design, but settlement-owned global permits turn ordinary SSH disconnects and kill races into a process-wide scan outage.** Fix settlement terminal states and containment first; then roll back enrichment strictness and restore cross-caller dedupe. Until then, treat the branch as **not shippable**.