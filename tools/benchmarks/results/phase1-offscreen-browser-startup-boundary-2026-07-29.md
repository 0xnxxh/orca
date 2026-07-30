# Phase 1 OffscreenBrowserBackend startup boundary

- **Date:** 2026-07-29
- **Scope:** Move only serve-mode `OffscreenBrowserBackend` construction out of the eager Electron
  main graph while preserving display gating, runtime identity, headless graph and RPC ordering,
  serve readiness, desktop behavior, and committed teardown.

## Result

`src/main/index.ts` no longer imports `OffscreenBrowserBackend` eagerly. Only inside the existing
`serveOptions` and `headlessBrowserDisplayAvailable` branch, it awaits
`./startup/offscreen-browser-startup-capability` and calls
`attachOffscreenBrowserStartupCapability(runtime, browserManager)`. The capability constructs
with the original `browserManager`, attaches that same live instance through
`runtime.setOffscreenBrowserBackend`, and returns it.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  7,731,484 | 7,728,795 |     -2,689 |   1,616,703 |  1,615,903 |        -800 |

The preload and all renderer static graphs were byte-for-byte unchanged:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

A SHA-256 manifest comparison also matched all 786 emitted files outside `out/main`, covering
the complete preload and renderer output.

## Importer and constructor evidence

Before the edit, a production-source search excluding tests found `src/main/index.ts` as the sole
value importer and sole direct constructor of
`src/main/browser/offscreen-browser-backend.ts`. Generic consumers in `orca-runtime.ts` and
`orca-runtime-browser.ts` depend only on the existing `BrowserBackend` contract and runtime
getter/setter; they neither import nor construct the concrete backend.

After the edit, `src/main/startup/offscreen-browser-startup-capability.ts` is the sole production
value importer and sole direct constructor. `src/main/index.ts` has exactly one dynamic
capability import and no static backend import or direct construction. The runtime's generic
`setOffscreenBrowserBackend` and `getOffscreenBrowserBackend` APIs are unchanged.

The concrete backend implementation is untouched. It retains the original offscreen
`BrowserWindow`, default viewport, profile/default partition selection, shared guest web
preferences, sandbox/context-isolation/node-integration settings, guest registration and
unregistration, asynchronous URL loading, main-frame failure handling, redirect-abort handling,
page lookup, close behavior, and `destroyAll` cleanup.

## Preserved serve, display, runtime, and teardown behavior

The display probe remains synchronous at the same early single-instance-lock timing:
`ensureVirtualDisplayForHeadlessServe({ isServeMode })` still determines
`headlessBrowserDisplayAvailable` before Electron readiness. Its behavior is unchanged:

- macOS and other non-Linux platforms report display support without spawning Xvfb.
- Desktop Linux does not start Xvfb and reports the serve-only offscreen path unavailable.
- Linux serve reuses an explicit `DISPLAY` or a verified live `:99` server.
- Missing Xvfb leaves browser panes unavailable without blocking the rest of serve.
- A stale socket is removed before starting Xvfb; startup timeout tears the attempted display
  down and reports unavailable.
- Linux serve retains the same Chromium software-rendering and shared-memory flags.

Backend loading and attachment occur only when both existing gates pass:

1. `serveOptions` is non-null.
2. `headlessBrowserDisplayAvailable` is true.

The capability is therefore absent from desktop startup and from Linux serve without a usable
display. Construction still happens after headless PTY registration and before
`runtime.syncWindowGraph(HEADLESS_RUNTIME_WINDOW_ID, ...)`. Graph sync still precedes
`runtimeRpc.start()`, which still precedes serve desktop-activation settlement, signal
installation, CLI/dispatcher work, automation startup, and `printServeReady(serveOptions)`.

The original `runtime` and `browserManager` objects are passed by identity. The attached backend
therefore remains the instance used for headless capability advertisement, tab creation and
closing, WebContents lookup, browser screencast routing, mobile session hydration, and
certificate-trust capability publication. The SSH browser path continues to use the hosting
serve runtime's generic offscreen backend; no SSH routing or folder-workspace resolution changed.

Normal desktop startup still opens its renderer window and starts runtime RPC after the
serve-only early return, without importing or attaching the offscreen backend. Closing
main-process offscreen windows still cannot terminate a serve owner through the unchanged
window-all-closed policy. The committed `will-quit` path still calls
`runtime?.getOffscreenBrowserBackend()?.destroyAll?.()` before browser-manager listener cleanup,
PTY cleanup, and RPC teardown.

## Generated chunk and packaged-relative resolution

The emitted capability chunk is
`out/main/chunks/offscreen-browser-startup-capability-D7vO2LoR.js` (3,612 raw / 1,333 gzip
bytes). `out/main/index.js` loads it through
`./chunks/offscreen-browser-startup-capability-D7vO2LoR.js`.

The entry specifier is relative, contains no parent traversal, and resolves under `out/main`.
Every relative dependency in the capability chunk was resolved and confirmed to exist under
`out/main`:

- `./chunk-BTjIgr6M.js`
- `./keybindings-BUptVVER.js`
- `./tui-agent-config-CgQCoDXB.js`
- `../index.js`

These paths match packaged-relative CommonJS resolution.

## Budget

The prior `electron-main` raw budget was 7,779,720 bytes. Lowering it by the exact measured
2,689-byte improvement produces a new budget of 7,777,031 bytes and leaves exactly 48,236 bytes
(0.624%) of headroom over the 7,728,795-byte entry. No preload or renderer budget changed.

## Validation

- Fresh production A and B `pnpm run build:electron-vite`: passed. The baseline transformed
  1,969 main modules; the post-edit build transformed 1,970. Both transformed 17 preload modules
  and 9,181 renderer modules.
- Focused offscreen web-preferences, browser-manager/grab, browser-session registry/persistence
  and startup, full runtime plus runtime browser headless routing, runtime startup failure,
  display/Xvfb, window-all-closed, desktop startup, serve activation/readiness, and new
  capability/boundary suite: passed, 17 files with 1,117 tests passed and one skipped.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint` on the touched source and tests: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check` on the touched source, tests, report, and budget: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 7,728,795 actual versus 7,777,031 budgeted
  main bytes.
- `git diff --check`: passed with no whitespace errors.

## Warnings and residual limitation

Both production builds contained the same two existing CSS optimizer warnings and no new
warning:

1. `::highlight(markdown-preview-search-match)` is reported as an unrecognized pseudo-element.
2. `::highlight(markdown-preview-search-active-match)` is reported as an unrecognized
   pseudo-element.

The builds and explicit resolution check prove packaged-relative emitted paths on this macOS
worktree, but this tranche did not run a packaged ASAR launch smoke on macOS, Linux, or Windows.
Cross-platform packaged launch verification remains the residual limitation.
