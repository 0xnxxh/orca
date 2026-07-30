# Phase 1 core IPC registry startup boundary — 2026-07-29

**Scope:** Defer the aggregate desktop-only core IPC registry without making
`openMainWindow` asynchronous or changing handler registration, service identity, desktop
activation, headless serve, renderer readiness, runtime RPC, window recreation, or shutdown
contracts.

## Result

`src/main/index.ts` no longer value-imports `registerCoreHandlers`. It type-imports a
`CoreIpcRegistry` function signature, memoizes one dynamic import of
`./startup/core-ipc-registry-startup-capability`, and stores the returned exact register function
in a module-level slot. Normal desktop startup awaits that slot before the existing parallel
`openMainWindow()` and `runtimeRpc.start()` launch. Ordinary headless serve completes its RPC,
readiness, and return path without loading the registry.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  7,225,280 | 6,549,287 |   -675,993 |   1,514,823 |  1,375,919 |    -138,904 |

The preload and all renderer static graphs were byte-for-byte unchanged:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

A SHA-256 manifest comparison matched all 786 emitted files outside `out/main`, covering the
complete preload and renderer output.

## Importer, caller, and reachable-graph audit

Before the edit, a production-source search excluding tests found `src/main/index.ts` as the sole
value importer and sole caller of `registerCoreHandlers`. The function has no constructor; its
module-level `registered` flag is the existing one-time registration authority.

After the edit:

- `src/main/startup/core-ipc-registry-startup-capability.ts` is the sole production value importer.
- `src/main/index.ts` has one type-only capability import, exactly one dynamic aggregate import,
  one capability call, and no eager import of `ipc/register-core-handlers`.
- The capability returns the imported function itself without invoking, wrapping, or rebinding it.
- No direct handler import, handler call, schema, policy, service API, or IPC channel moved.

A production-symbol comparison found 52 representative registration functions removed from the
static entry. They include app, CLI, filesystem, Claude/Codex/OpenCode usage, GitHub/GitLab/hosted
review, Linear/Jira, feedback, crash reporting, export, stats, memory, rate limits, runtime
environment, ephemeral VM, AI Vault, native chat, notebook, onboarding, dashboard popout,
terminal preview, permissions, sessions, settings, diagnostics, skills, workspace spaces/ports,
automation, keybindings, telemetry, shell, pets, emulator streams, profile/account, agent-hook,
trust, and MiniMax/Grok account handlers.

Six representative handler symbols remain eager because production paths outside the desktop
core registry still use their modules:

- `registerPreflightHandlers` through runtime/RPC/Linear/Jira paths;
- `registerFilesystemWatcherHandlers` through runtime and index cleanup;
- `registerNotificationHandlers` through startup notification and RPC paths;
- `registerBrowserHandlers` through runtime browser paths;
- `registerPluginHandlers` through runtime plugin RPC;
- `registerUIHandlers` through window/dashboard/GitHub/UI trust paths.

This is the coherent boundary available without redesigning the already-shared runtime graphs.

## Interface, loading, and activation

The startup capability exports only:

```ts
export type CoreIpcRegistry = typeof registerCoreHandlers
export function getCoreIpcRegistryStartupCapability(): CoreIpcRegistry
```

Index owns both the resolved function and the memoized import promise. Concurrent activation,
startup, or reopen requests therefore share one module load and one function identity.

The existing activation sources remain intact:

- the second-instance lock and macOS activation still call `requestDesktopActivation`;
- normal desktop activation is immediately eligible, as before;
- serve activation remains queued while the serve gate is `initializing`, then either runs after
  `markReady()` or reports the existing persistent-PTY-provider block;
- tray reopen still restores an existing window synchronously and uses the registry guard only
  when it must recreate one;
- an early Settings menu request waits for the same registry promise, then recreates the window
  synchronously and sends the same `ui:openSettings` message plus one-shot renderer intent;
- update quit still fences every activation before loading or opening a window.

The narrow `runDesktopActionWhenCoreIpcReady` guard does not create a second readiness state.
It checks the exact registry slot, uses the memoized loader, preserves the updater fence, and
then calls the existing synchronous focus, reopen, or settings action. Load failures remain
best-effort and are reported through the existing main-process warning surface.

