# Peer ratings by Claude Opus medium

Rater: Claude Opus medium. I did **not** rate my own report (`03-claude-opus-medium.md`).

Method: skimmed all three reports end to end, then spot-checked four claims against the tree —
(1) `ssh-channel-multiplexer.test.ts:488-502` (the test all three cite as locking in the dispose
leak — **confirmed verbatim**), (2) `ipc/worktree-remote.ts:732` unguarded
`await provider.listWorktrees(...)` (**confirmed**), (3) Fable's `hasSpawnedCommandExited`
`exitCode`/`signalCode` claim against `runner.ts:313-318` and Node semantics (**confirmed** —
`exitCode` is always defined, `null` until exit and stays `null` for a signal-kill, so the
`signalCode` arm is dead code and a signal-exited child reports "not exited"), (4) Codex's
`repoCount/5` per-minute budget math (**confirmed** — `budgetTtl = count × 1000ms`, capped at 300s,
so >300 repos ⇒ rate = count/5 per minute).

I found **no false claims** in any of the three reports. The differentiation below is about
calibration, coverage, and rigor, not accuracy.

---

## Ratings

### 01-grok.md (Grok)
- overall_score: 8
- correctness: 9
- severity_calibration: 9
- specificity: 8
- completeness: 7
- actionability: 9
- top_strengths: Broadest correct coverage of the settlement-family failure modes with the sharpest severity calibration (both gate-wedge paths called P0), plus a prioritized implementer fix list and a constants appendix that make it the most immediately usable document.
- top_weaknesses: Lowest unique-finding density of the three — every finding it has, at least one other report also has, and it missed the two most consequential non-consensus items (lost cross-caller dedupe; relay error propagation to unguarded callers).
- false_positives_or_overclaims:
  - none. I checked the two claims most likely to overreach and both hold: the `dispose()` test citation is verbatim-accurate, and the "double limiter (`mapWithConcurrency(8)` + `WorktreeScanGate(8)`) — **None**" verdict is correct rather than a missed finding.
  - Minor framing nit only: the P1 heading "Sweep deadline does not stop starting scans; abort only cancels gate waiters" reads as if there is no abort at all; the fleet-wide `abortTimer` does exist and does cancel queued acquisitions. Sub-point 1 ("no `onTimeout` on the per-repo `withTimeoutFactory`") is literally true, so this is presentation, not error.
- missed_relative_to_others:
  - The `listWorktrees` → `listWorktreesStrict` switch drops the module-level `inFlightWorktreeScans` cross-caller dedupe (Codex P2, and mine). Grok's "Lenient → strict" P2 covers the *error semantics* of that swap but not the lost performance invariant — a real gap given the branch's own goal.
  - `hasSpawnedCommandExited` misclassifying signal-killed children (Fable F2) — an outright bug.
  - Relay `listWorktrees` losing `.catch(() => [])`, propagating errors to ~10 unguarded `src/main` callers (Fable F8).
  - Relay version skew / absence of `rpc.settled` capability negotiation. Grok gets close in residual-risk #7 (cancel-lost → waiter hangs) but never raises the old-relay case.
  - Codex's observation that the 5-minute TTL cap makes the "global budget" not a hard bound above ~300 repos.
- would_trust_to_ship_decision: yes

### 02-codex-gpt-5.6-sol-high.md (Codex gpt-5.6-sol high)
- overall_score: 9
- correctness: 10
- severity_calibration: 6
- specificity: 10
- completeness: 8
- actionability: 9
- top_strengths: The only report with executed validation (typecheck + 190 focused tests + 902 runtime tests) and the most precise evidence anywhere — exact line ranges on every claim, correct budget math, and the best framing of the strictness finding by anchoring it to the repo's documented Git 2.25 baseline rather than to generic "transient errors."
- top_weaknesses: Severity calibration is the outlier — it explicitly states "I found no P0 issue" while describing a permanent, restart-only-recoverable, cross-host loss of all worktree discovery triggered by an ordinary SSH disconnect; that is a P0 under any rubric the other three reports used.
- false_positives_or_overclaims:
  - none on facts. I re-derived the `repoCount/5` per-minute figure and it is right.
  - The single overclaim is the *negative* one: "I found no P0 issue." Its own P1 write-up says "Recovery requires restarting the runtime" and "One failing host can disable healthy hosts." Under-calling this is the one thing that could materially skew a ship decision made from this document alone.
