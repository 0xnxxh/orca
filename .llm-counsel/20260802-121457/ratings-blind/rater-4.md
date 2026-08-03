# Rater 4 — blind ratings (reports A–D)

| report | evidence | regression_catch | false_positive_risk | actionability | best_unique | overreach |
|--------|----------|------------------|---------------------|---------------|-------------|-----------|
| A | 5 | 4 | 5 | 4 | User Connect resets the budget *before* success, so a failed user reconnect leaves no open window and unbounded auto remounts resume (finding #2, scenario B) | none material — #6 (runtime-owned id inherits exhausted window) is lightly evidenced but plausible and marked Low |
| B | 5 | 5 | 5 | 5 | Parked state is broadcast-only/never authoritative (later `ssh:getState` disagrees) **and** the overlay derives copy from `status` alone, so `AUTO_RECONNECT_PAUSED_MESSAGE` never reaches the user (M2); also the proof that the IPC park test must hand-synthesize the window because no production path opens it cold (H4) | H3 step 1 states the woken pre-sleep timer attempt fails "before the network stack is up" as near-certain; that ordering is environment-dependent, though the conclusion survives without it |
| C | 4 | 3 | 4 | 2 | `web-preload-api.test.ts:3417` already pins the lossy `{ targetId }` RPC payload — sharpest evidence for the initiator-drop finding; plus the deepest flap-storm analysis tied to `STABLE_CONNECTION_MS` semantics | Rating the flap-reset gap High as something "this change claims to bound": the pre-branch ladder behaved identically on flaps (C's own cited test predates the branch), so it's a claim-completeness gap, not a High regression |
| D | 5 | 4 | 4 | 4 | Stale exhausted window survives a clean user **Disconnect** → hours later an `'auto'` connect parks with a false "host unreachable" and fails automation dispatch without a single probe (F4); also F1's note that paired-client storms flip the desktop's parked UI state back | F7 assumes the paused message "rides into renderer overlays" — per A#7/B M2(b) the pane overlay ignores `state.error`, so the message is actually dropped; D missed that and built a Low on a partly wrong premise |

## Notes

1. Strong four-way consensus on the two load-bearing findings — runtime-RPC drops `initiator` (re-arms budget from paired/web clients) and the cold/initial-connect path never opens a window — so both should be treated as confirmed merge blockers.
2. B is the most complete: only report with all of {RPC drop, cold path, sleep/wake, 60s/never-expires, overlay message loss, authoritative-state gap}, plus verified negatives (clamp can't hit 0ms, relay loop terminates) and a prioritized pre-merge list.
3. A and D are close peers with disjoint blind spots: A missed sleep/wake entirely (framed the resume guard as "holds"), D missed the flap-reset gap and the overlay dropping the paused message.
4. C is accurate and adds unique evidence but has the narrowest regression coverage (no sleep/wake, no 60s-too-short/never-expires) and offers no fix directions; it also could not run tests (missing vitest binary, disclosed honestly).
5. FP discipline is good across all four; disagreements are severity framing, not fabricated facts.
