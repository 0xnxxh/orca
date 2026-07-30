# Phase 1 ClaudeUsageStore startup boundary

- **Date:** 2026-07-29
- **Scope:** Move only `ClaudeUsageStore` construction out of the eager Electron main graph while
  preserving synchronous Claude usage-path capture, store identity, scanning, IPC, and automation
  attribution.

## Result

`src/main/index.ts` now type-imports `ClaudeUsageStore`, eagerly imports only
`initClaudeUsagePath` from the concrete
`src/main/claude-usage/claude-usage-file-path.ts` module, and awaits the dynamic
`./startup/claude-usage-store-startup-capability` import at the original construction site. The
factory calls only `new ClaudeUsageStore(store)` with the original `Store` object and returns that
same live instance.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  7,891,025 | 7,852,413 |    -38,612 |   1,649,850 |  1,641,212 |      -8,638 |

The preload and all renderer static graphs were byte-for-byte unchanged:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

A SHA-256 manifest comparison also matched all 786 emitted files under `out/preload` and
`out/renderer`.

## Importer and constructor evidence

Before the edit, a production-source search excluding tests found `src/main/index.ts` as the sole
value importer and sole direct constructor of `src/main/claude-usage/store.ts`. Every other
production consumer was type-only:

- `src/main/ipc/claude-usage.ts`
- `src/main/ipc/register-core-handlers.ts`
- `src/main/automations/service.ts`
- `src/main/automations/run-usage-collection.ts`

After the edit, `src/main/startup/claude-usage-store-startup-capability.ts` is the sole production
value importer and direct constructor. `src/main/index.ts` and every IPC and automation consumer
remain type-only. `store.ts` retains a compatibility re-export of `initClaudeUsagePath`.

Only path state, synchronous initialization, and the cached fallback getter moved out of
`store.ts`. The class implementation changed only its two path getter call sites. Schema version
5, model pricing and aliases, normalization, atomic temporary-file persistence, scan gating,
five-minute throttling and automation attribution window, cross-file ownership deduplication,
range/scope queries, and public APIs are unchanged.

## Preserved path timing, ordering, and identity

`initClaudeUsagePath()` remains a direct synchronous call in the existing single-instance-lock
block:

1. It retains its exact sequence after `initDataPath()`, session-parse-cache and profile-path
   initialization, and `initStatsPath()`, before the Codex and OpenCode usage paths.
2. It still captures `app.getPath('userData')` before `app.whenReady()` and
   `app.setName(devInstanceIdentity.appName)`.
3. It still resolves exactly `<captured userData>/orca-claude-usage.json` with `path.join`.
4. The fallback getter still captures once on first access if startup initialization was skipped.

The cross-platform path-state test changes the mocked late Electron user-data path after
initialization and proves reads stay on the early captured path. It also proves fallback capture
is cached. Both expectations use `path.join`, including on Windows.

The awaited capability import and factory replace `new ClaudeUsageStore(store)` at its exact
former services point: after StatsCollector, before Codex and OpenCode usage stores, before every
consumer, and before the `services-initialized` milestone. Construction therefore still
finishes before AutomationService creation and before any main-window IPC registration or
readiness exposure.

The same singleton remains protected by the existing `openMainWindow` initialization guard,
passed unchanged to `registerCoreHandlers`, and forwarded unchanged to
`registerClaudeUsageHandlers`. The scan-state, enablement, refresh, snapshot, summary, daily,
breakdown, and recent-session IPC channels and arguments did not change.

The same singleton is also injected into AutomationService in the same options position before
`codexUsage`. Local completed Claude runs still call `getAutomationRunUsage` with the run
workspace, terminal session, start time, and collection time. The untouched run-usage collector
still returns `remote_usage_unavailable` for SSH automation before consulting local usage logs,
and it retains the existing unsupported-provider and unavailable-store mappings.

The store still receives the original persistence `Store` object by identity and still uses
`loadKnownUsageWorktreesByRepo(this.store, repos)`. The usage metadata and scanner modules are
untouched, preserving folder-workspace filesystem IDs, git-worktree metadata, local transcript
discovery and attribution, WSL/SSH/remote eligibility behavior, canonical path ordering,
incremental file reuse, and fork-copy deduplication.

## Generated chunk and packaged-relative resolution

The emitted capability chunk is
`out/main/chunks/claude-usage-store-startup-capability-Dd7yRYUX.js` (39,174 raw / 8,836 gzip
bytes). `out/main/index.js` loads it through
`./chunks/claude-usage-store-startup-capability-Dd7yRYUX.js`.

The entry specifier is relative, contains no parent traversal, and resolves under `out/main`.
Every relative dependency in the capability chunk was resolved and confirmed to exist under
`out/main`:

- `./chunk-BTjIgr6M.js`
- `./worktree-id-B3lEXLSJ.js`
- `../index.js`

These paths match packaged-relative module resolution.

## Budget

The prior `electron-main` raw budget was 7,939,261 bytes. Lowering it by the exact measured
38,612-byte improvement produces a new budget of 7,900,649 bytes and leaves 48,236 bytes
(0.614%) of headroom over the 7,852,413-byte entry. No preload or renderer budget changed.

## Validation

- Fresh production A and B `pnpm run build:electron-vite`: passed. The baseline transformed
  1,964 main modules; the post-edit build transformed 1,966. Both transformed 17 preload modules
  and 9,181 renderer modules.
- Focused Claude path, store, pricing, automation attribution, scanner, large-directory,
  incremental-scan, worktree metadata and canonicalization, Claude/core IPC identity,
  AutomationService and its startup boundary, desktop/serve startup, and runtime startup-failure
  suite: passed, 17 files and 96 tests.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint` on the touched source and tests: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check` on the touched source, tests, and budget: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 7,852,413 actual versus 7,900,649 budgeted
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
