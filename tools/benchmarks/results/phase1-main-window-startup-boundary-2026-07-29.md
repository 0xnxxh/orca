# Phase 1 main-window startup boundary — 2026-07-29

**Scope:** Move the concrete main-window creation, loading, service attachment, and updater setup
graph behind one app-ready capability while preserving synchronous window creation, exact function
identity, desktop/serve activation, and all existing window lifecycle policy.

## Result

`src/main/index.ts` no longer value-imports `window/createMainWindow` or
`window/attach-main-window-services`. It awaits one
`./startup/main-window-startup-capability` immediately after browser-kernel initialization, then
installs the returned four exact function identities in a small typed owner used by the
predeclared window, updater, and crash-recovery functions.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  4,396,073 | 4,001,071 |   -395,002 |     934,292 |    849,834 |     -84,458 |

The preload and every renderer static graph were byte-for-byte unchanged:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

The sorted SHA-256 manifests for all 786 files outside `out/main` were identical. Each manifest
contained 786 rows / 87,731 bytes and had SHA-256
`68ba944c45d80c14c538180894eade74a3897e120fa0bf6a89fbb60500a3ab01`; a direct diff was empty.

## Importer and readiness audit

Before this tranche:

- `index.ts` eagerly imported `createMainWindow` and `loadMainWindow` from
  `window/createMainWindow.ts`.
- `index.ts` eagerly imported `attachMainWindowServices` and
  `ensureAutoUpdaterConfigured` from `window/attach-main-window-services.ts`.
- `createMainWindow.ts` also calls its own `loadMainWindow` for the existing reload and recovery
  paths.
- `attach-main-window-services.ts` calls its own `ensureAutoUpdaterConfigured` from the existing
  update-check path.
- `ipc/register-core-handlers.ts` imports `registerUpdaterHandlers` from
  `attach-main-window-services.ts`, but that importer is already reached only through the deferred
  core-IPC registry.

No required consumer runs before `app.whenReady`:

- Main-window creation is reached only by desktop startup, macOS activation, tray/menu actions, or
  serve-to-desktop promotion after readiness.
- Manual updater checks are user-initiated through menu/tray wiring created with the first window.
- Renderer crash recovery can only run after a window has been created.
- Headless serve does not create or attach a main window unless the existing desktop-promotion
  gate is deliberately activated.

After the edit, the aggregate capability is the sole production importer of
`createMainWindow.ts`. It and the already-deferred core-IPC graph are the only production importers
of `attach-main-window-services.ts`. `index.ts` has exactly one dynamic aggregate import and no
eager path to either target module.

## Capability and identity contract

`createMainWindowStartupCapability` returns:

- the original `createMainWindow` identity;
- the original `loadMainWindow` identity;
- the original `attachMainWindowServices` identity; and
- the original `ensureAutoUpdaterConfigured` identity.

It does not wrap, reconstruct, or move policy out of either window module. The typed
`main-window-startup-owner` holds the exact returned object. Access before installation throws
`Main-window capability must be initialized before use`, so a premature activation cannot create
a partially configured window.

The owner is installed immediately after the browser-kernel capability and before browser-manager
assignment, watchdog setup, certificate-error registration, `app.setName`, Store/runtime startup,
activation handler registration, serve branching, or any window creation. This keeps the
capability available for ordinary desktop startup and serve-to-desktop promotion before the
activation gate settles.

## Window, updater, and lifecycle order

The retained order is:

1. `app.whenReady` resolves and records `app-ready`.
2. The browser-kernel capability loads and links browser/session dependencies.
3. The main-window capability loads and is installed in the fail-closed owner.
4. Existing watchdog, certificate, app identity, profile, Store, account, runtime, browser,
   plugin, automation, IPC, RPC, and activation setup continues unchanged.
5. The non-headless desktop path awaits the deferred core-IPC registry.
6. Desktop startup still invokes synchronous `openMainWindow()` and `runtimeRpc.start()` inside
   the same `Promise.all`.
