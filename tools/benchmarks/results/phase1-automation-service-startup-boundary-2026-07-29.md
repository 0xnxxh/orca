# Phase 1 automation service startup boundary

- **Date:** 2026-07-29
- **Scope:** Move only `AutomationService` startup construction out of the eager Electron main
  graph while preserving the complete desktop and headless automation lifecycle at the existing
  startup point.

## Result

`src/main/index.ts` now type-imports `AutomationService`, awaits the dynamic
`./startup/automation-service-startup-capability` import, and awaits
`createAutomationServiceStartupCapability(store, options)` at the original construction site.
The factory calls only `new AutomationService(store, options)` and returns that same live
instance; `src/main/automations/service.ts` was not changed.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  7,934,074 | 7,909,325 |    -24,749 |   1,656,699 |  1,652,751 |      -3,948 |

The other static startup graphs were byte-for-byte unchanged. A full SHA-256 manifest comparison
of every file under `out/preload` and `out/renderer` also matched:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

## Importer evidence

Before the edit, a production-source search excluding tests found `src/main/index.ts` as the sole
value importer and sole direct constructor of `src/main/automations/service.ts`. All other
production runtime and IPC consumers were already type-only:

- `src/main/runtime/orca-runtime.ts`
- `src/main/ipc/register-core-handlers.ts`
- `src/main/ipc/automations.ts`

After the edit, `src/main/startup/automation-service-startup-capability.ts` is the sole production
value importer and direct constructor. `src/main/index.ts` and all three runtime/IPC consumers
remain type-only.

The focused boundary test rejects an eager service value import or direct construction in
`src/main/index.ts`, requires exactly one awaited capability import and factory call, and fixes
construction and `runtimeService.setAutomationService` before `services-initialized`. The factory
test verifies that the original store and options object reach the constructor by identity and
that the constructed live instance is returned.

## Preserved behavior and ordering

The dynamic import and factory call replace the constructor expression at its exact former
location. The complete options object and `headlessDispatcher` closure remain in `src/main/index.ts`
without being moved, simplified, or redesigned:

- `claudeUsage` and `codexUsage` are still injected.
- `allowRemoteHostScheduling` remains `isServeMode`.
- `headlessDispatcher` remains present only for serve mode.
- `new_per_run` still calls `runtimeService.createManagedWorktree` with
  `buildHeadlessAutomationWorktreeCreateArgs`, routes through `target.repo`, uses the returned
  startup terminal and worktree metadata, and preserves the missing-terminal error.
- Existing-workspace dispatch still requires `automation.workspaceId`, calls
  `runtimeService.launchAgentTerminal`, and obtains the display name through
  `showManagedWorktree`.
- Completion still waits for `tui-idle`, reads the terminal with the 2,000-line limit, appends
  the joined tail to `createHeadlessAutomationOutputSnapshotBuffer`, maps a satisfied wait to
  `completed`, and maps blocked or incomplete waits to `dispatch_failed` with the same error
  text.

The awaited factory completes before `runtimeService.setAutomationService(automations)` and
before `services-initialized`, so readiness and initializing contracts are unchanged. The same
returned global instance keeps every later lifecycle:

- Desktop startup registers core handlers, then calls `setWebContents(window.webContents)`, then
  `start()`.
- Closing a desktop window still calls `setWebContents(null)`.
- `automations:rendererReady` still calls `setRendererReady()` on the service supplied to the
  unchanged IPC registration path.
- Headless serve still starts the service after runtime RPC startup and before
  `printServeReady(...)` and the serve return.
- The single `automations?.stop()` remains in the committed `will-quit` handler.

No readiness milestone, initialization state, core-handler attachment, runtime wiring, desktop
window ordering, serve-ready publication, or quit commitment moved.

## Generated chunk and packaged-relative resolution

The emitted capability chunk is
`out/main/chunks/automation-service-startup-capability-E2N0odgG.js` (18,172 raw / 4,647 gzip
bytes). `out/main/index.js` loads it with
`require("./chunks/automation-service-startup-capability-E2N0odgG.js")`.

The entry specifier is relative, contains no parent traversal, and resolves to the emitted file
under `out/main/chunks`. Every relative `require` in the capability chunk was resolved and
confirmed to exist under `out/main`; this includes its emitted shared chunks and the expected
`../index.js` reference back to the already-loaded main entry. The resulting paths match
packaged-ASAR-relative lookup.

## Budget

The `electron-main` raw budget is 7,957,561 bytes. This lowers the prior 7,982,310-byte budget by
the exact measured 24,749-byte improvement and leaves 48,236 bytes (0.610%) of headroom over the
7,909,325-byte entry. No preload or renderer budget changed.

## Validation

- Fresh production A and B `pnpm run build:electron-vite`: passed. The baseline transformed
  1,959 main modules; the post-edit build transformed 1,960 and emitted the deferred capability
  chunk.
- Focused automation, IPC, runtime, and startup suite: passed, 15 files and 89 tests. Coverage
  included the service and precheck behavior, precheck runner, target resolution, headless
  workspace arguments and dispatcher source boundary, core-handler registration, runtime
  automation wiring and RPC methods, the new factory and source boundary, desktop/serve startup
  ordering and activation, and runtime RPC startup failure.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint` on `src/main/index.ts`, the capability, and its two tests: passed
  with no diagnostics.
- Targeted `pnpm exec oxfmt --check` on those files and the budget: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 7,909,325 actual versus 7,957,561 budgeted
  main bytes.
- `git diff --check`: passed with no whitespace errors.

## Warnings and residual limitation

Both production builds contained the same two existing CSS optimizer warnings and no new
warning:

1. `::highlight(markdown-preview-search-match)` is reported as an unrecognized pseudo-element.
2. `::highlight(markdown-preview-search-active-match)` is reported as an unrecognized
   pseudo-element.

The build and explicit resolution check prove packaged-relative emitted paths on this macOS
worktree, but this tranche did not run a packaged ASAR launch smoke on macOS, Linux, or Windows.
Cross-platform packaged launch verification remains the residual limitation.
