# Phase 1 plugin-system startup boundary

- **Date:** 2026-07-29
- **Scope:** Move the five-class plugin kernel behind one aggregate startup capability while
  preserving the kill-list barrier, platform path resolution, service identity, plugin policy,
  IPC/runtime wiring, initialization triggers, and shutdown.

## Result

`src/main/index.ts` now type-imports `PluginKillListService`, `PluginMarketplaceService`,
`PluginMarketplaceInstaller`, `PluginService`, and `PluginBundledBootstrapCoordinator`. At the
original plugin construction point it awaits exactly one
`./startup/plugin-system-startup-capability` import and one aggregate factory. The returned live
instances are assigned to the existing globals before any listener, RPC, initialization, seed,
bootstrap, event, IPC, window, or teardown consumer runs.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  7,331,492 | 7,225,280 |   -106,212 |   1,539,032 |  1,514,823 |     -24,209 |

The preload and all renderer static graphs were byte-for-byte unchanged:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

A SHA-256 manifest comparison matched all 786 emitted files outside `out/main`, covering the
complete preload and renderer output.

## Importer and constructor audit

Before the edit, a production-source search excluding tests found `src/main/index.ts` as the only
startup value importer and only direct constructor site for all five classes. Other production
consumers use type-only imports:

- `PluginService`: plugin enablement, list projection, approved ephemeral-VM recipes, core/plugin
  IPC, marketplace IPC, ephemeral-VM IPC, and runtime RPC.
- `PluginMarketplaceService`: marketplace installer and marketplace IPC.
- `PluginMarketplaceInstaller`: marketplace IPC.
- `PluginKillListService` and `PluginBundledBootstrapCoordinator`: no production consumer outside
  the implementation module and `index.ts`.

The existing plugin IPC graph is deliberately eager through `registerCoreHandlers`,
`ipc/plugins.ts`, `ipc/plugin-marketplaces.ts`, `ipc/ephemeral-vm.ts`, and runtime RPC method
registration. That graph already owns schemas and client contracts, so moving IPC registration
would have widened the change and altered readiness. The retained seam moves only the concrete
kernel constructors and their startup-only data-dir, host-entry, bundled-root, and normalization
helpers.

After the edit, `src/main/startup/plugin-system-startup-capability.ts` is the sole production
constructor site and value importer for the five classes. `index.ts` has one aggregate dynamic
import, one factory call, no direct plugin-kernel constructor, and no eager import of
`plugin-discovery`, `plugin-bundled-bootstrap`, `plugin-host-process`, or the plugin consent-state
normalizers.

## Aggregate interface and exact order

The capability accepts one narrow platform description:

- canonical current `userDataPath`;
- `hostVersion`;
- `appPath`;
- `resourcesPath`;
- `isPackaged`.

It also accepts live composition-root bindings for the selected plugin settings, keybindings,
kill-list entry/reason lookups, and plugin refresh. These are policies and mutable lifecycle
references owned by `index.ts`, not five constructor argument bags. In particular, the
kill-list and refresh closures still resolve through the globals, so committed quit clearing
retains its prior fail-closed/no-op behavior.

The focused capability test proves the exact sequence:

1. construct `PluginKillListService`;
2. await `initialize()` as a hard barrier;
3. construct `PluginMarketplaceService`;
4. construct `PluginMarketplaceInstaller` with the same marketplace instance;
5. construct `PluginService`;
6. construct `PluginBundledBootstrapCoordinator`.

The same platform strings and callback objects reach their original consumers by identity. The
factory performs no event wiring or initialization beyond the pre-existing awaited kill-list
load. After it returns, `index.ts` assigns kill list, marketplace, installer, plugin service, and
bundled bootstrap in that order, before restoring the original listeners and triggers.

## Preserved behavior, paths, and side effects

No plugin service implementation changed.

- Kill-list construction still creates the same file store and fetcher. The awaited initialize
  barrier still loads the cached snapshot, fails open on an invalid cache, and completes before
  marketplace, installer, plugin service, or bundled bootstrap construction. Refresh
  serialization, future/rollback rejection, atomic persistence, and change notifications are
  untouched.
- Marketplace construction still creates the same source/snapshot store, fetcher, refresh
  chains, provenance checks, official source state, and kill-list projection. Installer preview,
  Git checkout, content inspection, immutable install, rollback, and safety checks are unchanged.
- `PluginService` still constructs its extension registry, event bus, content verifier, audit
  log, log buffer, content-pack registry, panel controller, worker controller, and housekeeping
  owner. Construction still forks no worker and reads no panel content; workers remain lazy
  behind explicit approved triggers.
