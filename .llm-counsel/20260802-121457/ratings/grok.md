# Blind peer ratings (rater-1)

Scale 1–5. `false_positive_risk`: 5 = low FP / trustworthy; 1 = speculative.

| report | evidence | regression_catch | false_positive_risk | actionability | best_unique | overreach |
|--------|----------|------------------|---------------------|---------------|-------------|-----------|
| A=grok | 5 | 4 | 4 | 4 | Post–user-Connect fail clears budget window and never reopens it → unbounded auto remounts resume (finding 2B) | Web/RPC initiator drop as High without noting current paired mobile callers are still user-driven (latent vs live) |
| B=claude-opus | 5 | 5 | 4 | 5 | Sleep burns wall-clock budget + resume hard-skip defeats #7773 wake recovery (H3) | M3 “stale window parks a healthy live session” is thinner edge-case (needs exhausted window while still connected) |
| C=codex | 4 | 3 | 4 | 4 | Flap reset vs existing `STABLE_CONNECTION_MS` / flap test proving budget no-ops on sustained flaps | Elevating pre-existing flap-never-gives-up behavior to High new regression |
| D=claude-fable | 5 | 5 | 5 | 5 | Clean Disconnect leaves exhausted window → false “host unreachable” park hours later with no probe (F4) | F7 i18n note is low-value noise vs the real pause-UX issue (overlay ignoring `state.error`) |

## Notes

- Consensus core (A/B/C/D): cold `connect()` never opens the window; web/RPC drops `initiator`; 60s ≈ ~2 timeout attempts vs old 9.
- B and D uniquely catch sleep/wake budget accounting + resume skip; A and C miss that high-value regression.
- B is deepest (timelines, test gates, clean list) but slightly over-severities a few medium edges; D is tightest on FP discipline with F4 lifecycle accounting.
- C is accurate but narrow (4 findings) and under-catches product recovery regressions.
# Unblinded by coordinator