7. `openMainWindow` synchronously resolves the four identities, validates every existing service
   guard, and constructs the window with the same Store and options, including `deferLoad: true`
   and the same quit, reload, crash, recovery, keybinding, and title callbacks.
8. The `did-finish-load` listener is attached before core IPC registration. Core IPC still
   receives the same Store, runtime, stats, usage, account, rate-limit, automation, plugin,
   marketplace, lifecycle, AI Vault, relaunch, and auth callback identities.
9. Automation web-contents attachment/start remains before `attachMainWindowServices`; attached
   services retain the same runtime-home, auth, PTY, reload, update, worktree, updater, menu, and
   lifecycle inputs.
10. TCC, rate limits, window-close cleanup, agent-status listeners, worktree events, and
    `loadMainWindow(window)` retain their existing order.

Manual update checks still call the exact `ensureAutoUpdaterConfigured` before
`checkForUpdatesFromMenu`. Manual renderer recovery still uses the exact `loadMainWindow`.
Window recreation reuses the installed capability and creates no duplicate functions or owners.
Tray reopen, macOS dock activation, menu/settings actions, updater pending configuration, and
serve promotion retain their existing gates.

BrowserManager initialization and partition policy remain in the earlier browser-kernel boundary.
Windows user-data ACL repair remains immediately before the BrowserWindow constructor. No path,
SSH/remote, folder-workspace, Git/provider, Git 2.25, or macOS/Linux/Windows policy moved into the
capability.

## Emitted chunks and dependency closure

The retained build emits:

- `out/main/chunks/main-window-startup-capability-Ua_UTW_Q.js`: 35,755 raw / 8,572 gzip bytes,
  SHA-256 `ad7a7b1a4316106aae35cacfb497845f54d339111c83eb372b878b9eb0727253`;
- `out/main/chunks/attach-main-window-services-YMLmQZvj.js`: 260,003 raw / 52,657 gzip bytes,
  SHA-256 `d9e01e56b321c7ca078e331cb360a4ca8e93f65ea36027d9cb86cefd2610cd4a`.

The retained `out/main/index.js` SHA-256 is
`c84d6cce378003b1cda42b6f29c6433f34fde9d3e6b6f8bcaf742877bf52abe5`.

An AST scan found 30 direct static relative edges from the capability chunk. Its full reachable
closure visited 98 JavaScript files and validated 482 relative edges. A separate complete
`out/main` scan checked 108 JavaScript files and 527 literal relative import, export, and require
edges. Every target exists beneath `out/main`; none escape the emitted main directory. The
capability's expected shared-module edge back to `../index.js` remains a bundler-generated cycle,
with `index.js` dynamically entering the capability.

## Budget

The prior Electron-main raw budget was 4,444,309 bytes. Lowering only that budget by the exact
395,002-byte raw reduction produces 4,049,307 bytes and leaves exactly 48,236 bytes of headroom
over the 4,001,071-byte entry. Preload and renderer budgets are unchanged.

## Validation

- Fresh production A and B builds: passed.
- Focused capability, owner, boundary, create/attach, app menu, system tray and tray icons,
  updater, update watchdog, macOS activation, serve activation/readiness/stdout, runtime-RPC
  startup failure, quit policy, Windows ACL, and core-IPC coverage: 26 files / 385 passed and 1
  skipped.
- Focused capability, owner, boundary, core-IPC, and desktop startup-order subset: 5 files / 21
  tests passed.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint --deny-warnings`: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 4,001,071 actual versus 4,049,307 budgeted
  Electron-main bytes.
- `git diff --check`: passed with no whitespace errors.

## Warnings and remaining limitation

Both production builds emitted the same existing CSS optimizer warnings for
`::highlight(markdown-preview-search-match)` and
`::highlight(markdown-preview-search-active-match)`.

The production build and dependency-closure checks prove packaged-relative emitted resolution on
this macOS worktree. This tranche did not run packaged-ASAR launch smokes on macOS, Linux, and
Windows. Cross-platform packaged launch verification remains explicitly unresolved.
