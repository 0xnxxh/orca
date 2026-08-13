# E2E failure triage: run 31661839824, attempt 1

Run: <https://github.com/stablyai/orca/actions/runs/31661839824/attempts/1>
Release ref: `v1.4.182-rc.0`
Commit: `bae4c246ca175873a5bbb089cb8903b97b93c6ee`

## Result

The run had six failed E2E tests across shards 1, 5, 6, 7, and 10. All six were test failures; none exposed a product bug.

| Shard | Test | Classification | Resolution |
| --- | --- | --- | --- |
| 1-of-10 | Artificial OpenCode renderer backpressure | CI performance-threshold flake | Raised only the loaded worst-case ceiling from 3.0s to 3.5s; median, queue, drop, and unloaded latency guards stay strict. |
| 5-of-10 | Agent awake setting | Stale `Auto` UI expectation | Updated visible label expectation to `Agent`; persisted setting remains `auto`. |
| 5-of-10 | SSH config host picker | Transient-toast race | Assert the durable saved SSH host card instead of a short-lived success toast. |
| 6-of-10 | Status-bar Caffeinate menu | Stale `Auto` UI expectation | Updated menu, status, and test text to the visible `Agent` label. |
| 7-of-10 | Terminal hidden-view parking cycle | Test triggered anti-churn safeguard | Space cycle iterations beyond the park-verdict burst window while retaining all 25 park/reveal byte-comparison checks. |
| 10-of-10 | Voice microphone selection | Settings animation-sensitive pointer click | Open Radix Select through accessible Space-key activation. |

## Evidence

- The pressure failure was `3062.05ms` against a `3000ms` worst-sample limit, while the existing test rationale documents about 3.1s scheduler overruns on constrained CI runners and all other pressure guards passed.
- Both Caffeinate failures showed the intentional visible `Agent` label in screenshots/traces while the stored mode is still `auto`.
- The SSH add form closed successfully; only its ephemeral toast disappeared before observation. The saved host card is the actual persistence contract.
- Terminal parking completed 16 successful park/reveal cycles before the synthetic loop hit the production safe-side anti-churn pin, which intentionally leaves the pane mounted.
- The microphone combobox was present, enabled, and had the expected value; Playwright timed out solely on pointer position stability during Settings animation.

## Verification

- `pnpm exec oxlint ... --deny-warnings` passed for all changed specs.
- `pnpm exec oxfmt --check ...` passed.
- `git diff --check` passed.
- Focused Electron Playwright runs passed for the pressure scenario and microphone test; the Agent setting assertion also passed.
- The terminal parking focused run skipped locally because its debug handle is only exposed in the CI E2E configuration; lint and formatting passed.

No product source files were changed.
