# Phase 1 desktop-shell startup boundary — 2026-07-29

**Scope:** Move the app-ready menu, tray, dashboard-popout, macOS activation,
window-visibility notification, unread-badge, and startup-notification identities behind one
aggregate capability while retaining the minimal synchronous focus leaf required by the
pre-app-ready second-instance contract.

## Result

`src/main/index.ts` now performs one dynamic import of
`./startup/desktop-shell-startup-capability` after the retained browser, main-window,
terminal-runtime, and updater-runtime capabilities. It installs the returned object in a typed
owner before certificate handling, Store creation, runtime construction, menu registration,
terminal startup, serve branching, window creation, or runtime RPC start.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  3,761,675 | 3,697,673 |    -64,002 |     801,485 |    785,736 |     -15,749 |

The preload and all renderer static graphs were byte-identical:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

The sorted SHA-256 manifests for all 786 files outside `out/main` were identical. Each manifest
contained 786 rows / 89,303 bytes and had SHA-256
`e7fed74bb51c30b41084a2a5d052f5dc0773a696552f1a8e051d363ed4be762a`;
their direct diff was empty.

## Production importer audit

Before this tranche, `index.ts` directly value-imported the following desktop-shell modules:

- `menu/register-app-menu`: `registerAppMenu`, `rebuildAppMenu`, and
  `getNextDefaultOnAppearanceSettingValue`. Its other production importers are the settings and
  keybinding IPC handlers already reached through the deferred core-IPC registry.
- `tray/system-tray`: `createSystemTray`, `destroySystemTray`,
  `setMacMenuBarIconVisible`, and `setTrayAttention`. Its other importers are app and
  notification IPC; the former is behind core IPC, while the latter was also eagerly reached by
  `index.ts` solely for startup notification registration.
- `window/dashboard-popout-window`: `zoomDashboardPopoutIfFocused`. Its other importers are the
  retained deferred main-window capability and dashboard, terminal-preview, and clipboard IPC
  graphs.
- `window/macos-app-activation`: `createMacAppActivationHandler`; `index.ts` was its sole
  production importer.
- `window/focus-existing-window`: `focusExistingMainWindow`; dashboard IPC also imports the
  narrower `safelyRevealWindow`.
- `window/main-window-visibility`: `notifyMainWindowBecameVisible`; notification IPC,
  worktree-base-directory polling, and SSH relay sessions consume the same module-level listener
  registry.
- `dock/unread-badge`: `setUnreadDockBadgeCount`; app IPC consumes the same module-level badge
  state behind core IPC.

The aggregate also returns the exact `triggerStartupNotificationRegistration` identity. Without
that addition, the eager `index.ts` notification import would continue pulling the tray and
window-visibility graph into the entry. Notification registration policy, sounds, permission
handling, and IPC channels remain in `ipc/notifications.ts`.

## Pre-ready and lifecycle audit

`focusExistingMainWindow` intentionally remains the only eager target leaf. The single-instance
lock is acquired before `app.whenReady`, and its synchronous callback calls
`requestDesktopActivation`; the desktop activation gate can immediately reach
`focusExistingWindow`. A pre-ready second-instance must still return `pending` synchronously via
the original focus function, while an already-ready process must synchronously reveal, restore,
focus, or recreate the window. Deferring that leaf would change this established contract.

All other moved identities have no required pre-ready caller:

1. At app readiness, the browser, main-window, terminal-runtime, and updater-runtime capabilities
   are installed first.
2. The desktop-shell aggregate is loaded once, its exact object is installed in the owner, and the
   macOS activation handler is constructed with the original `getWindow` and
   `requestDesktopActivation` callback identities.
3. Certificate handling, Store and service construction, browser-session setup, runtime/RPC
   wiring, and plugin startup follow.
4. Main i18n finishes before the exact menu registration function receives the original update,
   reload, settings, setup-guide, crash-report, feature-tour, zoom, sidebar, appearance, and
   keybinding callbacks.
5. Terminal startup completes before the same macOS activation handler is registered. Registration
   remains before the headless-serve branch, so serve-to-desktop promotion can use it once the
   existing activation gate becomes ready.
6. Desktop startup still loads core IPC before the synchronous `openMainWindow` call. Window and
   runtime RPC startup remain parallel.

