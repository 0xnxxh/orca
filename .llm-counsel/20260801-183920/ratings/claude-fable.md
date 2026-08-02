# Unblinded ratings by claude-fable (coordinator only)
# Map: A=claude-fable, B=claude-opus, C=grok, D=codex

# Rater 4 — blind peer ratings

| report | evidence | regression_catch | false_positive_risk | actionability | best_unique | overreach |
|--------|----------|------------------|---------------------|---------------|-------------|-----------|
| A | 5 | 4 | 4 | 4 | Cap-evicted, not-timed-out straggler escapes both the `answeredSince` yield and the `noteFailure` suppression (guards are armed by `timedOut` only), with an ownership-based store-guard fix shape | Asserts "child processes are not leaked — the execs underneath have their own 30s kill paths" and calls the get-url timeout a "strict improvement"; B's quoted evidence of the unbounded GitLab-first `remote get-url` (and the other three fall-through providers) contradicts the underneath-is-bounded premise, and A never traced the swallowed-timeout → cached-null path at the hosted-review layer (only the identity-layer negative cache) |
| B | 5 | 5 | 4 | 4 | The recover-in-session claim fails below the diff: GitLab runs first with an unbounded `remote get-url` (F1) and four settle-only in-flight maps coalesce every retry onto the dead promise forever (F2) — plus measured harness numbers for the escalation-reset and leak rates | F9 (WSL tree-kill leaves the Linux-side git orphaned) is stated as fact but directly contradicts A's reading that `killSpawnedCommandTree` handles the wsl.exe→taskkill tree case; F7's >120s-while-every-step-in-bound sum assumes serial worst-case at every step |
| C | 4 | 4 | 3 | 5 | Timed-out straggler *resolving* while replacement B is in flight: the fresh stored entry short-circuits `isFresh` so later callers never join B (finding 2), backed by a concrete test-gap list | Finding 1's High severity treats late-answer adoption over an older pre-refresh entry as a bug, but the straggler's data was fetched *after* the cached entry — adopting it is the file's documented convergence intent; the "wipes an open review" framing presumes the late null is wrong, which is the debatable part |
| D | 4 | 3 | 5 | 3 | Reverse-order completion of two timed-out attempts: older A stores late, its `fetchedAt` then defeats newer B's `answeredSince` check so B's real answer is discarded — the one straggler ordering the existing test does not cover | "found no separate proven regression" in the get-url change misses the timeout-swallowed-to-cached-null path that both B (F3) and C (F5) independently establish; also frames >500 concurrent identities as reachable via "staggered requests from multiple clients," which understates the precondition |

## Notes

- B is the only report that went below the diff and attacked the branch's central claim; its F1/F2/F3 chain (quoted source, call-graph traced, harness-measured F5/F6) is the strongest single contribution, though F9 needs adjudication against A's opposite reading of the runner's WSL kill path.
- A is the most trustworthy on the cache module itself (systematic falsification, gates run), but its performance-surface conclusions inherit an unverified "layers underneath are bounded" premise.
- C and D converge with A/B on the unbounded-detached-lookup leak and the cap-eviction dedup break — that pair is effectively consensus and should anchor the merged report.
- C is the most actionable (explicit fix predicate + four named test gaps) but inflates finding 1; D is the most conservative (everything test/typecheck-verified, no speculation) at the cost of breadth and fix guidance.
- Open cross-report conflicts worth resolving in synthesis: A vs B on WSL tree-kill reach, and A vs B/C on whether a 30s get-url timeout lands as an uncached retry or a 15-minute cached "no review."
