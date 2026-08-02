Review the shit out of the current branch and find performance / functionality regressions.

Scope:
- Worktree: /Users/jinjingliang/Documents/projects/orca/P1-D-hosted-review-inflight
- Base: see .llm-counsel run dir base.txt .. HEAD plus uncommitted changes
- Focus: performance regressions and functionality regressions first; then correctness/lifecycle risks
- Branch theme: P1-D hosted review inflight (deadline-bound hosted-review lookups, git remote get-url bounds)

Rules:
- Review-only. Do not edit production code.
- Stay in this worktree. Do not follow absolute paths into other checkouts.
- Proven findings only: file + line, severity (Critical/High/Medium/Low), impact, evidence.
- Actively try to falsify the branch claim. Prefer concrete failure scenarios over style nits.
- Cover hot paths touched by the diff (render, stream, send, timers, listeners, unbounded buffers, RPC).
- Write your full report to: REPORT_PATH_PLACEHOLDER
- Also put a 3-sentence executive summary in worker_done body.
- In worker_done payload include: taskId, dispatchId, reportPath, filesModified:[], findingsCount, topSeverity
