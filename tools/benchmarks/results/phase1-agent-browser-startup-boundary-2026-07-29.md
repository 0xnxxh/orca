# Phase 1 agent browser startup boundary

- **Date:** 2026-07-29
- **Scope:** Move `AgentBrowserBridge` construction out of the eager Electron main graph without
  changing browser ownership, runtime contracts, or initialization timing.

## Result

`src/main/index.ts` now awaits one dynamic import of
`./startup/agent-browser-startup-capability`, then attaches one bridge to
`OrcaRuntimeService` before the existing `services-initialized` milestone. The factory receives
the existing `browserManager` and preserves `onTabsChanged` forwarding to
`notifyMobileSessionTabsChanged`, so desktop, serve, local, remote, folder-workspace, and SSH
runtime paths continue to observe a fully attached bridge without an initializing state.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  8,065,000 | 7,973,894 |    -91,106 |   1,682,165 |  1,664,053 |     -18,112 |

The other static startup graphs were unchanged:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

## Boundary evidence

The generated implementation chunk is
`out/main/chunks/agent-browser-startup-capability-w5Hfh7H7.js` (92,012 raw / 18,880 gzip
bytes). The generated main entry loads it with
`require("./chunks/agent-browser-startup-capability-w5Hfh7H7.js")`; the specifier is relative,
contains no parent traversal, and resolves beside `out/main/index.js` inside the packaged ASAR.
The bridge class and its direct construction are present only in that chunk, not the eager main
entry.

`src/main/startup/agent-browser-startup-capability.ts` is the only production value importer of
`agent-browser-bridge`. Existing production consumers remain type-only:

- `src/main/runtime/orca-runtime.ts`
- `src/main/runtime/orca-runtime-browser.ts`
- `src/main/ipc/browser.ts`

The source contract rejects a static `agent-browser-bridge` import or direct construction in
`src/main/index.ts`, requires exactly one awaited capability import, and rejects attachment after
`services-initialized`. The focused factory test confirms one attached bridge and the unchanged
mobile session-tab callback.

## Budget

The `electron-main` raw budget is 8,022,130 bytes. This lowers the prior 8,113,236-byte budget by
the exact 91,106-byte improvement and leaves 48,236 bytes (0.605%) of headroom over the
7,973,894-byte entry. No other budget changed.

## Validation

- Focused browser/runtime/startup suite: passed, 12 files and 196 tests, including the bridge,
  browser IPC/RPC, browser session startup, desktop/serve ordering, runtime startup failure, and
  retained emulator boundary.
- `pnpm run build:electron-vite`: passed with 1,956 main modules transformed, both capability
  chunks emitted, and only the two existing warnings below.
- `pnpm run check:electron-bundle-budgets`: passed at 7,973,894 actual versus 8,022,130 budgeted
  main bytes.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint` on `src/main/index.ts`, the factory, and its two tests: passed with
  no diagnostics.
- Targeted `pnpm exec oxfmt --check` on those four files and the budget: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `git diff --check`: passed with no whitespace errors.

## Warning inventory and limitation

The production build retained two existing CSS optimizer warnings and introduced no new warning:

1. `::highlight(markdown-preview-search-match)` is reported as an unrecognized pseudo-element.
2. `::highlight(markdown-preview-search-active-match)` is reported as an unrecognized
   pseudo-element.

The build proves packaged-relative chunk generation on this macOS worktree, but this tranche did
not run a packaged ASAR launch smoke test on macOS, Linux, or Windows. Those cross-platform
packaged smokes remain the residual verification risk for dynamic chunk loading.
