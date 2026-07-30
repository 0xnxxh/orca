# Phase 1 browser-kernel startup boundary — 2026-07-29

**Scope:** Move the concrete browser manager, certificate trust controller, and browser-session
startup graph behind one app-ready capability while preserving synchronous window creation,
singleton identity, browser security policy, desktop/headless readiness, and shutdown cleanup.

## Result

`src/main/index.ts` now type-imports `BrowserManager` and awaits one
`./startup/browser-kernel-startup-capability` immediately after the `app-ready` milestone. The
capability returns the existing manager, trust controller, and session initializer identities and
links synchronous window consumers to the same manager/session registry through a narrow typed
slot.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  4,565,102 | 4,396,073 |   -169,029 |     972,143 |    934,292 |     -37,851 |

The preload and all renderer static graphs were byte-for-byte unchanged:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

The sorted SHA-256 manifests for all 786 files outside `out/main` were identical. Each manifest
contained 786 rows / 87,731 bytes and had SHA-256
`68ba944c45d80c14c538180894eade74a3897e120fa0bf6a89fbb60500a3ab01`; a direct diff produced no
output.

## Importer and readiness audit

Before the edit:

- `index.ts` eagerly value-imported `browserCertificateTrustController` and `browserManager` from
  `browser-manager.ts`, plus `initializeBrowserSessionsForApp` from
  `browser-session-startup.ts`.
- `createMainWindow.ts` eagerly imported both `browserManager` and `browserSessionRegistry`.
- `attach-main-window-services.ts` eagerly imported `browserManager`.
- `browser-session-registry.ts` imports the same manager singleton to install download,
  permission, and certificate policies.
- Browser IPC imports the manager, trust controller, and registry behind the already-deferred
  aggregate core-IPC boundary.
- `orca-runtime-browser.ts` imports the same identities behind the already-deferred aggregate
  runtime-service capability.
- Agent-browser and offscreen startup capabilities type-import `BrowserManager`; their concrete
  implementations remain dynamically attached later.

No browser value is consumed before `app.whenReady`:

- `createMainWindow` and `attachMainWindowServices` are defined eagerly but are not invoked before
  the desktop startup branch opens a window.
- Core browser IPC is loaded only on the desktop path after service initialization.
- Runtime browser commands are constructed only after the deferred runtime-service load.
- Headless offscreen attachment occurs inside the existing serve/display gates.
- The module-level quit handler only clears a listener that is installed after browser-kernel
  initialization.

After the edit:

- `index.ts` has one type-only browser-manager import, no browser-session-startup import, and one
  dynamic aggregate capability.
- Both eager window modules import only `browser-kernel-window-dependencies.ts`, whose runtime
  state is a manager reference plus one partition predicate and has no concrete browser imports.
- The capability is the explicit value seam for the manager, controller, session registry, and
  initializer.

## Capability and singleton linkage

`createBrowserKernelStartupCapability` imports the existing module singletons; it does not
construct replacements. `browser-manager.ts` still constructs exactly one `BrowserManager`, then
one `BrowserCertificateTrustController` whose callbacks resolve guest state through that manager,
and finally installs that controller back onto the same manager.

The capability configures synchronous window consumers with:

- that exact `BrowserManager`; and
- a closure over the exact `browserSessionRegistry.isAllowedPartition` method.

`createMainWindow` resolves the linked dependencies at function entry. It still installs the
dictation predicate, validates every webview partition against the same active-profile registry,
attaches guest policies to the same manager, and clears the predicate on close.
`attachMainWindowServices` resolves the same manager and still calls `unregisterAll` when its
window closes. A missing startup link fails synchronously before window wiring instead of allowing
a partially secured window.

Focused tests prove returned identity, manager/controller linkage, registry delegation, the one
dynamic import/factory, and removal of concrete browser values from the two eager window modules.

## Startup, session, and lifecycle order

The retained order is:

1. `app.whenReady` resolves and records `app-ready`.
2. The browser-kernel capability loads and links synchronous window consumers.
3. The existing main-thread watchdog/hang marker work runs.
4. The `certificate-error` handler is registered with the same `event`, `webContents`, `url`,
   `error`, `certificate`, `callback`, and `isMainFrame` arguments.
