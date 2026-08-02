| report | evidence | regression_catch | false_positive_risk | actionability | best_unique | overreach |
|---|---:|---:|---:|---:|---|---|
| A | 5 | 4 | 4 | 5 | Cap-evicted straggler rejection can penalize a healthy successor | Claim that detached work cannot leak child processes because all lower layers are 30s-bounded |
| B | 5 | 5 | 4 | 5 | Permanent lower-layer promise coalescing can defeat in-session recovery despite the outer deadline | WSL timeout necessarily leaves the Linux-side git orphaned is not demonstrated |
| C | 5 | 5 | 4 | 5 | Timed-out refresh can replace a cached open review with `null` while a replacement is running | SSH-path brittleness is speculative after acknowledging the relay timeout contract |
| D | 5 | 5 | 5 | 4 | Reverse-order completion can make an older timed-out attempt suppress a newer attempt's answer | none |

Reports B–D identify concrete regressions on ordinary timeout/retry paths; A's strongest bugs require the >500-inflight cap edge.
B has the broadest call-graph evidence, while C gives the clearest user-visible stale-to-negative-cache scenario and smallest fix.
D is the most disciplined and trustworthy, but offers less explicit remediation than A–C.
