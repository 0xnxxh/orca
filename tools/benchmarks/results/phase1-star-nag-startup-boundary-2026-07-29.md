# Phase 1 star nag startup boundary

- **Date:** 2026-07-29
- **Scope:** Move only `StarNagService` construction, `start()`, and IPC registration out of
  the eager Electron main graph while preserving startup order and the committed quit lifetime.

## Result

`src/main/index.ts` now type-imports `StarNagService`, awaits the dynamic
`./startup/star-nag-startup-capability` import, and awaits
`createStarNagStartupCapability(store, stats)` at the original construction site. The factory
constructs one service, calls `start()`, registers its IPC handlers, and returns that same live
instance for the existing `will-quit` `stop()` call.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  7,959,821 | 7,946,692 |    -13,129 |   1,661,668 |  1,659,337 |      -2,331 |

The other static startup graphs were byte-for-byte unchanged:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

## Importer and lifecycle evidence

Before the edit, a production-source search excluding tests found `src/main/index.ts` as the
sole value importer of `./star-nag/service`. The only production lifecycle references were the
adjacent construction, `start()`, and `registerIpcHandlers()` calls at that site and the single
`starNag?.stop()` inside the committed `app.on('will-quit', ...)` handler. No other production
consumer constructed, started, registered, or stopped the service.

After the edit, `src/main/startup/star-nag-startup-capability.ts` is the sole production value
importer and `src/main/index.ts` is type-only. The source boundary test rejects eager value
imports and direct construction, requires exactly one awaited capability import and factory
call, fixes the factory before agent-browser attachment, emulator attachment, and
`services-initialized`, and preserves the single committed `will-quit` stop. The factory
lifecycle test confirms constructor arguments, `start()` before IPC registration, and return of
the constructed live instance.

The import remains at the exact prior lifecycle point after plugin startup wiring and before
agent-browser and emulator attachment. The awaited boundary therefore preserves startup
readiness and IPC availability rather than moving StarNag initialization later. `start()` still
installs the `StatsCollector` listener at that point, and the service implementation was not
changed, preserving prompt state, GitHub direct-star and web fallback behavior, telemetry,
desktop versus serve behavior, and teardown.

## Generated chunk and packaged-relative resolution

The emitted implementation chunk is
`out/main/chunks/star-nag-startup-capability-Bqy8weqR.js` (13,732 raw / 3,207 gzip bytes).
`out/main/index.js` loads it with
`require("./chunks/star-nag-startup-capability-Bqy8weqR.js")`. The specifier is relative to the
main entry, contains no parent traversal, and resolves to the emitted file beside the entry's
`chunks` directory, matching packaged ASAR-relative lookup.

## Budget

The `electron-main` raw budget is 7,994,928 bytes. This lowers the prior 8,008,057-byte budget by
the exact measured 13,129-byte improvement and leaves 48,236 bytes (0.607% over the measured
entry) of headroom. No preload or renderer budget changed.

## Validation

- Fresh production A and B `pnpm run build:electron-vite`: passed. The baseline transformed
  1,957 main modules; the post-edit build transformed 1,958 and emitted the deferred chunk.
- Focused StarNag and startup ordering suite: passed, 7 files and 54 tests. It included the
  existing `StarNagService` tests, both new boundary tests, adjacent agent-browser and emulator
  boundaries, desktop startup ordering, and serve/desktop activation wiring.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint` on `src/main/index.ts`, the capability, and its two tests: passed
  with no diagnostics.
- Targeted `pnpm exec oxfmt --check` on those files and the budget: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 7,946,692 actual versus 7,994,928 budgeted
  main bytes.
- `git diff --check`: passed with no whitespace errors.

## Warnings and residual limitations

Both production builds contained the same two existing CSS optimizer warnings for
`::highlight(markdown-preview-search-match)` and
`::highlight(markdown-preview-search-active-match)`; no new warning appeared.

This boundary reduces the eager static entry but does not defer StarNag until a later user
action: the awaited chunk still loads during startup at the original service ordering point.
Generated output proves packaged-relative chunk resolution in this worktree, but this tranche
did not run a packaged ASAR launch smoke on macOS, Linux, or Windows. It also did not measure
filesystem or ASAR decompression latency on first chunk load; raw and gzip bundle sizes are the
retention gate.
