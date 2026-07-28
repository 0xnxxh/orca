# Peer ratings by Codex gpt-5.6-sol high

## Ratings

### Grok
- overall_score: 7
- correctness: 7
- severity_calibration: 5
- specificity: 9
- completeness: 7
- actionability: 8
- top_strengths: Precisely traces the mux-dispose and Windows `taskkill` settlement leaks through the single global gate, with useful code and test evidence.
- top_weaknesses: It promotes recoverable, accumulation-dependent process-lifetime outages to P0 and treats some deadline bookkeeping as new scan I/O.
- false_positives_or_overclaims:
  - Both P0 labels are overcalibrated; the failure is severe and persistent but requires in-flight failures/leaked permits and is recoverable by runtime restart, fitting P1.
  - The statement that a disposed SSH session means “there is no process tree left” is not established; the lost transport makes the remote process unobservable, not necessarily terminated.
  - Repos visited after the fleet abort still call the wrapper, but the already-aborted acquisition signal prevents `startOperation`, so they do not race a new real Git spawn as the report implies.
  - The relay existence-probe issue applies to the pre-2.36 `-z` fallback, not only Git <2.31.
- missed_relative_to_others:
  - The `hasSpawnedCommandExited` / `signalCode` bug on the max-buffer callback-after-close path.
  - Loss of the module-level cross-caller `listWorktrees` in-flight dedupe after switching the runtime to `listWorktreesStrict`.
  - The broader relay behavior change from returning `[]` to rejecting at non-runtime-scan callers.
- would_trust_to_ship_decision: partial

### Claude Opus medium
- overall_score: 7
- correctness: 6
- severity_calibration: 5
- specificity: 10
- completeness: 10
- actionability: 8
- top_strengths: The most exhaustive report, with excellent call-chain detail and valuable findings on lost cross-module dedupe, strict auxiliary probes, folder-workspace latency, and repeated per-sweep work.
- top_weaknesses: The 18-finding breadth includes several speculative or incorrect mechanisms and repeatedly inflates P2 risks to P1/P0.
- false_positives_or_overclaims:
  - Old-relay settlement skew is presented as an independent trigger without accounting for Orca's content-hashed versioned relay deployment and handshake; it needs proof that mismatched relays can pass connection setup.
  - F7's “cross-caller cancellation” is incorrect: the acquisition signal is detached once a permit starts an operation and is never passed into the running Git/RPC operation, so one caller's later timeout does not cancel a joined scan.
  - F7's enqueue/abort loop performs in-memory gate work but does not spawn Git after the signal is aborted; calling it a hot retry/spawn mechanism overstates cost.
  - F4 overstates agent-scratch impact: idle scratch repos retain five-minute TTL; only scratch repos with connected PTYs move to eager scanning, and that foreground trade is plausibly intentional.
  - F5's stale-after-mutation extension is not established because the runtime has its own generation/invalidation path even though cross-module dedupe is genuinely lost.
  - F8's PID-reuse claim is highly speculative; a live old process group prevents ordinary reuse of that PGID, leaving only a very narrow probe-to-signal race.
  - F10 attributes orphan lifetime to `detached: true`, but POSIX children do not automatically die with a non-detached parent either; the meaningful change is process-group signal behavior.
  - F12's 30-second boundary can produce a tiny conservative authority downgrade, but calling it meaningful ownership churn is not supported by frequency or downstream evidence.
- missed_relative_to_others:
  - The concrete `hasSpawnedCommandExited` bug that ignores `signalCode` and can attach a `close` listener after close on the max-buffer path.
  - The generic relay `listWorktrees` rejection change and its unguarded caller audit are not developed as clearly as in the Fable report.
- would_trust_to_ship_decision: partial

### Claude Fable medium
- overall_score: 8
- correctness: 7
- severity_calibration: 6
- specificity: 9
- completeness: 8
- actionability: 9
- top_strengths: Concise, well prioritized, and the only peer report to identify the strong `exitCode === null` / `signalCode` callback-after-close settlement hang.
- top_weaknesses: Its remote-hang finding overlooks the mux's 30-second timeout and `rpc.cancel` abort path, while its top P0 is still over-severe.
- false_positives_or_overclaims:
  - F1 should be P1 rather than P0 for the same accumulation/restart-recovery reasons noted above.
  - F3 is materially wrong as written: `SshChannelMultiplexer.request` has a 30-second default timeout, sends `rpc.cancel`, the relay aborts the request context, and `gitWorktreeScan` handles that abort. Settlement can still hang through the separately identified termination defects, but there is a timeout above remote Git.
  - F4 is appropriately marked conditional, but likely moot if the normal versioned-relay install/handshake invariant is enforced; it should not influence ship status without checking that invariant.
  - F6 understates scope slightly in prose: the existence probe runs for the entire pre-2.36 fallback, including Git 2.31–2.35.
  - F8 correctly flags changed error propagation, but “at least” one user-visible create-flow break still needs its outer catch chain verified before being treated as confirmed.
  - F10 is undercalibrated at P3; an explicit refresh silently doing no scan for five seconds under eight legitimate slow background scans is a P2 latency/functionality regression.
- missed_relative_to_others:
  - Loss of cross-module local in-flight dedupe from `listWorktrees` to `listWorktreesStrict`.
  - WSL missing roots never receive immediate `missing_repo_path` backoff.
  - The five-minute TTL cap ceases to enforce the advertised 60/min budget above 300 idle repos.
  - Folder workspaces are appended behind Git repos in the concurrency-limited sweep.
- would_trust_to_ship_decision: partial

## Ranking

1. **Claude Fable medium** — Best signal-to-noise ratio and the strongest unique confirmed bug, despite one important false remote-timeout claim.
2. **Grok** — Clear and operationally useful on the consensus settlement failures, but less complete and too aggressive with P0 severity.
3. **Claude Opus medium** — Outstanding coverage and specificity, but the volume of speculative mechanisms and severity inflation makes adjudication substantially harder.

## Consensus notes

- All three reports agree on the strongest issue: tracked SSH settlement can remain pending after mux disposal, and because permit release is tied to settlement on one runtime-global eight-slot gate, repeated/concurrent disconnects can stop unrelated local and remote scans until restart.
- Grok and Opus strongly agree, and Fable also identifies, that Windows `taskkill` nonzero/error handling can leave termination promises pending forever; Fable adds the distinct and credible signal-exit/max-buffer callback-order bug.
- All reports agree that strict auxiliary probing widens failure blast radius: non-missing `stat` errors and failed main-path normalization can discard an otherwise valid repo worktree graph. Severity is best calibrated at P1 only when tied to the supported Git 2.25–2.35 cold-start/SSH/WSL cases; otherwise individual manifestations are P2.
- The main disagreement to adjudicate is settlement policy, not the existence of the leak: permanent ownership is resource-honest when process death cannot be confirmed, but a process-wide cross-host gate cannot safely retain that uncertainty forever. Old-relay skew and “no remote timeout” should not be accepted without checking the existing relay version invariant and mux cancel path.
