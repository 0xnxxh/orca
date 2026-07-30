# Phase 1 updater-runtime startup boundary — 2026-07-29

**Scope:** Move the shared updater singleton and remote-server updater adapter behind one
app-ready aggregate capability while retaining a minimal synchronous quit-state seam for
pre-readiness activation and Electron quit policy.

## Result

`src/main/index.ts` no longer value-imports `updater.ts` or
`runtime/remote-server-updater.ts`. It awaits one
`./startup/updater-runtime-startup-capability` after the retained browser, main-window, and
terminal-runtime capabilities, installs the exact returned identities in a typed owner, and
configures the remote adapter before any runtime RPC server or updater method can observe it.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  3,829,136 | 3,761,675 |    -67,461 |     814,599 |    801,485 |     -13,114 |

The preload and every renderer static graph were byte-for-byte unchanged:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

The sorted SHA-256 manifests for all 786 files outside `out/main` were identical. Each manifest
contained 786 rows / 89,303 bytes and had SHA-256
`e7fed74bb51c30b41084a2a5d052f5dc0773a696552f1a8e051d363ed4be762a`; their direct diff was
empty.

## Production importer and lifecycle audit

Before this tranche, `index.ts` eagerly imported:

- `checkForRemoteServerUpdate`;
- `checkForUpdatesFromMenu`;
- `downloadRemoteServerUpdate`;
- `getRemoteServerUpdaterSnapshot`;
- `installRemoteServerUpdate`;
- `isQuittingForUpdate`;
- `resolveUpdateInstallMode`; and
- `configureRemoteServerUpdater`.

The complete production graph showed:

- `attach-main-window-services.ts` imports the same updater singleton for setup, status, download,
  install, dismissal, nudge, and menu-check behavior. That importer is already behind the retained
  main-window startup capability.
- Main-window core IPC reaches those attached updater functions only after the deferred core-IPC
  registry and window creation.
- Runtime RPC status and updater methods import `runtime/remote-server-updater.ts`, whose adapter
  intentionally starts unavailable and throws `remote_update_manual_required` for mutating
  operations until configured.
- The runtime RPC method graph is loaded after runtime construction, well after the new capability
  configures the adapter.
- `updater.ts` imports `ipc/pty` for the committed native-install cleanup. Moving the updater
  therefore also removes that remaining PTY entry path while preserving the same `killAllPty`
  identity inside the updater chunk.
- Local build feed/switch, nudge, prerelease, auto-updater loading, diagnostics, macOS install,
  update watchdog, and serve handoff modules remain owned by the same updater singleton.

The updater module owns all existing status, retry, feed, nudge, download, install, and relaunch
state. The capability constructs no replacement updater and performs no setup; it returns the
seven original updater/adapter function identities. The main-window capability may evaluate the
same updater module first through its attached-services graph, but both capabilities receive the
same ESM singleton and state.

## Minimal pre-ready quit-state seam

`isQuittingForUpdate` was the only updater value required before app readiness:

- the second-instance/desktop activation path checks it synchronously before loading core IPC and
  checks it again before opening a window;
- renderer teardown classification checks it synchronously;
- `before-quit` uses it for update lifecycle diagnostics; and
- `will-quit` snapshots it before PTY, RPC, daemon, Store, and telemetry cleanup.

Those call sites cannot become asynchronous. The boolean now lives in the specifically named
`updater-quit-state.ts` module, which starts false and exposes only
`isQuittingForUpdate`, `markUpdateInstallQuitInProgress`, and
`clearUpdateInstallQuitInProgress`. `index.ts` eagerly imports only the read function.
`updater.ts` marks the same state at the exact former assignment immediately before update cleanup
and native installer invocation, clears it only through the existing recovery/reset path, and
re-exports the read function for API compatibility.

The initial state remains fail-closed: activation is not suppressed until an update install has
explicitly marked the shared state. Committed installs still keep the state true so macOS dock
activation, second-instance activation, tray reopen, and reload recovery cannot resurrect the old
bundle. Pre-native and uncommitted failures still clear it through the same reset path.

## Capability, configuration, and identity order

The retained order is:

1. Module startup assigns `process.env.ORCA_APP_VERSION = app.getVersion()` before any dynamic
   updater load. PTY children, the daemon, and the remote unavailable snapshot retain the same
   version source and fallback.
2. `app.whenReady` records `app-ready`.
3. Browser-kernel initialization completes.
4. Main-window capability initialization completes.
5. Terminal-runtime capability installation and its sole pane-teardown registration complete.
6. The updater-runtime capability loads and returns the exact six updater identities plus the
   exact `configureRemoteServerUpdater` identity.
7. The exact capability object is installed in the fail-closed owner.
8. The remote adapter is synchronously configured with the exact
   `getRemoteServerUpdaterSnapshot`, `checkForRemoteServerUpdate`,
   `downloadRemoteServerUpdate`, and `installRemoteServerUpdate` identities.
9. Browser-manager, Store, account, runtime, plugin, mobile, and runtime RPC startup continues.

