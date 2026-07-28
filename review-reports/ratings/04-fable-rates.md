# Peer ratings by Claude Fable medium

Method: full read of all three reports; spot-checked the highest-stakes claims against the code rather than re-reviewing the branch. Verified: (a) `inFlightWorktreeScans` map exists at `src/main/git/worktree.ts:701` and `listWorktreesStrict` (:803) bypasses it — the "lost cross-module dedupe" claim in Codex/Opus is real and I missed it in my own review; (b) the mux dispose leak is indeed locked in by a unit test (`ssh-channel-multiplexer.test.ts:488-501`) as Grok says; (c) commit `25d8636cf5` really does claim a `listReposMissingOnDisk` surface that greps to nothing in `src/` — Opus F17 confirmed.

## Ratings

### 01-grok.md (Grok)
- overall_score: 8
- correctness: 9
- severity_calibration: 8
- specificity: 8
- completeness: 7
- actionability: 8
- top_strengths: Nails the settlement/gate-leak family (SSH dispose, Windows taskkill, POSIX poll, `!pid`) with the sharpest single piece of evidence in any report — the unit test proving the dispose leak is *intentional* — and frames the key product question ("is permanent gate ownership intended?") correctly.
- top_weaknesses: Thinnest on second-tier findings — misses the lost in-flight dedupe, the agent-scratch TTL neutralization, the stale-cache-forever-on-deleted-repo behavior, and the relay-throw blast radius to non-scan callers.
- false_positives_or_overclaims:
  - Minor: "P1 — Sweep deadline does not stop starting scans" bundles a correct observation with an overstated impact ("retry pile-ups"); in-flight dedupe within the runtime bounds the pile-up per repo. Directionally fine.
  - None material — every claim I spot-checked matched the code.
- missed_relative_to_others:
  - Lost `inFlightWorktreeScans`/`bumpWorktreeScanGeneration` coupling from the `listWorktreesStrict` switch (Codex P2, Opus F5).
  - Agent-scratch 5-min TTL neutralized when the scratch repo has a connected PTY (Opus F4).
  - Relay `listWorktrees` now throws to ~10 non-scan callers (my F8; Codex partially via normalization framing).
  - Old-relay `rpc.settled` version-skew trigger (Opus, mine).
  - Deleted repo serves stale worktrees indefinitely (Opus F9), phantom `listReposMissingOnDisk` commit claim (Opus F17).
- would_trust_to_ship_decision: partial — trustworthy on the blockers, but a ship decision also needs the throughput/dedupe regressions it didn't surface.

### 02-codex-gpt-5.6-sol-high.md (Codex gpt-5.6-sol high)
- overall_score: 8
- correctness: 9
- severity_calibration: 6
- specificity: 8
- actionability: 8
- completeness: 8
- top_strengths: Only report that actually ran validation (190 focused tests, 902 runtime tests, typecheck) — its claims rest on executed evidence; unique catches include the budget-cap math (>300 repos ⇒ rate reverts to linear, ~repoCount/5 per min) and crisp Git 2.25–2.35 baseline framing tied to the repo's documented compatibility contract.
- top_weaknesses: Severity calibration is the outlier — "I found no P0" labels a permanent, restart-only, cross-host loss of all worktree scanning (reachable from one routine SSH disconnect) as P1, while every other reviewer (me included) puts that terminal state at P0; its own failure-mode narrative describes a P0.
- false_positives_or_overclaims:
  - "readily produced by one SSH connection with eight repos" is slightly optimistic about hitting all 8 permits in one event (runtime in-flight dedupe = 1 per repo, but 8 repos on one connection does satisfy it) — acceptable.
  - none otherwise; the dedupe-loss claim (its P2) verified against `worktree.ts:701/:803`.
- missed_relative_to_others:
  - Windows taskkill exit-128 / `!pid` never-resolve branches are folded into the P1 evidence list rather than surfaced as their own finding with the compounding relay→`rpc.settled`→desktop chain (Opus F2 does this best).
  - Agent-scratch TTL neutralization (Opus F4), stale-forever deleted repo (Opus F9), commit-message false claim (Opus F17), old-relay version-skew trigger.
- would_trust_to_ship_decision: partial — the analysis is rigorous and validated, but the "no P0" headline would understate the risk to a release owner reading only the summary.