The typed owner throws if a required post-ready consumer runs before installation. `will-quit`
uses the optional owner read because Electron can theoretically quit before readiness; its
pre-install behavior is the same observable no-op as destroying a never-created tray and clearing
an initially empty dock badge. Post-ready cleanup calls the exact shared functions.

## Identity and behavior preservation

The capability constructs no replacement service and owns no state. It returns the original
functions from their original modules, preserving:

- the application menu's module-level last-registration options and rebuild identity;
- platform-specific menu labels, `CmdOrCtrl` accelerators, and modifier-click updater options;
- the tray singleton, attention latch, native-theme listener, dev badge, macOS status item,
  Windows notification icon, and Windows quit latch behavior;
- the dashboard-popout singleton and focused-window zoom routing;
- the process-global main-window visibility listener set used by local polling and SSH relay
  sessions;
- the unread dock-badge module state;
- main-window show/restore notification and tray-attention clearing on every recreation;
- settings-driven macOS menu-bar visibility;
- updater quit suppression, manual menu/tray update checks, and pending auto-updater setup;
- startup notification registration after the first window is shown and onboarding is complete;
  and
- macOS dock activation, hidden-window restore, second-instance focusing, and serve promotion.

The original platform checks remain inside the source modules: tray work remains macOS/Windows
only, dock badges remain macOS only, Linux tray creation remains a no-op, and macOS activation
uses the existing destroyed-window test. This tranche changes no path, workspace, Git, provider,
SSH, remote, WSL, folder-workspace, or Git 2.25 behavior and does not assume a local Git worktree.

## Emitted chunks and dependency closure

The retained build emits
`out/main/chunks/desktop-shell-startup-capability-DX4FEJ5N.js` at 1,640 raw / 604 gzip bytes with
SHA-256 `0c10aca2368870f2977683f4db50aeef56ffbc673ee2e50ddf285a14de7a75c9`.
Its eight direct static relative dependencies are:

- `./tui-agent-config-DMkBaphp.js`
- `./worktree-id-D7UI5W7A.js`
- `./keybindings-dTghwn23.js`
- `../index.js`
- `./browser-url-ChZQOGgl.js`
- `./window-shortcut-policy-C9Dpprb5.js`
- `./register-app-menu-CbXEWIpV.js`
- `./dashboard-popout-window-D7hqkv8t.js`

The `../index.js` edge is the bundler's expected shared-entry cycle. It preserves shared
main-window visibility state rather than creating a second registry.

An Acorn AST walk of the capability closure visited 110 JavaScript files and validated 588
literal relative import, export, dynamic-import, and require edges. A separate full `out/main`
scan checked all 120 JavaScript files and 634 relative edges. Every resolved target exists beneath
`out/main`; no edge escapes the emitted directory. The final `out/main/index.js` SHA-256 is
`12659e2bc9a122e5d9e62a34e05aa8edab6e5c51ef2606f63400c5d5995b6aed`;
the A entry SHA-256 was
`de4728ad2aa99b357b9ee5dbd4589f3d709908ab424fa45118bc08266bc63b9a`.

## Budget

The prior Electron-main raw budget was 3,809,911 bytes. Lowering only that budget by the exact
64,002-byte reduction produces 3,745,909 bytes and leaves exactly 48,236 bytes of headroom over
the 3,697,673-byte entry. Preload and renderer budgets are unchanged.

## Validation

- Fresh production A and final B `pnpm run build:electron-vite`: passed; main transforms changed
  from 1,987 to 1,989, preload remained 17 modules, and renderer remained 9,181 modules.
- Focused capability, owner, source-boundary, menu, tray, unread badge, dashboard popout, focus,
  macOS activation, visibility, main-window create/attach, notification/app IPC, desktop ordering,
  serve activation/promotion, updater boundary/quit state, window-all-closed, teardown deadline,
  update handoff, and serve readiness coverage: 24 files / 300 passed and 1 skipped.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint --deny-warnings`: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 3,697,673 actual versus 3,745,909 budgeted
  Electron-main bytes.
- `git diff --check`: passed with no whitespace errors.

Both production builds emitted the same existing CSS optimizer warnings for
`::highlight(markdown-preview-search-match)` and
`::highlight(markdown-preview-search-active-match)`.

## Remaining limitation

The production build and closure scans validate emitted relative dependency resolution on this
macOS worktree. This tranche did not run packaged-ASAR launch smokes on macOS, Linux, and Windows;
cross-platform packaged launch verification remains explicitly unresolved.
