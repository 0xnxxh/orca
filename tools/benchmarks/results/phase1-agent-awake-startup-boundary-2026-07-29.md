# Phase 1 agent awake startup boundary

- **Date:** 2026-07-29
- **Scope:** Move `AgentAwakeService` startup construction and runtime-empty status
  initialization out of the eager Electron main graph without changing readiness or service
  lifetime.

## Result

`src/main/index.ts` now type-imports `AgentAwakeService`, awaits the dynamic
`./startup/agent-awake-startup-capability` import, and awaits
`createAgentAwakeStartupCapability()` at the original construction site. The factory returns the
live service after `setStatuses([])`, before the persisted enabled setting, hook subscriptions,
IPC registration, and the existing `services-initialized` milestone. Existing settings updates,
status changes, resume recovery, platform assertion failure handling, and teardown continue to
use the same global instance.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  7,973,894 | 7,959,821 |    -14,073 |   1,664,053 |  1,661,668 |      -2,385 |

The other static startup graphs were byte-for-byte unchanged:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

## Importer and boundary evidence

Before the edit, a production-source search found `src/main/index.ts` as the sole value importer
of `agent-awake-service`. The only other production importers were type-only:

- `src/main/ipc/register-core-handlers.ts`
- `src/main/ipc/settings.ts`

After the edit, `src/main/startup/agent-awake-startup-capability.ts` is the sole production value
importer. `src/main/index.ts` and both IPC consumers are type-only.

The emitted implementation chunk is
`out/main/chunks/agent-awake-startup-capability-TObNGnOu.js` (14,527 raw / 2,844 gzip bytes).
`out/main/index.js` loads it with
`require("./chunks/agent-awake-startup-capability-TObNGnOu.js")`; the specifier is
packaged-relative, contains no parent traversal, and resolves beside the main entry in the
packaged ASAR.

The source boundary test rejects a value import or direct construction in `src/main/index.ts`,
requires exactly one awaited capability import and factory call, and requires initialization
before settings, hook subscriptions, and `services-initialized`. The factory test confirms that
the returned live `AgentAwakeService` receives the initial empty status set.

## Budget

The `electron-main` raw budget is 8,008,057 bytes. This lowers the prior 8,022,130-byte budget by
the measured 14,073-byte improvement and leaves 48,236 bytes (0.606%) of headroom over the
7,959,821-byte entry. No preload or renderer budget changed.

## Validation

- Fresh production baseline and post-edit `pnpm run build:electron-vite`: passed. The post-edit
  build transformed 1,957 main modules and emitted the packaged-relative capability chunk.
- Focused keep-awake, platform, IPC, and startup suite: passed, 13 files and 120 tests. Coverage
  included the new capability and boundary tests, `AgentAwakeService`, macOS and Linux
  assertions, Windows-safe service behavior, system resume, settings and core IPC, desktop and
  serve ordering, startup diagnostics, and runtime RPC startup failure.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint` on `src/main/index.ts`, the capability, and its two tests: passed
  with no diagnostics.
- Targeted `pnpm exec oxfmt --check` on those files and the budget: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 7,959,821 actual versus 8,008,057 budgeted
  main bytes.
- `git diff --check`: passed with no whitespace errors.

## Warnings and residual limitation

Both builds contained the same two existing CSS optimizer warnings and no new warning:

1. `::highlight(markdown-preview-search-match)` is reported as an unrecognized pseudo-element.
2. `::highlight(markdown-preview-search-active-match)` is reported as an unrecognized
   pseudo-element.

The service contract still avoids any Windows global power-plan mutation; macOS and Linux
assertion behavior remains covered by focused tests. The build proves packaged-relative chunk
generation on this macOS worktree, but this tranche did not run packaged ASAR launch smokes on
macOS, Linux, or Windows.