The updater owner throws `Updater-runtime capability must be initialized before use` if a required
post-ready consumer runs prematurely. Remote RPC construction occurs after configuration, so
status, check, download, and install cannot observe the unavailable adapter during supported
startup. The adapter module itself retains its original unavailable behavior for genuinely
unconfigured consumers and tests.

## Desktop, serve, and update policy

Menu and tray manual checks still call `ensureAutoUpdaterConfigured` first, then call the exact
`checkForUpdatesFromMenu` identity with the same optional prerelease/perf options.
`attachMainWindowServices` still owns the pending auto-updater setup callback and receives the
exact update-install mode:

- desktop: `interactive`;
- supervised headless serve: `supervised-headless-serve`; and
- unsupervised headless serve: `unsupported-headless-serve`.

Serve-to-desktop promotion does not change the headless install policy. Remote status/check/
download/install methods still report the same app version, runtime ID, support reason, updater
status, target version, and accepted result. Automatic checks, local build feed selection,
downgrade handling, nudge state, prerelease fallback, retry cadence, release diagnostics, and
renderer status broadcasts remain inside the same singleton.

Update installation still preserves agent credentials through the existing attached-window
callback, invokes native `quitAndInstall` before PTY destruction, calls the same `killAllPty`,
removes close listeners only after native acceptance, and retains the serve-supervisor handoff and
exit watchdog gates. `before-quit` and `will-quit` ordering, daemon/RPC teardown, relaunch
callbacks, macOS dock suppression, Windows/Linux native behavior, SSH/remote, WSL,
folder-workspace, Git-provider, and Git 2.25 behavior were not changed.

## Emitted chunks and dependency closure

The retained build emits:

- `out/main/chunks/updater-runtime-startup-capability-CFV-Nyy-.js`: 1,364 raw / 530 gzip bytes,
  SHA-256 `cd17bc8d124de75543b021a87e50c7c769451673f01d1b250b7cd678795f7514`;
- `out/main/chunks/updater-DiHIcp8X.js`: 69,929 raw / 13,612 gzip bytes, SHA-256
  `97333c856ab3e6007ceca1a43fddfd906310fd7ca4d888e2f3ae1468b70baef0`.

The retained `out/main/index.js` SHA-256 is
`de4728ad2aa99b357b9ee5dbd4589f3d709908ab424fa45118bc08266bc63b9a`.

The capability's 16 direct relative dependencies are:

- `./win32-utils-DtAFUr2N.js`
- `./fs-utils-D5115c5m.js`
- `./tui-agent-config-DMkBaphp.js`
- `./wsl-CtpKNBla.js`
- `./terminal-view-attributes-D2Y73h-d.js`
- `./clipboard-text-CRn8fVQZ.js`
- `./hook-service-DW83xYw6.js`
- `./terminal-tab-id-aqPw5adY.js`
- `./grok-session-paths-DGDWgbNw.js`
- `./codex-app-server-client-DB28RBY-.js`
- `./managed-agent-hook-controls-B_rRGlfA.js`
- `./codex-home-paths-RmLALm-m.js`
- `./pty-path-safety-BexQaAV3.js`
- `./worktree-id-OYDHEjE8.js`
- `../index.js`
- `./updater-DiHIcp8X.js`

An Acorn AST walk from the capability visited 104 JavaScript files and validated 545 literal
relative import, export, dynamic-import, and require edges. A separate full `out/main` AST scan
checked 114 JavaScript files and 591 relative edges. Every resolved target exists beneath
`out/main`; no path escapes the emitted directory. The `../index.js` edge is the bundler's
expected shared-module cycle and carries shared entry state, including the narrow quit-state
singleton.

## Budget

The prior Electron-main raw budget was 3,877,372 bytes. Lowering only that budget by the exact
67,461-byte raw reduction produces 3,809,911 bytes and leaves exactly 48,236 bytes of headroom
over the 3,761,675-byte entry. Preload and renderer budgets are unchanged.

## Validation

- Fresh production A and B `pnpm run build:electron-vite`: passed; main-module transforms changed
  from 1,984 to 1,987 while preload remained 17 modules and renderer remained 9,181 modules.
- Capability, owner, source-boundary, quit-state, full updater variants, remote adapter/RPC,
  runtime RPC startup, create/attach window, main-window boundary, menu/tray, macOS activation,
  desktop/serve activation/readiness/stdout, update handoff, PTY cleanup, auth preservation,
  relaunch, quit policy, terminal boundary, desktop startup, and core-IPC coverage: 41 files / 915
  passed and 1 skipped.
- Focused capability, owner, boundary, quit-state, updater, remote adapter/RPC, main-window
  boundary, and desktop ordering subset: 9 files / 121 tests passed.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint --deny-warnings`: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 3,761,675 actual versus 3,809,911 budgeted
  Electron-main bytes.
- `git diff --check`: passed with no whitespace errors.

## Warnings and remaining limitation

Both production builds emitted the same existing CSS optimizer warnings for
`::highlight(markdown-preview-search-match)` and
`::highlight(markdown-preview-search-active-match)`.

The production build and dependency-closure checks prove packaged-relative emitted resolution on
this macOS worktree. This tranche did not run packaged-ASAR launch smokes on macOS, Linux, and
Windows. Cross-platform packaged launch verification remains explicitly unresolved.
