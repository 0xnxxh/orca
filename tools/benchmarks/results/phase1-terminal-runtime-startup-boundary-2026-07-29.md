# Phase 1 terminal-runtime startup boundary — 2026-07-29

**Scope:** Move Electron-main terminal startup, daemon lifecycle, provider access, pane teardown,
headless PTY registration, and first-window startup coordination behind one app-ready aggregate
capability while preserving exact PTY/provider identities, startup promises, and shutdown policy.

## Result

`src/main/index.ts` no longer value-imports `ipc/pty`, `daemon/daemon-init`,
`providers/local-pty-provider`, or `startup/first-window-startup-services`. It awaits one
`./startup/terminal-runtime-startup-capability` immediately after the existing browser-kernel and
main-window capabilities, installs the exact returned identities in a typed owner, and registers
the existing pane-key teardown callback once before any terminal startup.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  4,001,071 | 3,829,136 |   -171,935 |     849,834 |    814,599 |     -35,235 |

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

## Production importer and side-effect audit

Before this tranche, `index.ts` eagerly imported:

- `killAllPty`, `clearProviderPtyState`, `getPtyIdForPaneKey`,
  `registerPaneKeyTeardownListener`, `getLocalPtyProvider`, `getSshPtyProvider`, and
  `registerHeadlessPtyRuntime` from `ipc/pty`;
- `initDaemonPtyProvider`, `disconnectDaemon`, and `shutdownDaemon` from
  `daemon/daemon-init`;
- `LocalPtyProvider` from `providers/local-pty-provider`; and
- `startFirstWindowStartupServices` from `startup/first-window-startup-services`.

The remaining production import graph was also audited:

- `updater.ts` imports `killAllPty` from `ipc/pty` and is still eagerly imported by `index.ts` for
  update and quit state. Consequently, `ipc/pty` and its concrete `LocalPtyProvider` dependency
  were already in the eager graph independently of the removed index import.
- `attach-main-window-services.ts` imports PTY registration/provider values, but that module is
  behind the previously retained main-window startup capability.
- `register-core-handlers.ts` reaches terminal IPC through the deferred core-IPC registry.
- `ssh-relay-session.ts`, `local-build-compatibility.ts`, `hydrate-local-pty-registry.ts`, and
  `pty-management.ts` retain their domain-owned imports. Their desktop consumers are behind the
  existing deferred window/core-IPC graphs.
- `daemon-init.ts` imports the PTY provider getters/setters to atomically adopt and replace the
  live provider. No other eager index path retained `daemon-init`; moving it produced the emitted
  daemon chunk and most of the measured reduction.
- `first-window-startup-services.ts` now has one production value importer: the aggregate
  terminal-runtime capability.

`ipc/pty` owns module-level provider registries, pane teardown listeners, renderer delivery state,
and the initial local provider. `daemon-init` owns module-level spawner, adapter, and restart state,
but performs filesystem, socket, process, and provider-swap work only when its exported lifecycle
functions run. The first-window startup module creates timers and abort controllers only when its
factory is invoked. The capability constructs no replacement service and triggers none of those
operations while loading.

No PTY can be created or torn down before the app-ready callback installs the capability:
desktop PTY handlers are attached after Store/runtime construction and core IPC readiness;
headless PTY registration occurs after runtime construction and the local-provider barrier; and
the daemon startup factory is invoked later at the original startup point. An app that quits
before readiness has no PTY or daemon to clean up, so the owner exposes a nullable installed-state
read only for that early-quit path. All required consumers use the fail-closed getter, which throws
`Terminal-runtime capability must be initialized before use`.

## Capability identity and startup order

`createTerminalRuntimeStartupCapability` returns the exact original identities for all twelve
values: the seven PTY functions, three daemon functions, `LocalPtyProvider`, and
`startFirstWindowStartupServices`. It does not wrap constructors, providers, callbacks, or
promises.

The retained order is:

1. `app.whenReady` records `app-ready`.
2. Browser-kernel initialization completes.
3. Main-window capability initialization completes.
4. The terminal-runtime capability loads, is installed, and registers
   `stopSyntheticTitleSpinner` as the sole pane-key teardown listener added by `index.ts`.
5. Existing browser-manager, watchdog, certificate, app identity, Store, account, runtime, IPC,
   plugin, automation, and activation setup continues.
6. Runtime construction receives live thunks over the same `getLocalPtyProvider` and
   `getSshPtyProvider` identities, plus the same `clearProviderPtyState` callback. The thunks still
   resolve daemon swaps and current SSH relay generations at call time.
7. `startTerminalRuntimeStartupServices` invokes the same first-window factory at the original
   point after mobile/RPC wiring and before macOS activation and serve branching.
8. The daemon start receives the same `AbortSignal` and
   `macosLoginSessionWatch: process.platform === 'darwin' && !isServeMode`. Daemon and hook server
   startup remain parallel.
9. The returned `firstWindowReady`, `localPtyReady`, and `localPtyProviderReady` promises are
   assigned directly, without wrapping, to the existing module-level barriers. Their milestone
   callbacks remain unchanged.

