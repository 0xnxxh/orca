# Phase 1 keybinding service startup boundary

- **Date:** 2026-07-29
- **Scope:** Move only `KeybindingService` startup construction out of the eager Electron main
  graph while preserving its synchronous migration and one-shot cohort seed at the existing
  startup point.

## Result

`src/main/index.ts` now type-imports `KeybindingService`, awaits the dynamic
`./startup/keybinding-service-startup-capability` import, and awaits
`createKeybindingServiceStartupCapability(...)` at the original construction site. The factory
passes the original options object directly to the constructor and returns that same live service
after the constructor has synchronously completed.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  7,946,692 | 7,934,074 |    -12,618 |   1,659,337 |  1,656,699 |      -2,638 |

The other static startup graphs were byte-for-byte unchanged:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

## Importer evidence

Before the edit, a production-source search excluding tests found `src/main/index.ts` as the
sole value importer and sole direct constructor of
`src/main/keybindings/keybinding-service.ts`. All production IPC consumers were already
type-only:

- `src/main/ipc/keybindings.ts`
- `src/main/ipc/dashboard-popout.ts`
- `src/main/ipc/register-core-handlers.ts`

After the edit, `src/main/startup/keybinding-service-startup-capability.ts` is the sole
production value importer and direct constructor. `src/main/index.ts` and all three IPC
consumers remain type-only.

The focused source boundary test rejects an eager service value import or direct construction in
`src/main/index.ts`, requires exactly one awaited capability import and factory call, and fixes
construction before `browserManager.setSettingsResolver`, plugin service construction, and
`services-initialized`.

## Preserved behavior and ordering

The dynamic import and factory remain at the exact former constructor site. The constructor
therefore still completes before the browser settings resolver is installed and before any
observable readiness:

- `homePath` still comes from `app.getPath('home')`, so the config path remains
  `<home>/.orca/keybindings.json`.
- No `platform` override is introduced, so `KeybindingService` still selects
  `process.platform`.
- Legacy settings migration still runs synchronously before cohort seeding through the original
  `getLegacyOverrides` callback.
- The one-shot tab-switch seed still reads `tabSwitchKeybindingSeed === 'pending'` and marks
  `done` only through the original `store.updateSettings` callback after a successful seed.
- Constructor seed failures remain caught by the service and leave the cohort pending, so the
  next launch retries.
- The returned instance remains the global live service used by browser-manager settings,
  plugin keybindings, window and menu shortcut resolution, dashboard and core IPC handlers, both
  headless serve and desktop startup paths, and the `openMainWindow` initialized guard.
- No readiness milestone, initializing state, serve return, desktop window-open ordering, or
  later consumer was moved or changed.

`keybinding-file.ts` and its existing max-lines suppression were not modified.

## Generated chunk and packaged-relative resolution

The emitted capability chunk is
`out/main/chunks/keybinding-service-startup-capability-B-aIhhXd.js` (12,590 raw / 3,123 gzip
bytes). `out/main/index.js` loads it with
`require("./chunks/keybinding-service-startup-capability-B-aIhhXd.js")`; the specifier is
relative, contains no parent traversal, resolves to an emitted file under `out/main/chunks`, and
matches packaged-ASAR-relative lookup.

The capability chunk's existing shared-keybinding dependency is also emitted with the relative
specifier `./keybindings-DPCRTERw.js`. That shared chunk remains statically reachable from other
main-process protocol consumers, while the service constructor and keybinding-file implementation
are absent from the eager main entry.

## Budget

The `electron-main` raw budget is 7,982,310 bytes. This lowers the prior 7,994,928-byte budget by
the exact measured 12,618-byte improvement and leaves 48,236 bytes (0.608%) of headroom over the
7,934,074-byte entry. No preload or renderer budget changed.

## Validation

- Fresh production A and B `pnpm run build:electron-vite`: passed. The baseline transformed
  1,958 main modules; the post-edit build transformed 1,959 and emitted the deferred capability
  chunk.
- Focused behavior and startup suite: passed, 16 files and 219 tests with one existing skip.
  Coverage included the new factory and boundary tests, keybinding service and file migration,
  one-shot seed and retry behavior, keybinding IPC, dashboard and core handlers, browser guest
  shortcuts and settings, plugin keybindings, application menu shortcuts, dashboard windows,
  desktop/serve startup ordering, startup diagnostics, and runtime RPC startup failure.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint` on `src/main/index.ts`, the capability, and its two tests: passed
  with no diagnostics.
- Targeted `pnpm exec oxfmt --check` on those files and the budget: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 7,934,074 actual versus 7,982,310
  budgeted main bytes.
- `git diff --check`: passed with no whitespace errors.

## Warnings and residual limitation

Both production builds contained the same two existing CSS optimizer warnings and no new
warning:

1. `::highlight(markdown-preview-search-match)` is reported as an unrecognized pseudo-element.
2. `::highlight(markdown-preview-search-active-match)` is reported as an unrecognized
   pseudo-element.

The build proves packaged-relative chunk generation on this macOS worktree, but this tranche did
not run a packaged ASAR launch smoke on macOS, Linux, or Windows. Cross-platform packaged launch
verification remains the residual limitation.
