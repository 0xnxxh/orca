# Blind peer rating — rater-1

| report | evidence | regression_catch | false_positive_risk | actionability | best_unique | overreach |
|--------|----------|------------------|---------------------|---------------|-------------|-----------|
| A | 5 | 3 | 5 | 5 | Cap-evicted (not-timed-out) straggler overwrites a newer store and can noteFailure a healthy successor | none |
| B | 5 | 5 | 3 | 4 | Permanent under-layer coalesce (GitLab probe first + settle-only inflight) defeats in-session recovery | F10 same-ms collision / F11 unref serve hypothesis as defects |
| C | 5 | 5 | 4 | 5 | Timed-out straggler stores null over last-known open review and short-circuits a replacement inflight | none |
| D | 4 | 4 | 5 | 4 | Dual-timeout reverse completion: later-stored older attempt suppresses a newer attempt via fetchedAt vs startedAt | none |

## Notes

- A is the most careful on-diff read (low FP, ownership-based fix) but underweights hang-path zombies and misses the timed-out late-adopt open→null wipe that C nails.
- B goes deepest under the stack with measured harnesses; several Highs are pre-existing/out-of-diff infrastructure that still invalidate the PR’s recovery claim, which inflates FP risk.
- C has the strongest PR-local correctness catch (late-adopt predicate) plus clear smallest-fix and test gaps; best balance of severity and ship-blocker judgment.
- D is tight and trustworthy on three real races/cap issues but narrower than B/C and less fix-shaped than A/C.