- The feature flag remains fail-closed. With it off, discovery produces no plugins, panels are
  revoked, worker state reconciles empty, bundled bootstrap returns without reading resources,
  and official marketplace seeding is not requested.
- Packaged plugin hosts still resolve against the `app.asar.unpacked` form with the same direct
  entry/fallback behavior. Development hosts still resolve beneath the application/out tree.
  Bundled plugins still resolve to `resourcesPath/plugins/launch` when packaged and
  `appPath/resources/plugins/launch` in development through `path.join`.
- No macOS, Linux, Windows, SSH, WSL, remote-runtime, folder-workspace, Git-provider, or Git 2.25
  path changed.

## Preserved wiring, readiness, and lifecycle

All policy and lifecycle wiring remains in `src/main/index.ts`:

- kill-list change reconciliation;
- plugin-system setting listeners, enable-time bundled bootstrap and official marketplace seed,
  and packaged enable-time kill-list refresh;
- runtime RPC setter with the same consent and enablement write paths;
- fire-and-forget `PluginService.initialize()` and the
  `plugin-system-initialized` duration/discovered-count milestone;
- packaged startup kill-list refresh;
- plugin change broadcasts, language-pack replacement, UI-language rebuild, and menu rebuild;
- initial bundled bootstrap and official marketplace seed;
- agent-status and worktree lifecycle event taps.

The initial bootstrap and seed requests still occur after change listeners and initialization
have been installed. The feature setting listener in plugin IPC still refreshes on
`pluginSystemEnabled` or `devPluginPaths`, and core IPC still installs plugin, marketplace, and
ephemeral-VM handlers once with the same service objects. `setPluginServiceForRpc` still runs
before either serve or desktop `runtimeRpc.start()`.

There was no standalone plugin null-check in `openMainWindow` before this tranche. Its readiness
contract remains the startup chain: the aggregate factory and all global assignments finish
before `services-initialized`, and both the desktop `openMainWindow()` call and serve RPC startup
occur later. `registerCoreHandlers` receives the same `pluginService`, marketplace, and installer
identities, so renderer IPC, ephemeral-VM recipes, runtime delegate binding, panel ownership, and
main-window recreation behavior are unchanged.

Committed `will-quit` still clears runtime RPC plugin access, kill list, marketplace, and
installer globals before starting `pluginService.dispose()`, then clears the plugin global. The
same dispose path stops housekeeping, revokes panels, waits for refresh settlement, shuts down
workers, flushes the audit log, and remains in the bounded `plugin-hosts` teardown barrier.

## Generated chunk and packaged-relative resolution

The emitted capability chunk is
`out/main/chunks/plugin-system-startup-capability-DlTOKOId.js` (111,343 raw / 26,060 gzip bytes).
`out/main/index.js` loads it through
`./chunks/plugin-system-startup-capability-DlTOKOId.js`.

The entry specifier is relative, contains no parent traversal, and resolves under `out/main`.
Every relative dependency in the capability chunk was resolved, confirmed to exist, and
confirmed to remain under `out/main`:

- `../index.js`
- `./chunk-BTjIgr6M.js`
- `./keybindings-BUptVVER.js`
- `./parcel-watcher-event-delivery-BtdYFaIv.js`
- `./plugin-host-protocol-B0PDvGKP.js`
- `./plugin-manifest-Dsyt2dd3.js`

These paths match packaged-relative CommonJS resolution.

## Budget

The prior `electron-main` raw budget was 7,379,728 bytes. Lowering it by the exact measured
106,212-byte improvement produces a new budget of 7,273,516 bytes and leaves exactly 48,236
bytes (0.668%) of headroom over the 7,225,280-byte entry. No preload or renderer budget changed.

## Validation

- Fresh production A and B `pnpm run build:electron-vite`: passed. The baseline transformed
  1,971 main modules and the post-edit build transformed 1,972; both transformed 17 preload
  modules and 9,181 renderer modules.
- Focused aggregate capability/boundary, complete plugin service integrity/reconciliation and
  startup-budget suite, registries, worker/panel/event/host, kill-list, marketplace/install/
  bootstrap, plugin/core/marketplace/ephemeral-VM IPC, runtime RPC, desktop/serve startup, and
  shutdown suite: passed, 55 files with 366 tests.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint` on the touched source and tests: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check` on the touched source, tests, and budget: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 7,225,280 actual versus 7,273,516 budgeted
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