- missed_relative_to_others:
  - `hasSpawnedCommandExited` signal-exit bug (Fable F2).
  - Relay `listWorktrees` error propagation to unguarded callers (Fable F8) — notable because Codex was otherwise the most call-graph-thorough reviewer.
  - Relay version skew / no `rpc.settled` capability negotiation (Fable F4, mine). Codex names the deployment question nowhere, despite raising host-scoping as its structural fix.
  - POSIX PGID-reuse hazard when signalling a reaped leader's group.
  - The commit message's claim of a `listReposMissingOnDisk` surface that does not exist in the tree.
  - Deleted repos serving stale cached worktrees indefinitely (`buildBackedOffWorktreeScanResult` ignores `scannedAt`).
- would_trust_to_ship_decision: partial — trust the evidence completely; re-grade the top finding to P0 before using its "no P0" line as a merge signal.

### 04-claude-fable-medium.md (Claude Fable medium)
- overall_score: 8
- correctness: 9
- severity_calibration: 7
- specificity: 7
- completeness: 8
- actionability: 8
- top_strengths: Highest unique-signal density in the set — it is the only report to find the `hasSpawnedCommandExited` signal-exit bug (I verified it; the `signalCode` branch is unreachable and a signal-killed child reports "not exited") and the only one to audit that the relay's dropped `.catch(() => [])` now throws into ~10 unguarded `src/main` call sites, including `canCheckoutExistingLocalBranchSsh`, which silently flips SSH worktree-create preflight semantics.
- top_weaknesses: Weakest evidence formatting of the three (`~line 313`, `orca-runtime.ts ~24997` rather than exact ranges), and two soft severity calls — F5 downgraded to "P1→P2" and F12 to P3 — where the underlying triggers are more ordinary than the write-ups concede.
- false_positives_or_overclaims:
  - none. F1, F2, and F8 all survived direct spot-checks.
  - One incomplete-rather-than-wrong item: F12 correctly identifies the `!fleet` arm of `resolveWorktreeScanCacheTtlMs` (non-sweep reads lose the 5-min agent-scratch TTL) and calls it P3 "likely intentional." That grade is fair for that arm, but the *same function* has a second arm — `fleet.activeRepoIds.has(repo.id)` is checked **before** the agent-scratch branch, and every agent-scratch repo with a running agent has a connected PTY — which silently disables the shipped 5-minute TTL for exactly its target population. Fable found the low-impact half and stopped.
  - F5's "P1→P2" downgrade ("needs timeout/abort + a tight race") understates it: `taskkill` returning 128 on an already-exited pid at the 30s `WORKTREE_LIST_TIMEOUT_MS` boundary is an ordinary race, and the consequence is permanent. Grok's P0 is better calibrated here.
- missed_relative_to_others:
  - Lost cross-caller `inFlightWorktreeScans` dedupe from the `listWorktreesStrict` switch (Codex P2, mine).
  - The 5-minute TTL cap defeating the "global budget" claim above ~300 repos (Codex).
  - The per-repo 5s timeout becoming a single fleet-wide 5s budget, and the fairness/starvation consequences of the `worktreeScanSweepCursor` advancing by exactly 8 (Grok, mine).
  - Deleted repos serving stale worktrees indefinitely.
  - The non-existent `listReposMissingOnDisk` claimed in commit `25d8636cf5`.
  - It raises PGID reuse only in residual risks and only in the "poll never resolves" direction, missing the sharper consequence: signalling a *recycled* group means SIGTERM/SIGKILL to an unrelated process group.
