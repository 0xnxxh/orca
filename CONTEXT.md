# Context pack — PR #11950 / Cluster A (React #185 terminal.workbench)

You are in worktree `crash-a-11950-react185`, checked out from **PR #11950** branch `fix/crash-a-active-terminal-repair-loop`.

**Parent triage:** `/Users/jinjingliang/Documents/projects/orca/1.4.163-fix-crashes`  
**Local copies:** `triage-context/TRIAGE-REPORT.md`, `AGENT-TASKS.md`, sample reports under `triage-context/reports/`.

## Why this exists

Orca **1.4.163** field crashes (31 stable reports, 2026-08-01 soak):

| Cluster | n | This PR? |
|---|---|---|
| **A terminal.workbench React #185** | **16** | **YES — this PR** |
| D heap OOM / high-heap | ~7 | no (#11954) |
| E Windows GPU | ~4 | no (crash-c4 / #11966 / #11940) |
| B settings #185 | 1 | no (#11962) |

**This is the largest 1.4.163 crash cluster.** Fix is open, CI green, **not merged**, **not in v1.4.163**.

## Field signature (must match)

- Reason: `react-error-boundary`
- Process: `react-render`
- `boundary_id: terminal.workbench`
- Error: `Minified React error #185` (Maximum update depth exceeded)
- Stack (stable):  
  `getRootForUpdatedFiber ← enqueueConcurrentHookUpdate ← dispatchSetStateInternal ← dispatchSetState ← commitHookEffectListMount ← commitPassiveMountOnFiber`
- Component tops: **TerminalPaneOverlayLayer$1** (~13/16), **SortableTab** (~3/16)
- Platforms: macOS + Windows; heavy repeater **SeungGiJeong ×9**, also LesleyMurfin

Sample report IDs (full text in `triage-context/reports/`):
- `d9434d07` LesleyMurfin Win SortableTab + 70 panes (Slack example)
- `fb339a6b` LesleyMurfin Win Overlay
- `1051d66f`, `1828176e`, `1bdb9c23` SeungGiJeong macOS
- `30eb3a56`, `79ebdb5d`, `bdf0db48` Win Overlay

## Claimed root cause (verify, do not rubber-stamp)

1. Same terminal **tab id** can appear under **two worktree keys** (SSH path rename / repo re-add minting new worktree id while stale key retains tab).
2. `setActiveTab` first-match `Object.entries` ownership: if non-active worktree scanned first → refuses global `activeTabId` write.
3. `Terminal.tsx` repair effect sees “active tab not in active worktree list” forever → loops → #185.
4. Fix: `active-tab-owner-worktree.ts` prefers active worktree for ownership; breadcrumb `terminal_tab_id_owned_by_multiple_worktrees`.

**Honest limits from PR body (still check):**
- Throwing frame is local `useState` in passive effect (victim); repair is driver.
- Overlay measure↔fit (#10026) already shipped — do not re-open without new evidence.
- Competing cold-parking (C5) hypothesis was checked; park churn rare in bundles.

## Your job

1. **Read PR #11950** body + full diff in this worktree.
2. **Read** `triage-context/TRIAGE-REPORT.md` Cluster A section + sample reports.
3. **Review for:**
   - Correctness of ownership fix under duplicate tab ids
   - Functionality regressions (wrong tab activated, SSH remotes, multi-worktree, sortEpoch side effects)
   - Performance regressions (hot path O(worktrees×tabs) on title frames / every render)
   - Whether production stacks actually require this fix vs residual Overlay loop
4. **Run** the react185 harness:
   ```
   npx vitest run -c config/vitest.config.ts \
     src/renderer/src/components/terminal/active-terminal-repair-loop.react185.test.tsx \
     src/renderer/src/components/terminal-pane/TerminalPaneOverlayLayer.react185.test.tsx
   ```
5. If high-confidence gaps: minimal fix + tests. Else write **REVIEW-11950.md** with ship / ship-with-nits / block.
6. `worker_done` with recommendation and residual risks.

## Do not

- Conflate with Settings #185 (#11962) or GPU (#10624).
- “Fix” by swallowing #185 in the error boundary.
- Expand into heap OOM.

## PR

https://github.com/stablyai/orca/pull/11950