Daemon failure still logs the terminal-persistence fallback and emits
`daemon_start_failed` with the same classified error. Hook-server failure remains non-fatal.
Desktop rendering retains the first-window and WSL barrier, while local destructive PTY routing
retains the provider-only barrier.

## Serve, provider, and teardown contracts

Headless serve still:

- awaits the managed WSL reconciliation barrier;
- awaits the exact `localPtyStartupReady` promise before registering a terminal runtime;
- passes the same runtime singleton, Store singleton, settings resolver, Codex preparation,
  Claude auth preparation, and Codex resume preparation to `registerHeadlessPtyRuntime`;
- attaches offscreen browser support only under its existing display gate;
- syncs the headless window graph before RPC start;
- tests the live provider with the exact `LocalPtyProvider` class identity before marking desktop
  promotion ready; and
- retains the same macOS/Linux/Windows, WSL, SSH/remote, and folder-workspace routing.

Synthetic-title ticks and state transitions still resolve pane keys through the same live PTY
registry. Pane teardown removes spinner state exactly once before terminal startup can create a
pane.

Committed quit still flushes stats before `killAllPty`, then starts watcher and Store cleanup. The
daemon promise remains in the same bounded teardown group after runtime-RPC shutdown begins.
Dev-parent shutdown calls the exact `shutdownDaemon` identity; normal quit calls the exact
`disconnectDaemon` identity. The second `will-quit` pass remains guarded by
`daemonDisconnectDone`. Update/relaunch, terminal scrollback capture, remote providers, Git
provider behavior, Git 2.25 compatibility, and cross-platform gates were not changed.

## Emitted chunks and dependency closure

The retained build emits:

- `out/main/chunks/terminal-runtime-startup-capability-W727_99D.js`: 3,416 raw / 1,217 gzip bytes,
  SHA-256 `a61862e4e6df6fc6c1e8698d9f9f4f3f86986fd8d635c726d4a1eb0e1a6dc1f6`;
- `out/main/chunks/daemon-init-DqgYWrbr.js`: 172,799 raw / 35,568 gzip bytes, SHA-256
  `05282be972ca20f754a01fd9f0b664184f829818c0cfb0cfc2ad8e2776672a67`.

The retained `out/main/index.js` SHA-256 is
`f08e6c9ebf1881f57bb3487fe7c41ce45d1ce6cd3a7dc4ccf3b006e1ee587aac`.

The capability's 18 direct relative dependencies are:

- `./win32-utils-DtAFUr2N.js`
- `./fs-utils-D5115c5m.js`
- `./tui-agent-config-DMkBaphp.js`
- `./wsl-CtpKNBla.js`
- `./agent-title-core-ZQqjV6ne.js`
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
- `./terminal-history-seed-chunks-DryYb1bm.js`
- `./headless-emulator-0yuclqag.js`
- `./daemon-init-DqgYWrbr.js`

An Acorn AST walk from the capability visited 100 JavaScript files and validated 511 literal
relative import, export, dynamic-import, and require edges. A separate full `out/main` AST scan
checked 110 JavaScript files and 556 relative edges. Every resolved target exists beneath
`out/main`; no path escapes the emitted directory. The `../index.js` edge is the bundler's
expected shared-module cycle, with `index.js` dynamically entering the capability.

## Budget

The prior Electron-main raw budget was 4,049,307 bytes. Lowering only that budget by the exact
171,935-byte raw reduction produces 3,877,372 bytes and leaves exactly 48,236 bytes of headroom
over the 3,829,136-byte entry. Preload and renderer budgets are unchanged.

## Validation

- Fresh production A and B `pnpm run build:electron-vite`: passed; main-module transforms changed
  from 1,982 to 1,984 while preload remained 17 modules and renderer remained 9,181 modules.
- Capability, owner, source-boundary, first-window startup, desktop/serve readiness, runtime,
  complete focused PTY IPC, daemon init/adapter/router/spawner/degraded provider, macOS daemon
  login-session, WSL terminal host, SSH relay generation/delivery/error, synthetic-title,
  quit-deadline, dev-parent shutdown, window attachment, and core-IPC coverage: 38 files / 936
  passed and 6 skipped.
- Updater/headless-serve install, update handoff, headless terminal layouts/hydration, CLI/WSL
  boundary and barrier, WSL environment, and hook-relay coverage: 11 files / 172 tests passed.
- Focused capability, owner, boundary, first-window, desktop, serve, and RPC-failure subset: 8
  files / 61 tests passed.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint --deny-warnings`: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 3,829,136 actual versus 3,877,372 budgeted
  Electron-main bytes.
- `git diff --check`: passed with no whitespace errors.

## Warnings and remaining limitation

Both production builds emitted the same existing CSS optimizer warnings for
`::highlight(markdown-preview-search-match)` and
`::highlight(markdown-preview-search-active-match)`.

The production build and dependency-closure checks prove packaged-relative emitted resolution on
this macOS worktree. This tranche did not run packaged-ASAR launch smokes on macOS, Linux, and
Windows. Cross-platform packaged launch verification remains explicitly unresolved.