- would_trust_to_ship_decision: yes

---

## Ranking

1. **02-codex-gpt-5.6-sol-high** — The only reviewer who actually ran typecheck and the test suites, with exact line-range evidence on every claim and verifiable math; its findings are the ones I'd hand to an implementer unedited. Ranked first despite the severity under-call, because the underlying analysis is correct and re-grading one label is cheap, whereas the rigor is not reproducible from the other reports.
2. **04-claude-fable-medium** — Shortest report, but the only one carrying two verified findings nobody else has (`hasSpawnedCommandExited`; relay error propagation to unguarded callers), one of which is a plain bug rather than a design risk. Edges out Grok on marginal information value even though Grok is the better-calibrated and better-formatted document; loose line references and two soft severity calls keep it out of first.
3. **01-grok.md** — Correct throughout, best severity calibration in the set, and the most actionable packaging (prioritized fix list, constants appendix). Ranked third only because it is entirely subsumed: every finding it has, someone else also has, and it missed the two highest-value non-consensus items. A fine standalone read; the least additive in a four-report set.

The gap between #2 and #3 is small and is about marginal contribution to the pooled set, not about quality — if only one of the three could be read, I would pick Codex; if a ship decision had to be made from a single document, Grok's calibration makes it the safest.

---

## Consensus notes

- **Unanimous and strongest: the global `WorktreeScanGate` can be permanently wedged.** All four reports (including mine) independently reach it, via the same three sub-paths — `dispose()` never draining `trackedSettlementWaiters`, Windows `taskkill` requiring exit 0, and `if (!pid) return new Promise(() => {})`. It is corroborated by a shipped unit test that *asserts* the pending state (`ssh-channel-multiplexer.test.ts:488-502`, which I verified verbatim). This is the branch's blocking issue and needs no further adjudication — only a decision on the fix shape (drain on dispose vs. bounded settlement TTL vs. per-host gate scoping, the last being Codex's suggestion and the most structural).
- **Second consensus: strictness converts row-level failures into whole-repo scan failures.** All four flag `annotatePrunableByExistence` rethrowing non-`ENOENT`/`ENOTDIR` `stat` errors and `normalizeMainWorktreePath` throwing on `readRepoLocation` failure. Codex's framing is the one to adopt — it correctly scopes the blast radius to the pre-2.36 fallback path and ties it to the repo's documented Git 2.25 baseline, which converts a vague "transient errors" worry into a concrete compatibility contract. Fable adds the piece the others miss: this strictness escapes the scan path entirely into ~10 unguarded relay callers.
- **Worth adjudicating #1 — severity of the gate wedge.** Grok and Fable say P0; Codex says "no P0 found." Codex's own description (permanent, cross-host, restart-only recovery, triggered by a routine disconnect) argues against its own label. Recommend settling on P0 so the ship decision isn't read off Codex's summary line.
- **Worth adjudicating #2 — is the "global spawn budget" actually bounded?** Only Codex works the math (>300 repos ⇒ the 5-min cap dominates ⇒ ~repoCount/5 spawns per minute), and only Fable and I touch the `resolveWorktreeScanCacheTtlMs` precedence problem — and we each found a *different arm* of it (Fable: `!fleet` non-sweep reads; me: `activeRepoIds` checked before the agent-scratch branch). Combined, these three observations say the branch's headline "~60 spawns/min" claim does not hold for large fleets or for agent-heavy machines. No single report states that conclusion; it only emerges from pooling them, so it should be raised explicitly with the author.
- **Genuine non-overlap worth preserving when merging:** Grok's WSL `missing_repo_path` classification gap (unique to Grok); Fable's `hasSpawnedCommandExited` bug and relay-caller audit (unique to Fable); Codex's budget math and interactive-starvation framing; the lost `inFlightWorktreeScans` dedupe (Codex + me only). A merged findings list should be assembled by union, not by picking a single best report.
