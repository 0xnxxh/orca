# Verify the Activity #185 fix — live, on real Windows

You previously reproduced crash 36e6237d LIVE on this Windows box (see tools/activity-185-repro/FINDINGS.md): a same-tab two-pane rapid-selection-switch drives an unbounded render streak (you captured 239 renders in 847ms; the `298:readiness-change` effect firing ~234/239) → React #185. Root cause: `displayedIsSelectedTerminal` (ActivityPrototypePage.tsx) compared only worktree.id + tab.id, conflating two panes of the same tab, so stagedThread stayed null and the readiness MutationObserver oscillated forever.

## The fix to verify
In `src/renderer/src/components/activity/ActivityPrototypePage.tsx`, `displayedIsSelectedTerminal` must ALSO require `displayedThread.paneKey === selectedThread.paneKey`. (This is exactly the change on branch `nwparker/fix-activity-same-tab-pane-185`.) KEEP your render-loop instrumentation in place so you can measure.

## Steps
1. Ensure your instrumentation (render-loop detector + effect logging) is still in ActivityPrototypePage.tsx. Apply the fix on top: add `&& displayedThread.paneKey === selectedThread.paneKey` as the final condition of `displayedIsSelectedTerminal`.
2. Rebuild/reload the dev app (whatever you did before — HMR or restart).
3. Re-run your exact repro from tools/activity-185-repro (the same-tab two-pane rapid-switch that produced the 239-render streak). Use the same CDP scripts.
4. Measure the render streak AFTER the fix. Expected: the streak collapses (renders settle to a small bounded number; the `298:readiness-change` oscillation stops; no "Maximum update depth exceeded"). Run it several times.
5. ALSO confirm no regression to normal Activity behavior: switching between DIFFERENT-tab threads still works and the portal still shows the right terminal (no wrong-terminal flash).

## Report (I cannot read your TUI reliably — use git)
Write `tools/activity-185-repro/FIX_VERIFICATION.md` with: before render-streak numbers (from FINDINGS: 239/847ms), after numbers (post-fix), whether #185 still occurs, and the normal-switch regression check result. Then `git add -A && git -c core.hooksPath= commit -m "verify: activity-185 fix collapses the render streak" && git push`. When pushed, print `VERIFY DONE`. If the fix does NOT stop the loop, say so honestly in the file and print `VERIFY FAILED`.