5. `app.setName`, CLI/WSL reconciliation, Store/profile startup, app icon, and proxy application
   continue unchanged.
6. `initializeBrowserSessionsForApp` receives the same active profile ID and profile directory at
   the original point after proxy application and before system-resume registration.
7. The same session registry applies pending cookie import before the first partition access,
   hydrates persisted profiles, and remains guarded by its existing one-time initialization flag.
8. The same manager receives the keybinding settings resolver, mobile guest-state listener,
   agent-browser bridge, and serve-only offscreen backend.
9. Headless graph sync precedes RPC start and serve readiness; desktop window creation and RPC
   startup retain their parallel order.
10. `will-quit` clears the guest-state listener from the exact retained manager, then existing
    agent-browser/offscreen teardown continues unchanged.

The registry singleton now evaluates after Electron readiness but still before `app.setName` and
before any session/window access. Its fallback user-data lookup therefore retains the same
canonical Electron path, while active-profile configuration and cookie replay remain at their
original later point.

Certificate admission, guest registration, permissions, downloads, partitions, popup/navigation
policy, settings, SSH/remote and folder-workspace routing, and macOS/Linux/Windows gates were not
changed.

## Emitted chunks and dependency closure

The retained build emits:

- `out/main/chunks/browser-kernel-startup-capability-C4bJ_B8V.js`: 1,267 raw / 454 gzip bytes,
  SHA-256 `7e9d2f0e58fb47e44b8938e7c64497abbeb528c12509a8fc2ccdf45848d0e452`;
- `out/main/chunks/browser-session-registry-HfuHVwQ8.js`: 167,008 raw / 36,977 gzip bytes,
  SHA-256 `983e503819f0ff956d55653e0bfe59657498f90b8629b29e2ef8f2cad27ef7d2`.

The capability's four direct static relative dependencies are:

- `./tui-agent-config-DMkBaphp.js`
- `./keybindings-dTghwn23.js`
- `../index.js`
- `./browser-session-registry-HfuHVwQ8.js`

The `../index.js` edge is the bundler's expected shared-module cycle; the capability remains
dynamically entered from `index.js`.

An AST-based walk from the capability visited 90 JavaScript files and validated 415 relative
edges. A separate complete emitted-main scan checked all 100 JavaScript files and all 460 literal
relative `require`, `import`, and export references. Every target exists and resolves beneath
`out/main`; no specifier escapes through parent traversal.

## Budget

The prior `electron-main` raw budget was 4,613,338 bytes. Lowering only that budget by the exact
169,029-byte reduction produces 4,444,309 bytes and leaves exactly 48,236 bytes of headroom over
the 4,396,073-byte entry. Preload and renderer budgets are unchanged.

## Validation

- Fresh production A and B `pnpm run build:electron-vite`: passed. The baseline transformed
  1,978 main modules and the retained build transformed 1,980; both transformed 17 preload
  modules and 9,181 renderer modules.
- Complete `src/main/browser` plus create/attach window services, browser IPC, runtime browser,
  runtime browser RPC methods, agent-browser/offscreen boundaries, desktop startup ordering,
  serve activation/readiness/stdout, and runtime RPC startup-failure coverage: 45 files / 748
  tests passed.
- Focused capability, source-boundary, and window consumer subset: 4 files / 116 tests passed.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint --deny-warnings`: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 4,396,073 actual versus 4,444,309 budgeted
  main bytes.
- `git diff --check`: passed with no whitespace errors.

## Warnings and remaining limitation

Both production builds emitted the same existing CSS optimizer warnings for
`::highlight(markdown-preview-search-match)` and
`::highlight(markdown-preview-search-active-match)`.

The production build and dependency-closure checks prove packaged-relative emitted resolution on
this macOS worktree. This tranche did not run packaged-ASAR launch smokes on macOS, Linux, and
Windows. Cross-platform packaged launch verification remains explicitly unresolved.
