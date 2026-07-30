# Phase 1 CodexUsageStore startup boundary

- **Date:** 2026-07-29
- **Scope:** Move only `CodexUsageStore` construction out of the eager Electron main graph while
  preserving synchronous Codex usage-path capture, store identity, scanning, snapshots, IPC, and
  automation attribution.

## Result

`src/main/index.ts` now type-imports `CodexUsageStore`, eagerly imports only
`initCodexUsagePath` from the concrete `src/main/codex-usage/codex-usage-file-path.ts` module,
and awaits the dynamic `./startup/codex-usage-store-startup-capability` import at the original
construction site. The factory calls only `new CodexUsageStore(store)` with the original `Store`
object and returns that same live instance.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  7,852,413 | 7,794,590 |    -57,823 |   1,641,212 |  1,630,202 |     -11,010 |

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
value importer and sole direct constructor of `src/main/codex-usage/store.ts`. Every other
production consumer was type-only:

- `src/main/ipc/codex-usage.ts`
- `src/main/ipc/register-core-handlers.ts`
- `src/main/automations/service.ts`
- `src/main/automations/run-usage-collection.ts`

After the edit, `src/main/startup/codex-usage-store-startup-capability.ts` is the sole production
value importer and direct constructor. `src/main/index.ts` and every IPC and automation consumer
remain type-only. `store.ts` retains a compatibility re-export of `initCodexUsagePath`.

Only path state, synchronous initialization, and the cached fallback getter moved out of
`store.ts`. The class implementation changed only its two path getter call sites. Schema version
5 invalidation with enabled-state carry-forward, model pricing, reasoning-tier normalization,
atomic temporary-file persistence, scan gating, five-minute throttling and attribution window,
incremental scans and ownership deduplication, range/scope queries, snapshot construction, and
public APIs are unchanged.

## Preserved path timing, ordering, and identity

`initCodexUsagePath()` remains a direct synchronous call in the existing single-instance-lock
block:

1. It retains its exact sequence after `initDataPath()`, session-parse-cache and profile-path
   initialization, `initStatsPath()`, and `initClaudeUsagePath()`.
2. It remains before `initOpenCodeUsagePath()`, `app.whenReady()`, and
   `app.setName(devInstanceIdentity.appName)`.
3. It still resolves exactly `<captured userData>/orca-codex-usage.json` with `path.join`.
4. The fallback getter still captures once on first access if startup initialization was skipped.

The cross-platform path-state test changes the mocked late Electron user-data path after
initialization and proves reads stay on the early captured path. It also proves fallback capture
is cached. Both expectations use `path.join`, including on Windows.

The awaited capability import and factory replace `new CodexUsageStore(store)` at its exact
former services point: after Claude usage, before OpenCode usage, before every consumer, and
before the `services-initialized` milestone. Construction therefore still finishes before
AutomationService creation and before any main-window IPC registration or readiness exposure.

The same singleton remains protected by the existing `openMainWindow` initialization guard,
passed unchanged to `registerCoreHandlers`, and forwarded unchanged to
`registerCodexUsageHandlers`. The scan-state, enablement, refresh, snapshot, summary, daily,
breakdown, and recent-session IPC channels and arguments did not change.

The same singleton is also injected into AutomationService immediately after `claudeUsage` in
the unchanged options object. Local completed Codex runs still call `getAutomationRunUsage` with
the run workspace, terminal session, start time, and collection time. The untouched run-usage
collector still returns `remote_usage_unavailable` for SSH automation before consulting local
usage logs, and it retains the existing unsupported-provider and unavailable-store mappings.

The store still receives the original persistence `Store` object by identity and still uses
`loadKnownUsageWorktreesByRepo(this.store, repos)`. The usage metadata, Codex home discovery, and
scanner modules are untouched, preserving folder-workspace filesystem IDs, git-worktree
metadata, managed/system/per-account Codex homes, local/WSL/SSH/remote eligibility behavior,
canonical path ordering, alias handling, incremental file reuse, and fork-copy deduplication.
The cached dashboard snapshot remains synchronous and passed its existing 1,000 ms coarse
performance guard with 12,000 daily aggregates and 8,000 sessions.

## Generated chunk and packaged-relative resolution

The emitted capability chunk is
`out/main/chunks/codex-usage-store-startup-capability-De9vPWQe.js` (56,947 raw / 11,456 gzip
bytes). `out/main/index.js` loads it through
`./chunks/codex-usage-store-startup-capability-De9vPWQe.js`.

The entry specifier is relative, contains no parent traversal, and resolves under `out/main`.
Every relative dependency in the capability chunk was resolved and confirmed to exist under
`out/main`:

- `./chunk-BTjIgr6M.js`
- `./worktree-id-B3lEXLSJ.js`
- `./codex-home-paths-_LPLI0JN.js`
- `./wsl-P2tsPUbL.js`
- `../index.js`
- `./usage-worktree-metadata-CK-sO7fO.js`

These paths match packaged-relative module resolution.

## Budget

The prior `electron-main` raw budget was 7,900,649 bytes. Lowering it by the exact measured
57,823-byte improvement produces a new budget of 7,842,826 bytes and leaves 48,236 bytes
(0.619%) of headroom over the 7,794,590-byte entry. No preload or renderer budget changed.

## Validation

- Fresh production A and B `pnpm run build:electron-vite`: passed. The baseline transformed
  1,966 main modules; the post-edit build transformed 1,968. Both transformed 17 preload modules
  and 9,181 renderer modules.
- Focused Codex path, store, schema, pricing, reasoning normalization, automation attribution,
  snapshot benchmark, scanner paths and aggregation, large-directory discovery, usage-worktree
  metadata and canonicalization, Codex/core IPC identity, AutomationService and its startup
  boundary, desktop/serve startup, and runtime startup-failure suite: passed, 18 files and 110
  tests.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint` on the touched source and tests: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check` on the touched source, tests, and budget: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 7,794,590 actual versus 7,842,826 budgeted
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
