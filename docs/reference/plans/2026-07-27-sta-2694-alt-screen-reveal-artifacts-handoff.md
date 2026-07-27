# STA-2694 — garbled terminal after switching away from an AI workspace

Handoff snapshot: 2026-07-27, branch
`neil/sta-2694-fix-ui-rendering-artifacts-when-switching-away-from-ai`,
2 commits on top of `a1a78da878`.

## The report

> When I use an AI tool—such as OpenCode—and switch away to the desktop or
> another task, the page appears garbled or distorted upon returning; I have to
> resize the window to restore the display.

Reporter hints: related to terminal parking / workspace switching; also happens
with Claude Code and probably grok.

## Status

**Two real defects found and fixed. Neither is proven to be the whole report.**

Both fixes are mechanism-level: each is a place where Orca's reveal repaint
provably renders zero cells, verified by reading xterm's source and pinned by
unit tests. Neither is confirmed against the field symptom, because **no
automated oracle in this repo can observe a stale canvas** (see
[Why the e2e suite can't close this](#why-the-e2e-suite-cant-close-this)).

| | |
|---|---|
| Fixed + committed | `ed1eaf55f1`, `0f7ec4458d` |
| Unit tests | 12 across 3 files, all passing |
| e2e | 10 headless passing (4.8m) + 1 headful desktop-hide passing (22.6s) |
| Typecheck / lint | `typecheck:web` exit 0; oxlint clean on changed files |
| Confirmed against the field symptom | **No** — needs the in-app sentinel on real hardware |

## Defect 1 — a latched synchronized-output frame swallows every repaint

Commit `ed1eaf55f1`, `src/renderer/src/lib/pane-manager/terminal-synchronized-output-release.ts`.

Alt-screen agent TUIs (OpenCode/OpenTUI, Codex, grok) bracket every repaint in
DEC 2026 synchronized output — `\x1b[?2026h … \x1b[?2026l` — many times a
second. Hiding a pane mid-bracket (a worktree switch or cold park lands there
routinely) leaves xterm's `decPrivateModes.synchronizedOutput` latched `true`.

`RenderService.refreshRows` checks that latch **before** rendering
(`node_modules/@xterm/xterm/src/browser/services/RenderService.ts:156`), so
while it holds, every repaint Orca owns is a no-op:

- the forced render-pause repaint (`forceRepaintThroughRenderPause`),
- the plain `terminal.refresh()` fallback,
- the shared glyph-atlas rebuild.

All three return having rendered zero rows, while the xterm buffer is perfectly
correct — which is exactly the shape of the report.

The fix clears the latch and flushes `SynchronizedOutputHandler`'s buffered rows
at both reveal repaint entry points, before the repaint.

**Scope limit:** xterm arms a 1s watchdog that clears this latch on its own, and
that watchdog only re-arms on the next `bufferRows`. So this closes a bounded
window, not the indefinite garble in the report.

## Defect 2 — the plain-refocus path did a diff-based refresh with a populated model

Commit `0f7ec4458d`, `src/renderer/src/lib/pane-manager/terminal-render-model-clear.ts`.

`schedulePaneRevealPresent` — the atlas-preserving path — only called
`terminal.refresh()`. xterm's renderers are **diff-based**:
`WebglRenderer._updateModel` early-continues on any cell whose code/fg/bg/ext
still match the cached model ("Nothing has changed, no updates needed"). For a
pane whose buffer never changed while hidden, a refresh therefore repaints
**nothing**.

When an occluded window loses its canvas contents while that model stays
populated, the refresh skips exactly the cells that went stale, and the pane
keeps compositing pre-hide pixels — until a window resize reallocates the model.
That is the repair the reporter found by hand.

The fix clears the model first: `RenderService.clear()` → renderer `clear()` →
`_clearModel(true)`. That drops cached cells and glyph vertices but **not** the
texture atlas — a deliberate distinction, since the atlas is a module-global
shared by every same-config terminal (`CharAtlasCache.ts`) and wiping it
mid-stream re-arms xterm's page-merge garble race (xterm.js #4480). That race is
the whole reason this path is atlas-preserving.

Also covers the DOM-renderer fallback in `resetWebglTextureAtlas`:
`clearTextureAtlas()` was what invalidated the model on the WebGL path, so a
pane without an addon had nothing invalidate it and hit the identical skip.

### Why this path is the one the reporter hits

The literal action is "switch away to the desktop" — OS-level occlusion, not
in-app navigation. Trigger mapping in
`use-terminal-window-wake-recovery.ts`:

| Trigger | `clearGlyphAtlases` | Reveal path |
|---|---|---|
| `window 'focus'` | `false` | `scheduleRevealPresent()` — **defect 2** |
| `document 'visibilitychange'` (visible) | `true` | `scheduleRevealRepaint()` |
| `window.api.ui.onSystemResumed` | `true` | `scheduleRevealRepaint()` |

And `App.tsx:1437-1453` (STA-2383) records that **on macOS occlusion-uncover
fires only `focus`** — `visibilitychange` never comes, which is why that code
relays a synthetic reveal to main. So the desktop-switch case lands squarely on
`scheduleRevealPresent()`, the path that until this commit did a no-op refresh.

## Call graph (for orientation)

```
window 'focus' / 'visibilitychange' / onSystemResumed
  └─ use-terminal-window-wake-recovery.ts       coalesces: 1 immediate + 1 settled RAF pass
       └─ recoverVisibleTerminalWindowWake()    terminal-visibility-resume.ts
            ├─ clearGlyphAtlases  → resetAndRefreshAllTerminalWebglAtlases() + scheduleRevealRepaint()
            └─ !clearGlyphAtlases → scheduleRevealPresent()
                 └─ PaneManager.scheduleRevealPresent()   pane-manager.ts:344-355
                      └─ schedulePaneRevealPresent()      pane-reveal-repaint.ts
                           ├─ reattachWebglIfNeeded()
                           ├─ releaseAbandonedSynchronizedOutput()   ← fix 1
                           ├─ clearTerminalRenderModel()             ← fix 2
                           └─ terminal.refresh(0, rows-1)
```

Tab/worktree reveal enters the same file via `resumeTerminalVisibility`:
`shouldUseLightTabResume` → `scheduleTabRevealWebglAtlasRecovery()` +
`scheduleRevealRepaint()`; the heavy path returns a post-paint `run()` that
drains backlog, resets all atlases, then `scheduleRevealRepaint()`.

Both schedules run their work on a **double-RAF settled frame**, because the
WebGL renderer silently drops redraw requests until the pane is attached and
measured.

## Why the e2e suite can't close this

`tests/e2e/terminal-opencode-altscreen-reveal-artifacts.spec.ts` (777 lines, 5
tests) plus `tests/e2e/fixtures/opencode-altscreen-live-fixture.cjs` (an
OpenTUI-shaped alt-screen TUI with `?2026h`-bracketed frames and
`ORCA_FREEZE_NOW` / `ORCA_FREEZE_MID_FRAME` stdin sentinels).

**These tests do not detect a stale/garbled canvas.** Two oracles were built for
it and both were *proven blind* by injecting the exact defect — freeze
`RenderService.refreshRows`, then write new content, so the buffer advances while
the canvas cannot:

1. **Canvas-vs-buffer ink sampling** (the sentinel's method). `drawImage` on a
   non-`preserveDrawingBuffer` WebGL canvas hands back a *re-rendered* copy, so
   it reported 0 missing cells against 5263 cells of text the canvas had never
   drawn. Removed.
2. **Screenshot vs. a forced repaint.** Playwright's screenshot drives a fresh
   compositor frame, which *heals* the stale paint before capture; and the
   "repair" calls the same repaint code the reveal already ran, so a defect
   shared by both shots cancels out. Documented as a known limitation in the
   spec header.

An earlier resize-referenced oracle was also unsound and was discarded:
resizing shifts alt-screen rows, so its 4.4% pixel diff was measuring legitimate
reflow, not the defect.

So green here means "no buffer/geometry regression", not "the canvas painted
correctly". Headless macOS with `hasWebgl: true` never reproduced the field
failure at all. What the suite *does* guard: the buffer converges to the live
frame, the pane stays on the alternate buffer, and xterm's grid, the fit
proposal, and the PTY-applied size all agree without a resize — across worktree
switch, cold park, idle agent, and (headful) desktop hide.

Test list:

- `worktree switch away and back paints correctly without a manual resize`
- `parked tab reveal paints correctly without a manual resize`
- `parked reveal of an IDLE alt-screen agent paints without a manual repair`
- `@headful desktop switch away and back paints an idle agent without a manual repair`
- `reveal repaints a pane hidden inside an unclosed synchronized-output frame`

The idle-agent case matters: every earlier test kept the TUI streaming across the
reveal, so live frames repainted whatever the reveal got wrong and the defect
healed itself before any assertion ran. A real OpenCode session sits waiting for
input.

## How to actually confirm a canvas-level fix

The in-app render-desync sentinel
(`src/renderer/src/components/terminal-pane/terminal-render-desync-sentinel.ts`)
samples the compositor-presented canvas *before* any forced redraw can heal it,
and persists the corrupt pixels + buffer to disk. It must run on real hardware —
headless has never tripped it.

```js
localStorage.setItem('orca:render-desync-sentinel', '1')   // then reload
```

Then reproduce (OpenCode in a worktree, switch to the desktop, come back) and
**⌘-click** (Ctrl-click off Mac) inside the garbled pane. That starts a 10s
sampling burst at 250ms intervals; a trip requires the same cells missing across
2 consecutive samples, ≥200 text cells, ≥8% missing. On a confirmed trip it
writes `corrupt.png` + `corrupt.json` to
`<userData>/terminal-render-desync-evidence/<captureId>/`, then runs the
shared-atlas recovery and captures the healed frame for comparison.

Armed automatically at import when the flag is set
(`terminal-freeze-breadcrumbs.ts:45`).

## Open lead — dimension staleness (unverified)

This is the only mechanism found that explains why **a resize specifically** is
the repair. It is a code-reading hypothesis; nothing has been written or tested
for it.

Every dimension-rebuilding path in `WebglRenderer` is guarded by an
"unchanged / zero-sized" early exit that a hidden pane trips:

| Guard | Location | Behavior when hidden |
|---|---|---|
| `performSafeFit` unchanged-geometry return | `pane-fit.ts:131-136` | reveal fit does **no repaint at all** |
| `handleDevicePixelRatioChange` | `WebglRenderer.ts:183` | no-ops unless `dpr` actually changed |
| `_updateDimensions` | `WebglRenderer.ts:649` | early-returns when char width/height is 0 |
| `_setCanvasDevicePixelDimensions` | `WebglRenderer.ts:701` | early-returns when dimensions unchanged |
| `observeDevicePixelDimensions` | `DevicePixelObserver.ts` | drops 0×0 entries ("canvas is likely hidden") |
| `CharSizeService._validateAndSet` | `CharSizeService.ts` | retains stale values when the element measures 0 |
| `WebglRenderer.renderRows` | `WebglRenderer.ts:354` | returns early when `!_isAttached` / screen element disconnected |

Net effect: on return from occlusion, **nothing re-runs
`WebglRenderer.handleResize()`** — the only routine that resets
`_canvas.width/height`, re-runs `_refreshCharAtlas()`, calls `_clearModel(false)`,
and fires a *synchronous* full redraw. A manual window resize *does* change
geometry, so it reaches `fitAddon.fit()` → `terminal.resize()` →
`handleResize()`, and heals it.

Note that fix 2 already covers the model half of this (`_clearModel`) while
deliberately not touching the atlas. What it does *not* cover is a canvas whose
**backing store** went stale while hidden — if that is the real mechanism, the
fix would be re-driving the canvas dimensions (or `handleCharSizeChanged()`,
which routes to `handleResize`) on reveal, which needs care: `handleResize`
touches the shared atlas and fires a sync redraw.

**Do not implement this without confirming it first** — preferably via the
sentinel, whose `rendererState` payload records the atlas/model versions and
canvas dimensions at the moment of the trip.

## Verification commands

```bash
npx vitest run --config config/vitest.config.ts src/renderer/src/lib/pane-manager/
npx tsc --noEmit -p config/tsconfig.tc.web.json
npx playwright test tests/e2e/terminal-opencode-altscreen-reveal-artifacts.spec.ts \
  tests/e2e/terminal-inline-tui-reveal-convergence.spec.ts \
  --config tests/playwright.config.ts --project=electron-headless --workers=1
SKIP_BUILD=1 npx playwright test tests/e2e/terminal-opencode-altscreen-reveal-artifacts.spec.ts \
  --config tests/playwright.config.ts --project=electron-headful --workers=1
```

Last run: 58 pane-manager unit files / 610 tests passing (1 skipped);
`typecheck:web` exit 0; 10 headless e2e passing in 4.8m; 1 headful in 22.6s.

## Files

Production:

- `src/renderer/src/lib/pane-manager/terminal-synchronized-output-release.ts` (new, fix 1)
- `src/renderer/src/lib/pane-manager/terminal-render-model-clear.ts` (new, fix 2)
- `src/renderer/src/lib/pane-manager/pane-reveal-repaint.ts` (both fixes wired into `schedulePaneRevealPresent`)
- `src/renderer/src/lib/pane-manager/pane-webgl-renderer.ts` (`resetWebglTextureAtlas`: fix 1 + DOM-renderer fallback)

Tests:

- `terminal-synchronized-output-release.test.ts`, `reveal-repaint-synchronized-output.test.ts`,
  `terminal-render-model-clear.test.ts` (12 tests)
- `tests/e2e/terminal-opencode-altscreen-reveal-artifacts.spec.ts`,
  `tests/e2e/fixtures/opencode-altscreen-live-fixture.cjs`
