# Phase 1 emulator startup boundary

- **Date:** 2026-07-29
- **Scope:** Move `EmulatorBridge` construction out of the eager Electron main graph without
  changing runtime contracts or initialization timing.

## Result

`src/main/index.ts` now awaits one dynamic import of
`./startup/emulator-startup-capability`, then attaches the returned bridge to
`OrcaRuntimeService` before the existing `services-initialized` milestone. Desktop and serve
IPC/RPC therefore continue to observe a fully attached bridge, with the same managed-helper
ownership and shutdown behavior.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  8,141,780 | 8,065,000 |    -76,780 |   1,701,308 |  1,682,165 |     -19,143 |

The other static startup graphs were unchanged:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

## Boundary evidence

The generated implementation chunk is
`out/main/chunks/emulator-startup-capability-B423ORHj.js` (77,929 raw bytes). The generated
main entry loads it with the packaged-relative specifier
`./chunks/emulator-startup-capability-B423ORHj.js`; the specifier is not absolute, contains no
parent traversal, and resolves beside `out/main/index.js` inside the packaged ASAR.

`src/main/startup/emulator-startup-capability.ts` is the only production value importer of
`emulator-bridge`. Existing consumers remain type-only:

- `src/main/runtime/orca-runtime.ts`
- `src/main/runtime/orca-runtime-emulator.ts`
- `src/main/emulator/emulator-availability.ts`
- `src/main/emulator/emulator-default-attach-device.ts`

The source contract rejects a static `emulator-bridge` import or direct construction in
`src/main/index.ts`, and rejects attachment after `services-initialized`. The focused factory test
also confirms that the attached bridge retains both iOS and Android backends.

## Budget

The `electron-main` raw budget is 8,113,236 bytes. This lowers the prior budget by the measured
76,780-byte improvement and leaves 48,236 bytes (0.598%) of headroom over the 8,065,000-byte
entry. No other budget changed.

## Validation

- Focused emulator/runtime/startup suite: passed, 8 files and 76 tests:
  `emulator-startup-capability`, `emulator-startup-boundary`, `desktop-startup-ordering`,
  `serve-desktop-activation-wiring`, `startup-diagnostics`, `runtime-rpc-startup-failure`,
  `emulator-bridge`, and `emulator-availability`.
- `pnpm run build:electron-vite`: passed with 1,955 main modules transformed, the relative
  capability chunk emitted, and the two existing warnings below.
- `pnpm run check:electron-bundle-budgets`: passed at 8,065,000 actual versus 8,113,236
  budgeted main bytes.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint` on `src/main/index.ts`, the capability factory, and its two tests:
  passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check` on those four files plus
  `config/electron-bundle-budgets.json`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `git diff --check`: passed with no whitespace errors.
- Targeted `pnpm exec oxfmt --check` on this report: passed.

## Existing warnings and limitation

The production build retained two existing CSS optimizer warnings and introduced no new warning:

1. `::highlight(markdown-preview-search-match)` is reported as an unrecognized pseudo-element.
2. `::highlight(markdown-preview-search-active-match)` is reported as an unrecognized
   pseudo-element.

The build proves packaged-relative chunk generation on this macOS worktree, but this tranche did
not run a packaged ASAR launch smoke test on macOS, Linux, or Windows.
