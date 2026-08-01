# Agent task briefs — Orca 1.4.163 crashes

Read `TRIAGE-REPORT.md` first. Artifacts under `crash-triage/reports/`.

---

## Task A — Ship React #185 terminal.workbench fix (P0)

**Goal:** Stop `Minified React error #185` on `boundary_id: terminal.workbench` that dominates 1.4.163 field crashes (16 reports).

**Do:**
1. Open https://github.com/stablyai/orca/pull/11950 and treat it as the primary fix candidate.
2. Verify the PR still applies cleanly to current main; run its react185 harness:
   - `src/renderer/src/components/terminal/active-terminal-repair-loop.react185.test.tsx`
   - also keep green: `TerminalPaneOverlayLayer.react185.test.tsx`
3. Confirm fix is ownership preference for duplicate tab ids (`active-tab-owner-worktree`), not error-boundary band-aids.
4. If merging: ensure breadcrumb `terminal_tab_id_owned_by_multiple_worktrees` ships for post-release validation.

**Do not:**
- Re-fix the overlay measure↔fit loop (#10026 already shipped).
- “Fix” by catching #185 without stopping the loop.

**Success:** PR merged; no new `terminal.workbench` + #185 on next release channel, or breadcrumb proves remaining cases are a different driver.

**Evidence samples:** `reports/d9434d07-*.txt`, `reports/1051d66f-*.txt`, `reports/fb339a6b-*.txt`

---

## Task D — Renderer heap death / leak (P0)

**Goal:** Identify what holds multi-GB heap before renderer OOM (Win) or exit=5 high-heap crash (macOS). Root fix unknown; instrumentation PR is not a fix.

**Do:**
1. Read reports:
   - Win OOM: `317f5937`, `6754f9ef`, `5aedfe74`
   - macOS high-heap: `89d0f94b`, `76c4f5b9`, `a220f430`, `5904df3e`
2. Note: store entry counts are often tiny while heap is 3GB+ → payload sizes, not map cardinality.
3. Land or extend https://github.com/stablyai/orca/pull/11954 (terminal backlog, xterm buffers, Monaco registry).
4. Profile long agent sessions; search for session-lifetime retention of large strings/buffers (terminal scrollback, agent transcripts, PR HTML, undisposed Monaco models).
5. Propose concrete caps/disposal with tests.

**Do not:**
- Claim OOM is “just too many tabs” without evidence (metheoryt has terminalElements=0–1).
- Conflate with Cluster A (different signature).

**Success:** Next field OOM names a dominant retainer; or a bounded retention change flattens the ~10–25 MB/min climb seen in reports.

---

## Task E — Windows GPU cold-start death (P1)

**Goal:** Stop renderer death ~1–2s after launch when GPU child exits `0x80000003` (STATUS_BREAKPOINT) on Windows 1.4.163.

**Do:**
1. Read `reports/a65f6e7e-*.txt`, `12da1e71-*.txt`, `7a02c79c-*.txt`, `2369eabe-*.txt`.
2. Read `src/main/startup/gpu-fallback-switches.ts` — understand `--in-process-gpu` is **fallback-only**, not default.
3. On **real Windows hardware**, validate:
   - https://github.com/stablyai/orca/pull/11966 (cross-launch GPU crash counting)
   - https://github.com/stablyai/orca/pull/11940 (earlier safe-graphics latch)
4. Measure: does fallback + in-process-gpu still die with same exit code?
5. Product decision if reactive path is insufficient: default software GPU on problematic GPUs, or broader switch set.

**Do not:**
- Assert “fixed in 1.4.163 by #11295” — field data proves GPU child still dies on cold start.
- Ship Windows GPU changes validated only on macOS simulation without calling that out.

**Success:** Cold-start survival on machines that currently die in <3s; or documented residual driver class with user-facing safe mode that actually engages on first failure.

---

## Task B — Settings / Voice React #185 (P2)

**Goal:** Resolve or disprove settings-path #185 (`331de48e`, VoiceSpeechModelSection / Presence).

**Do:**
1. Read report + https://github.com/stablyai/orca/pull/11962 (causation unproven per PR).
2. Attempt reproduction on Settings → Voice model download.
3. Either strengthen proof and land, or close as unconfirmed and leave monitoring.

**Success:** Proven fix with test, or explicit “not reproduced / low priority” with watch criteria.

---

## Task F — Crash reporting hygiene (P3)

**Goal:** Reduce false “crash” prompts when recovery already succeeded.

**Do:** Land https://github.com/stablyai/orca/pull/11949 if still open; cover `2a2d96bf`-class killed reports only if they remain noisy after A/D/E.

---

## Task C2 — Dev Fast Refresh confirmation dialog (optional)

**Goal:** Dev-only dual-context `useConfirmationDialog` on RC (`42d63029`, `5ee3b8b6`).

**Do:** https://github.com/stablyai/orca/pull/11980 — not a release blocker.

---

## Coordination rules

- One owner per cluster; A and D both touch renderer performance-ish code — serialize merges if both edit terminal store.
- Always trust crash **body** `App version` over Slack header.
- Prefer existing open PRs over greenfield rewrites.
- After any ship, watch `#orca-crashes` for version > 1.4.163 matching the cluster signature.
