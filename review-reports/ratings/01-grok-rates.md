# Peer ratings by Grok

Rater: Grok. Rated the three peer reports only (`02`, `03`, `04`); did **not** score own report `01-grok.md`.
Method: full skim of each report; spot-checked contested claims against current code (`hasSpawnedCommandExited` / maxBuffer settle path, `resolveWorktreeScanCacheTtlMs` agent-scratch ordering, prunable probe throw, mux dispose, Windows taskkill finish condition). No product source changes.

## Ratings

### Codex gpt-5.6-sol high (`review-reports/02-codex-gpt-5.6-sol-high.md`)
- overall_score: 9
- correctness: 9  # claims match code?
- severity_calibration: 8  # P0/P1/P2 justified?
- specificity: 9  # paths/functions/call chains?
- completeness: 8  # missed major issues relative to consensus?
- actionability: 9
- top_strengths: Tight evidence chains, ran real tests/typecheck, host-isolation + required-direction framing that is actually shippable.
- top_weaknesses: Under-rates permanent global gate wedge as P1 (consensus/code supports P0), and missed the unique `hasSpawnedCommandExited` signal-exit hang.
- false_positives_or_overclaims:
  - none material; P1 vs P0 on gate leak is calibration preference, not a false bug
  - “no P0” framing may under-communicate restart-only recovery to a ship gate
- missed_relative_to_others:
  - Fable F2: `hasSpawnedCommandExited` misclassifies signal deaths → maxBuffer settle path never resolves (`exitCode` stays `null` after SIGTERM; confirmed in Node)
  - Opus/Fable: old-relay / no-`rpc.settled` version-skew as a systematic leak amplifier
  - Fable: relay `listWorktrees` error-propagation blast radius to non-scan callers (`canCheckoutExistingLocalBranchSsh`, etc.)
  - Opus: agent-scratch **active** TTL interaction (partial — see Consensus; severity overclaimed elsewhere)
- would_trust_to_ship_decision: yes

### Claude Opus medium (`review-reports/03-claude-opus-medium.md`)
- overall_score: 8
- correctness: 7  # claims match code?
- severity_calibration: 7  # P0/P1/P2 justified?
- specificity: 9  # paths/functions/call chains?
- completeness: 9  # missed major issues relative to consensus?
- actionability: 8
- top_strengths: Broadest coverage of second-order effects (fleet deadline vs gate zombies, authority/metadata-fallback churn, folder-behind-git ordering, missing commit surface `listReposMissingOnDisk`).
- top_weaknesses: Inflates some P1s and overstates agent-scratch TTL as “disabled”; wrong gate line refs (`worktree-scan-gate.ts:971-985` on a ~137-line file).
- false_positives_or_overclaims:
  - **F4 overclaim:** agent-scratch 5‑min TTL is **not** fully disabled. Spot-check of `resolveWorktreeScanCacheTtlMs`: idle (non-`activeRepoIds`) scratch still returns 5 min; only scratch with a connected PTY falls through the active branch to 30 s. That is a real change for *running* agents, but the original constant targeted *idle* scratch fan-out, so “disabled for the population it targeted” oversells P1.
  - Ranking three independent permanent-wedge paths as three separate P0s is defensible, but stacks severity without weighting likelihood (Windows race / `!pid` rarer than SSH dispose).
  - F12 generation-race / 30s authority boundary may be real but is thinner than presented as user-visible churn.
- missed_relative_to_others:
  - Fable’s `hasSpawnedCommandExited` maxBuffer hang (distinct from taskkill / `!pid`)
  - Codex’s hard “budget is not a hard bound past 300 repos” math (Opus notes active-budget denominator weakly)
  - Did not execute the suite (Codex did)
- would_trust_to_ship_decision: partial

### Claude Fable medium (`review-reports/04-claude-fable-medium.md`)
- overall_score: 8
- correctness: 9  # claims match code?
- severity_calibration: 8  # P0/P1/P2 justified?
- specificity: 8  # paths/functions/call chains?
- completeness: 7  # missed major issues relative to consensus?
- actionability: 8
- top_strengths: Best unique technical bug (`hasSpawnedCommandExited` + maxBuffer path), correct P0 on mux dispose, and useful call-site audit of relay error-propagation outside the scan path.
- top_weaknesses: Less depth on TTL budget math, cross-module dedupe, and fleet-deadline starvation than Codex/Opus; some findings stay “conditional” without runtime composition tests.
- false_positives_or_overclaims:
  - none material on F1/F2 (F2 spot-checked: after `SIGTERM`, `exitCode === null`, helper returns “not exited” → `leaderClosed` never set if `'close'` already fired)
  - F4 (old relay) correctly labeled conditional on deployment invariant
  - F5 Windows taskkill slightly soft-pedaled as “P1→P2” relative to consensus P0/P1, but the race reasoning is sound
- missed_relative_to_others:
  - Codex/Opus: lost `listWorktrees` module-level in-flight dedupe via `listWorktreesStrict` (cold-start double-spawn)
  - Codex: idle TTL cap breaks “60/min budget” for fleets >300; interactive priority inversion as first-class issue
  - Opus: agent-scratch active-path TTL change; authority prune/`metadata-fallback` reporting subtleties; folder repos queued last behind git
  - Opus F17: commit claims `listReposMissingOnDisk` surface that does not exist
- would_trust_to_ship_decision: partial

## Ranking

1. **Codex gpt-5.6-sol high** — Best overall ship-decision document: validated claims against tests, precise failure modes, conservative-but-clear severity, and concrete host-isolation fix direction without false drama.
2. **Claude Fable medium** — Highest-value unique finding (`hasSpawnedCommandExited`) and accurate P0 on SSH dispose; slightly thinner on budget/dedupe/completeness than Codex/Opus.
3. **Claude Opus medium** — Most exhaustive inventory and strong residual questions (relay version pin), but severity inflation and the agent-scratch “disabled” overclaim reduce trust relative to raw volume.

## Consensus notes

- **Strongest agreed finding:** Global `WorktreeScanGate(8)` releases only on `settled`; SSH mux `dispose` leaves `trackedSettlementWaiters` pending forever (unit test locks this in). One multi-repo SSH disconnect (or repeated single leaks) can freeze **all** hosts’ worktree scans until restart. Severity label differs (Codex P1 vs others P0) but the bug is consensus and ship-blocking in practice.
- **Strongly agreed:** Windows `taskkill` requiring `code === 0` (and empty `error` handler / `!pid` → never-settle) permanently owns gate permits; POSIX settle poll has no wall-clock cap.
- **Strongly agreed:** Making prunable existence / main-path normalization fatal (throw on non-ENOENT / failed rev-parse) is a real functionality regression on Git 2.25–2.35 and permission/network mounts — whole-repo `scan_failed` + backoff.
- **Disagreement worth adjudicating:**
  1. **P0 vs P1 on gate leak** — Same terminal state; Codex’s “P1 + host isolation” is product-calibration; others treat restart-only global wedge as P0. Recommend treat as **merge blocker either way**.
  2. **Agent-scratch TTL** — Opus P1 “disabled” is overstated; idle scratch still 5 min. Active-scratch → 30 s is a deliberate-or-not policy call, not a total disable.
  3. **Fable’s `hasSpawnedCommandExited` hang** — Not in Codex/Opus; spot-check confirms it is real and should be in the fix list next to Windows taskkill.
  4. **Relay version skew** — Opus/Fable flag missing capability negotiation for `rpc.settled`; unresolved whether deploy pins relay binary (if not, systematic leak = P0).
