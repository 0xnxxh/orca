# Activity #185 fix — live verification result

**Verdict: VERIFY FAILED.** With the one-line `paneKey` fix applied and confirmed
live in the running dev app, the reliable same-tab reproducer (`09-repro.js`)
**still throws React #185 on every run and the render streak did not collapse**
(post-fix streaks 76–96, vs pre-fix 92–100 — statistically the same, both crash).

This is an honest negative result. It does **not** prove the fix is wrong for the
production crash; it shows the fix is *inert against the loop I can reproduce
live*, and that I could not drive this harness into the exact state the fix
targets. Details and the important caveats are below.

## What was done
- Applied the fix in `src/renderer/src/components/activity/ActivityPrototypePage.tsx`:
  `displayedIsSelectedTerminal` now also requires
  `displayedThread.paneKey === selectedThread.paneKey`.
- Confirmed the fix was actually **live** (not a stale bundle) via a temporary
  `globalThis.__ACTIVITY185_FIXMARK` render marker read back over CDP:
  `panekey-fix-v1` when the fix was applied, `prefix-baseline` when reverted.
  (Marker removed from the final committed source; the fix + the pre-existing
  render-loop instrumentation remain.)
- Reproduced over CDP (port 9333) against the real Windows Electron dev app,
  reloading the renderer between runs (the error boundary latches after a crash
  and must be cleared by a full reload).
- Ran a **matched A/B**: reverted the fix to get pre-fix baselines, re-applied it
  for post-fix, same scripts, multiple runs each.

## Numbers

Streak = longest run of renders <50ms apart (from `__ACTIVITY_185_TRACE`);
`react185` = count of captured "Maximum update depth exceeded" errors.

FINDINGS reference (prior capture): **239 renders / 847ms**.

### Reliable reproducer — `09-repro.js` (same-tab rapid switch, 1 real pane + 1 fake same-tab sibling)
| build | run | streak | span | react185 | boundary |
|-------|-----|--------|------|----------|----------|
| PRE-FIX  | baseline | 100 | 1065ms | 2 | tripped |
| PRE-FIX  | #1 | 94 | 1077ms | 2 | tripped |
| PRE-FIX  | #2 | 92 | 1036ms | 2 | tripped |
| PRE-FIX  | #3 | 94 | 1022ms | 2 | tripped |
| POST-FIX | #1 | 96 | 1050ms | 2 | tripped |
| POST-FIX | #2 | 92 | 1020ms | 2 | tripped |
| POST-FIX | #3 | 80 |  882ms | 2 | tripped |
| POST-FIX | #4 | 76 |  845ms | 2 | tripped |

Every run — pre and post — throws React #185, effect breakdown ~100%
`298:readiness-change(loading->unavailable)`. **No collapse.**

### `10-combined.js` (rAF store churn + tight synchronous click bursts)
| build | streak | react185 | boundary |
|-------|--------|----------|----------|
| PRE-FIX  | 8–10 | 0 | false |
| POST-FIX | 8 | 0 | false |

`10-combined` does **not** reproduce the crash even pre-fix, so its small
post-fix streak is not evidence the fix worked — it never looped to begin with.

### Regression — different-tab switching (`01-setup-threads.js` + `02-toggle.js`), fix live
- streak 7 / 88ms, react185 **0**, boundary false. Switching between two
  different-tab threads settles normally, no crash. **No regression from the fix.**
  (The fix cannot change different-tab behavior: `tab.id` already differs, so the
  new `paneKey` clause is never the deciding factor there.)

## Why the fix is inert against this reproduction
Throughout every reproduced loop the per-render trace shows
`displayedPaneKey = null` and `stagedThread = null` (fields `disp`/`stg`), with
selection flipping between the real pane (`…11a1d001`, status `loading`) and the
fake same-tab sibling (`…eeeeeeee`, status `unavailable`).

Because `displayedThread` is null, `displayedIsSelectedTerminal` short-circuits to
falsy on the earlier `displayedThread &&` term — **the new `paneKey` clause is
never reached**. Pre-fix and post-fix compute identical values, so `stagedThread`
stays null either way. The re-render driver is the `useActivityTerminalPortalStatus`
MutationObserver (line ~298) flipping `loading`⇄`unavailable` as selection moves
between the real pane and a never-ready same-tab sibling — this runs independently
of the `stagedThread`/`displayedPaneKey` swap path the fix modifies.

`displayedPaneKey` never leaves `null` because it only initializes when a pane's
Activity portal reaches `ready` (effect 1607), and in this injected-thread harness
the real terminal's portaled pane stays `loading` forever: the DOM probe
(`93-dom-probe.js`) confirms the real terminal *is* present (has `data-pty-id` +
`.xterm-screen`, leaf `44776541`), but `getSelectedActivityTerminalPortalStatus`
never returns `ready` (isVisibleRoot / sibling-isolation gate), so init never fires.

## Important caveats (read before concluding the fix is bad)
1. **I could not reproduce the FINDINGS "displayedPaneKey stuck on a real pane"
   cascade.** FINDINGS described the loop with `displayedPaneKey` non-null and
   stuck; every loop I captured here has it `null`. The fix is logically correct
   *for that non-null path* (it makes `stagedThread` become the selected pane so
   effect 1607 can advance `displayedPaneKey`), but that path was never entered in
   this harness, so the fix's efficacy against it is **unverified live**.
2. Two readings are consistent with the data, and I can't distinguish them here:
   - (a) the real crash is the `displayedPaneKey === null` readiness-oscillation
     variant → the `paneKey` fix would **not** stop it (the observer flip is the
     driver, not the staged-swap logic); or
   - (b) the harness simply can't reach the non-null state the fix targets →
     efficacy unknown, needs a repro where a same-tab pane actually reaches
     `ready` first (e.g. two *real* split panes of one tab, not a synthetic
     sibling).
3. What **is** established: the fix is **safe** (no regression to different-tab
   switching) and is correctly applied + live; and on the loop that *is*
   reproducible on this box, it does not help.

## Recommendation
Do not ship this as "verified fixed." Either (a) reproduce with two **real** split
panes of the same tab so `displayedPaneKey` initializes and the staged-swap path
is exercised, or (b) treat the `298` readiness observer's `loading`⇄`unavailable`
oscillation on a never-ready same-tab sibling as the primary driver and fix that
(e.g. debounce/settle the readiness flip, or don't treat a same-tab sibling as
`unavailable`). The `paneKey` change is a correct guard to keep, but it is not
sufficient to stop the render streak reproduced here.

## Repro scripts (this directory)
- `00-hook-errors.js` — install #185 error hook
- `08-same-tab.js` — inject 1 real pane + 1 fake same-tab sibling, switch to Activity
- `09-repro.js` — reliable same-tab rapid-switch reproducer
- `10-combined.js` — churn + burst variant (does not reproduce)
- `01-setup-threads.js` + `02-toggle.js` — different-tab regression check
- `11-measure.js` — read trace buffer → longest streak + effect breakdown
- `90-inspect-store.js`, `91-inspect-layout.js`, `92-settle-p1.js`, `93-dom-probe.js`
  — diagnostics used to establish the `displayedPaneKey=null` / portal-never-ready finding
- `cdp-eval.mjs` — CDP driver (`ORCA_CDP_PORT=9333 node cdp-eval.mjs < script.js`)