## Desktop, headless, and registration order

Normal desktop startup preserves this order:

1. construct and wire every Store, account, usage, automation, plugin, runtime, lifecycle, and
   window dependency;
2. record `services-initialized`, initialize main i18n/menu state, install activation listeners,
   and start terminal runtime startup services;
3. await the single core-registry loader;
4. begin the unchanged parallel `openMainWindow()` and `runtimeRpc.start()` calls;
5. inside synchronous `openMainWindow`, capture and guard the loaded register function before
   constructing `BrowserWindow`;
6. create the window and install the existing `did-finish-load` listener;
7. call `registerCoreHandlers` at its original point;
8. attach automation web contents/start, attached window services, rate limits, diagnostics,
   renderer loading, and renderer readiness in their original order.

The handler call receives the same live objects by identity: Store, runtime, stats,
Claude/Codex/OpenCode usage stores, Codex/Claude accounts, rate limits, renderer webContents ID,
automation service, launch preparation callbacks, agent-awake and crash-report services,
keybindings, AI Vault/relaunch/profile-auth lifecycle callbacks, plugin service, marketplace, and
installer.

`openMainWindow` remains non-async. Later window recreation reuses the stored function, while the
existing `registered` flag prevents duplicate channel installation. BrowserWindow creation,
renderer load/readiness, PTY/automation attachment, updater/relaunch behavior, and quit callbacks
are otherwise unchanged.

The ordinary headless serve branch never calls the loader or registry. It still registers
headless PTY runtime support, conditionally attaches the offscreen browser backend, syncs the
empty window graph, awaits `runtimeRpc.start()`, settles desktop activation, installs signals and
CLI support, starts automations, publishes readiness, and returns. A later supported
serve-to-desktop activation loads the same registry only when the activation gate actually asks
for a desktop window.

## Generated chunks and packaged-relative resolution

The emitted capability is
`out/main/chunks/core-ipc-registry-startup-capability-CxBsaHMF.js`
(680,906 raw / 139,680 gzip bytes). `out/main/index.js` loads it through
`./chunks/core-ipc-registry-startup-capability-CxBsaHMF.js`.

The entry specifier is relative, contains no parent traversal, and resolves beneath `out/main`.
An emitted-tree scan checked 78 JavaScript files and 295 static relative `require`/`import`
references. Every resolved dependency exists and remains under `out/main`; this includes all
relative dependencies reachable from the capability chunk.

## Budget

The prior `electron-main` raw budget was 7,273,516 bytes. Lowering it by the exact measured
675,993-byte reduction produces a new budget of 6,597,523 bytes and leaves exactly 48,236 bytes
(0.736%) of headroom over the 6,549,287-byte entry. No preload or renderer budget changed.

## Validation

- Fresh production A and B `pnpm run build:electron-vite`: passed. The baseline transformed
  1,972 main modules and the retained build transformed 1,973; both transformed 17 preload
  modules and 9,181 renderer modules.
- Focused capability and source-boundary tests: passed, 2 files with 7 tests.
- Representative core handler, account/profile, plugin/marketplace/ephemeral-VM, AI Vault,
  browser, rate-limit, automation, runtime RPC, window creation/focus/recreation, macOS
  activation, tray, desktop/serve activation and readiness, runtime-startup failure, renderer
  shutdown, auth preservation, relaunch, and updater suite: passed, 31 files with 404 tests.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint`: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 6,549,287 actual versus 6,597,523 budgeted
  main bytes.
- `git diff --check`: passed with no whitespace errors.

## Warnings and residual limitation

Both production builds contained the same two existing CSS optimizer warnings and no new warning:

1. `::highlight(markdown-preview-search-match)` is reported as an unrecognized pseudo-element.
2. `::highlight(markdown-preview-search-active-match)` is reported as an unrecognized
   pseudo-element.

The production build, emitted-tree dependency scan, and relative-path checks prove the emitted
packaged-relative layout on this macOS worktree. This tranche did not run a packaged ASAR launch
smoke on macOS, Linux, or Windows. Cross-platform packaged launch verification remains the
residual limitation.
