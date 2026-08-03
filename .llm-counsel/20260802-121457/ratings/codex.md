| report | evidence | regression_catch | false_positive_risk | actionability | best_unique | overreach |
|---|---:|---:|---:|---:|---|---|
| A=grok | 5 | 5 | 4 | 5 | Near-exhaustion auto connect can enter the full initial-retry loop after the nominal deadline. | Runtime-owned target budget retention is weak because its connect path is user-classified and resets the entry. |
| B=claude-opus | 5 | 5 | 3 | 5 | Broad failed-status gating can newly abort PTY reattach on a relay-error race, beyond the paused state. | The claim that an exhausted check can park a healthy live session relies on speculative stale-window paths and overstates relay-state clearing effects. |
| C=codex | 5 | 4 | 4 | 4 | The deadline clamp schedules a final handshake exactly at exhaustion, extending SSH work by up to the connect timeout. | Rapid-flap handling is plausibly incomplete, but High severity is debatable because successful handshakes are explicitly treated as new outage epochs. |
| D=claude-fable | 5 | 5 | 4 | 5 | Explicit disconnect can leave an aging budget that later falsely parks an automatic reconnect without probing. | The Reset Relay recovery claim is not fully traced through that handler's own reconnect lifecycle. |

Notes:
B is the broadest and best verified, but its long tail contains several low-value or speculative findings.
C is the most concise and trustworthy, with one particularly sharp boundary-timer catch.
A and D both identify the headline web/RPC and cold-connect bypasses with strong concrete evidence.
# Unblinded by coordinator
