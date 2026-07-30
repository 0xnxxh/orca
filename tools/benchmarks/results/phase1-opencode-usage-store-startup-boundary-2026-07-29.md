# Phase 1 OpenCodeUsageStore startup boundary

- **Date:** 2026-07-29
- **Scope:** Move only `OpenCodeUsageStore` construction out of the eager Electron main graph
  while preserving synchronous OpenCode usage-path capture, store identity, scan behavior, and
  every existing consumer.

## Result

`src/main/index.ts` now type-imports `OpenCodeUsageStore`, eagerly imports only
`initOpenCodeUsagePath` from the concrete
`src/main/opencode-usage/opencode-usage-file-path.ts` module, and awaits the dynamic
`./startup/opencode-usage-store-startup-capability` import at the original construction site. The
factory calls only `new OpenCodeUsageStore(store)` with the original `Store` object and returns
that same live instance.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  7,904,344 | 7,891,025 |    -13,319 |   1,651,679 |  1,649,850 |      -1,829 |

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
value importer and sole direct constructor of `src/main/opencode-usage/store.ts`.
`src/main/ipc/opencode-usage.ts` and `src/main/ipc/register-core-handlers.ts` were type-only
consumers.

After the edit,
`src/main/startup/opencode-usage-store-startup-capability.ts` is the sole production value
importer and direct constructor. `src/main/index.ts` and both IPC consumers are type-only.
`store.ts` retains a compatibility re-export of `initOpenCodeUsagePath`.

Only path state, synchronous initialization, and the cached fallback getter moved out of
`store.ts`. Persistence schema version 2, normalization, atomic writes, scan policy, query
semantics, and public APIs are unchanged.

## Preserved path timing, ordering, and behavior

`initOpenCodeUsagePath()` remains a direct synchronous call in the existing
single-instance-lock block:

1. It still runs immediately after `initDataPath()`.
2. It still captures `app.getPath('userData')` before `app.whenReady()` and
   `app.setName(devInstanceIdentity.appName)`.
3. It still resolves exactly `<captured userData>/orca-opencode-usage.json` with `path.join`.
4. The fallback getter still captures once on first access if startup initialization was skipped.

The cross-platform path-state test changes the mocked late Electron user-data path after
initialization and proves reads stay on the early captured path. It also proves fallback capture
is cached. Both expectations use `path.join`, including on Windows.

The awaited capability import and factory replace `new OpenCodeUsageStore(store)` at its exact
former services point: after the Claude and Codex usage stores, before rate limits and all
consumers, and before the `services-initialized` milestone. Construction therefore still
finishes before any main-window IPC registration or readiness exposure.

The same singleton remains protected by the existing `openMainWindow` initialization guard and
is passed unchanged to `registerCoreHandlers`, which passes it unchanged to
`registerOpenCodeUsageHandlers`. IPC channel names, argument contracts, and store method routing
did not change.

The store still receives the original persistence `Store` object by identity. Its existing
`loadKnownUsageWorktreesByRepo(this.store)` path continues to support folder workspaces and git
worktrees, while the untouched scanner retains local, WSL, SSH, and remote-host OpenCode usage
discovery, database ownership deduplication, scan enablement, refresh throttling, and persisted
state behavior. No Claude usage, Codex usage, account, rate-limit, renderer, or lifecycle
contract changed.

## Generated chunk and packaged-relative resolution

The emitted capability chunk is
`out/main/chunks/opencode-usage-store-startup-capability-DnggxFSX.js` (12,381 raw / 3,145 gzip
bytes). `out/main/index.js` loads it through
`./chunks/opencode-usage-store-startup-capability-DnggxFSX.js`.

The entry specifier is relative, contains no parent traversal, and resolves under `out/main`.
Every relative dependency in the capability chunk was resolved and confirmed to exist under
`out/main`:

- `./chunk-BTjIgr6M.js`
- `./worktree-id-B3lEXLSJ.js`
- `./wsl-BeNFUvEz.js`
- `./schema-helpers-BaufHnZv.js`
- `../index.js`

These paths match packaged-relative module resolution.

## Budget

The prior `electron-main` raw budget was 7,952,580 bytes. Lowering it by the exact measured
13,319-byte improvement produces a new budget of 7,939,261 bytes and leaves 48,236 bytes
(0.611%) of headroom over the 7,891,025-byte entry. No preload or renderer budget changed.

## Validation

- Fresh production A and B `pnpm run build:electron-vite`: passed. The baseline transformed
  1,962 main modules; the post-edit build transformed 1,964. Both transformed 17 preload modules
  and 9,181 renderer modules.
- Focused OpenCode store, scanner, Windows data-directory, usage-worktree metadata and
  canonicalization, core-handler, capability, source-boundary, desktop/serve startup, and runtime
  startup-failure suite: passed, 13 files and 74 tests.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint` on the touched source and tests: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check` on the touched source, tests, and budget: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 7,891,025 actual versus 7,939,261 budgeted
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
