# Activity #185 runtime repro — captured evidence

Reproduced live on real Windows Electron (dev Orca, CDP-driven). React #185
("Maximum update depth exceeded") thrown; error boundary tripped.

## Trigger (the ingredient jsdom + prior attempts missed)
**Two Activity threads that belong to the SAME terminal tab** (two panes / leaf
ids of one tab), with selection switched rapidly between them. NOT the
migration-unsupported / forceUnavailable path (that was a red herring for the
core loop, though a never-ready pane sustains it the same way).

## React error (verbatim)
```
Maximum update depth exceeded ... The above error occurred in the
<TerminalPaneOverlayLayer2> component.
[terminal.workbench] render crash contained by boundary
```
Production hit boundary `page.activity`; the repro sometimes surfaces at
`terminal.workbench` (TerminalPaneOverlayLayer2). Same cross-component
Activity<->Terminal portal loop; whichever fiber hits React's ~50 nested-update
limit first is the boundary that catches.

## Captured churning state (longest streak)
- 239 consecutive renders in 847ms (buffer-capped; effectively continuous).
- Effect fired, by count:
  - `298:readiness-change(loading->loading)`  x128
  - `298:readiness-change(loading->unavailable)` x106
  - `298:readiness-change(unavailable->loading)` x2
  - `1635:publish` x3
  => 234/239 renders are the `useActivityTerminalPortalStatus` readiness effect.
- Per-render state during the loop:
  - `activePortalSlotId` stable, portal target el ids stable (no target churn).
  - `displayedPaneKey` STUCK on one pane; `selectedPaneKey`/`visibleThread`
    flip between the two same-tab panes (58 flips across the streak).
  - `stagedThread` = null throughout.
  - `visiblePortalStatus` never reaches `ready`; oscillates loading<->unavailable.

## Root cause
`displayedIsSelectedTerminal` (ActivityPrototypePage.tsx ~1515) compares only
`worktree.id` + `tab.id`, so two panes of the SAME tab are treated as "the same
displayed terminal":
- => `stagedThread` is always null (it requires `!displayedIsSelectedTerminal`).
- => effect 1607's staged-swap reconciliation never runs, so `displayedPaneKey`
     never advances to the selected pane.
- Meanwhile the real `TerminalPane` isolation for the visible leaf toggles the
  sibling leaf's ancestor `display:none` on the shared portaled subtree. The
  Activity readiness `MutationObserver` (useActivityTerminalPortalStatus,
  ~line 298, watching style/childList) sees the toggle and flips
  `loading` <-> `unavailable` (`hasInlineDisplayNoneBetween` /
  `hasUnhiddenSiblingPane`) and can NEVER reach `ready` because a same-tab
  sibling is always present. Each flip = setReadiness = re-render, and the
  isolation re-runs, re-toggling display -> observer -> ... unbounded ->
  React #185.

Only reproduces under real Windows layout/compositor timing of the isolation
reparent (why jsdom never hit it, and why it is intermittent as a *throw* even
though the runaway render streak is present on 100% of runs).