### 03-claude-opus-medium.md (Claude Opus medium)
- overall_score: 9
- correctness: 9
- severity_calibration: 9
- specificity: 9
- completeness: 10
- actionability: 9
- top_strengths: The most complete report by a clear margin — 18 findings including several no one else caught (F4 agent-scratch TTL neutralized by `activeRepoIds` precedence, F9 deleted repos serve stale worktrees forever, F17 commit-message claims a nonexistent `listReposMissingOnDisk` surface — all three verified), plus the sharpest compounding analysis (relay F2/F3 hang ⇒ no `rpc.settled` ⇒ desktop F1) and diff-anchored "the predecessor handled this correctly" evidence throughout.
- top_weaknesses: Some tail findings run hot: F8 (PGID reuse on the success path) says "this is not hypothetical" for a microseconds-wide reuse window between reap and probe, and F12's authoritative-flip races are cosmetic churn presented with more weight than their bounded blast radius warrants.
- false_positives_or_overclaims:
  - F8 severity rhetoric: mechanism is real (and the scariest variant — SIGKILLing an unrelated recycled group), but the probe runs immediately after child exit, so the reuse window is far narrower than "hundreds of processes per minute" implies. P2 label is fine; the prose oversells.
  - F4 is code-correct (verified the precedence) but plausibly intentional ("running agent ⇒ want freshness"); the report does hedge this in open question 3, so borderline rather than a false positive.
  - F15's 1Hz-path cost items are individually negligible (I checked `resolveLocalProjectRuntimesForRepos` — pure in-memory); correctly rolled up as minor.
- missed_relative_to_others:
  - Relay `listWorktrees` dropping `.catch(() => [])` for *all* callers — the ~10 unguarded non-scan call sites (e.g. `canCheckoutExistingLocalBranchSsh` in worktree-create preflight) whose `[]`-on-error contract changed (my F8). Opus covers the strictness class (F6) but not this caller-contract blast radius.
  - The `hasSpawnedCommandExited` exitCode-ternary bug making the maxBuffer settle path hang (my F2) — Opus catches the adjacent taskkill/`!pid` hangs but not this specific misclassification.
- would_trust_to_ship_decision: yes — its blocker list, severity ordering, and open questions are what I would hand a release owner.

## Ranking

1. **03-claude-opus-medium.md** — broadest coverage with verified unique findings (F4/F9/F17), best cross-bug compounding analysis, and well-ordered severities; only mild tail-risk overstatement.
2. **01-grok.md** — best evidence quality on the core P0 family (found the test that proves intent) and correct headline framing, but misses most of the second-tier regressions.
3. **02-codex-gpt-5.6-sol-high.md** — rigorous and the only validated report, with unique budget-math and dedupe catches, but the "no P0" calibration materially understates the branch's worst failure mode. (Ranks a hair below Grok on calibration; above it on completeness — the calibration miss is the more dangerous error for a ship decision.)

## Consensus notes

- **Unanimous (4/4 including my report): the settlement-owned global 8-slot gate can permanently wedge all worktree scanning.** Every report independently identified the mux `dispose()` leaving `trackedSettlementWaiters` unresolved, and the Windows/`!pid` never-resolving termination promises, with restart as the only recovery. This is the strongest, best-evidenced finding on the branch and the clear must-fix. Grok's contribution: a unit test *asserts* the leak, so the fix requires a product decision, not just a patch.
- **Strong consensus (3-4/4) on the strictness regressions** — non-ENOENT prunable-probe errors and the now-throwing `normalizeMainWorktreePath` turning single-path/aux-probe failures into whole-repo scan failures with backoff — and on "active = connected PTY only" causing up to 5-minute staleness for visible repos.
- **Worth adjudicating: severity of the gate wedge.** Codex calls it P1 ("no P0 found"); Grok, Opus, and I call the same terminal state P0. Recommend the coordinator treat it as P0: single routine trigger, silent, cross-host, unrecoverable without restart.
- **Worth adjudicating: agent-scratch TTL precedence (Opus F4) and the fleet-wide 5s deadline (Opus F7 / Grok P1).** Both are code-verified behavior changes that may be deliberate (my prior context says the fleet-wide deadline was an explicit choice); they need an intent ruling rather than a reflexive fix. Also note Codex's budget-cap math (>300 repos ⇒ spawn rate linear again) as a quiet contradiction of the branch's headline claim.
