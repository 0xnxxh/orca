# Phase 1 StatsCollector startup boundary

- **Date:** 2026-07-29
- **Scope:** Move only `StatsCollector` construction out of the eager Electron main graph while
  preserving synchronous stats-path capture before Electron app naming and every existing
  collector consumer and lifecycle.

## Result

`src/main/index.ts` now type-imports `StatsCollector`, eagerly imports only `initStatsPath` from
the concrete `src/main/stats/stats-file-path.ts` module, and awaits the dynamic
`./startup/stats-collector-startup-capability` import at the original construction site. The
factory calls only `new StatsCollector()` and returns that same live instance.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  7,909,325 | 7,904,344 |     -4,981 |   1,652,751 |  1,651,679 |      -1,072 |

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
value importer and sole direct constructor of `src/main/stats/collector.ts`. The remaining
production consumers were already type-only:

- `src/main/stats/agent-detector.ts`
- `src/main/runtime/orca-runtime.ts`
- `src/main/startup/star-nag-startup-capability.ts`
- `src/main/star-nag/service.ts`
- `src/main/star-nag/prompt-context.ts`
- `src/main/star-nag/web-handoff.ts`
- `src/main/star-nag/threshold-trigger.ts`
- `src/main/star-nag/console-events.ts`
- `src/main/ipc/register-core-handlers.ts`
- `src/main/ipc/github.ts`
- `src/main/ipc/hosted-review.ts`
- `src/main/ipc/stats.ts`

After the edit, `src/main/startup/stats-collector-startup-capability.ts` is the sole production
value importer and direct constructor. `src/main/index.ts` and all runtime, StarNag, and IPC
consumers remain type-only.

`collector.ts` still re-exports `initStatsPath` for source API compatibility. Only the path
state, initializer, and fallback getter moved into `stats-file-path.ts`; the collector behavior
and public class API were not redesigned.

## Preserved path timing and lifecycle

`initStatsPath()` remains a direct synchronous call in the existing single-instance-lock block:

1. It still runs after `configureDevUserDataPath()` and `initDataPath()`.
2. It still captures `app.getPath('userData')` before `app.whenReady()` and
   `app.setName(devInstanceIdentity.appName)`.
3. It still resolves exactly `<captured userData>/orca-stats.json`.
4. The fallback getter still captures once on first access if startup initialization was skipped.

The path-state test changes the mocked late Electron user-data path after initialization and
proves reads stay on the early captured path. It also proves the fallback path is cached after
its first lookup.

The awaited capability import and factory replace `new StatsCollector()` at its exact former
services point, after both cohort classifiers and before Claude, Codex, and OpenCode usage-store
construction. The factory therefore finishes before runtime construction, StarNag startup,
window IPC registration, and `services-initialized`.

The same returned global singleton remains wired to:

- `OrcaRuntimeService`, which retains it for `getStatsSummary`, GitHub review recording, and the
  same `AgentDetector`.
- `StarNagService` through the existing dynamically imported startup capability.
- Core handlers, which pass it unchanged to GitHub, hosted-review, and stats IPC registrations.
- The only `stats?.flush()` call, still inside the committed `will-quit` handler before
  `killAllPty()` so live agents are closed out before PTY teardown.

No stats IPC contract, runtime method, StarNag API, readiness milestone, initialization state,
consumer ordering, or quit commitment changed.

## Generated chunk and packaged-relative resolution

The emitted capability chunk is
`out/main/chunks/stats-collector-startup-capability-BY2-NC9e.js` (5,681 raw / 1,753 gzip bytes).
`out/main/index.js` loads it with
`require("./chunks/stats-collector-startup-capability-BY2-NC9e.js")`.

The entry specifier is relative, contains no parent traversal, and resolves to the emitted file
under `out/main/chunks`. Both relative dependencies in the capability chunk were resolved and
confirmed to exist under `out/main`: `./chunk-BTjIgr6M.js` and the expected `../index.js`
reference to the already-loaded main entry that owns the eager stats-path getter. These paths
match packaged-ASAR-relative lookup.

## Budget

The `electron-main` raw budget is 7,952,580 bytes. This lowers the prior 7,957,561-byte budget by
the exact measured 4,981-byte improvement and leaves 48,236 bytes (0.610%) of headroom over the
7,904,344-byte entry. No preload or renderer budget changed.

## Validation

- Fresh production A and B `pnpm run build:electron-vite`: passed. The baseline transformed
  1,960 main modules; the post-edit build transformed 1,962 and emitted the path and capability
  modules.
- Focused StatsCollector, StarNag, runtime, IPC, and startup suite: passed, 17 files and 208
  tests. Coverage included path capture and fallback state, async save and synchronous flush,
  agent detection and post-exit leak prevention, StarNag behavior and startup capability,
  runtime RPC wiring, core-handler identity wiring, GitHub and hosted-review stat recording,
  desktop/serve ordering and activation, and runtime RPC startup failure.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint` on `src/main/index.ts`, the collector, path module, capability, and
  focused tests: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check` on those files and the budget: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 7,904,344 actual versus 7,952,580 budgeted
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
