# Phase 1 pinned-tab close-dialog lazy boundary

Date: 2026-07-30

Outcome: retained. A fresh production A/B reduced the main-window static renderer
closure by 2,481 raw bytes without increasing popout/web raw size, changing any
renderer JS/CSS count, or changing any Electron main/preload file.

## Production audit and retained boundary

Before editing, the only production component importer was `App.tsx`, which mounted
`PinnedTabCloseDialog` after `SkillFreshnessNudge` and immediately before the
last-rendered custom `WindowControls`. The retained host occupies that exact location.

The complete state and close-path audit covered:

- `store/slices/pinned-tab-close-confirm.ts`: owns the durable
  `pinnedTabCloseConfirm` request, queued requests, 350 ms inter-request action
  guard, advance-before-callback ordering, confirm callback, and optional cancel
  callback.
- `store/pinned-tab-close-guard.ts`: routes guarded tab closes into the request
  store and respects `confirmClosePinnedTab`.
- `components/terminal/terminal-tab-actions.ts`: routes terminal and kill-all close
  paths through the same store.
- `hooks/useIpcEvents.ts`: routes native and CLI browser/workspace close requests
  through the same store and preserves confirm/cancel replies.
- `components/terminal-pane/terminal-parked-tab-watchers.ts`: preserves buffered
  exit ownership when a pinned close is canceled or queued.
- `TerminalPane.tsx`: retains the last-pane pinned preference check and existing
  terminal-process close behavior.
- `GeneralPane.tsx`: remains the settings owner for the pinned-tab preference.
- `PinnedTabCloseDialog.tsx`: remains the sole checkbox, confirm/dismiss, setting
  update, focus, copy, and request-reset surface.

The retained eager `PinnedTabCloseDialogHost` imports only React, the root store,
`lazyWithRetry`, and the already-retained Settings module loader. It subscribes to
`state.pinnedTabCloseConfirm !== null`, initializes its permanent mount latch from
that durable snapshot (preserving a request that predates host subscription), and
sets the latch once on the first request. It then remains mounted after dismiss or
confirm, so the existing dialog sees every subsequent request through the same root
store instance and preserves its request-identity checkbox reset.

The lazy surface uses reload key `pinned-tab-close-dialog` and a null Suspense
fallback. It reuses the existing Settings dynamic entry through
`loadSettingsModule`; `Settings.tsx` re-exports the existing dialog. This avoids a
new dynamic entry and keeps App's 202 static imports, 45 dynamic imports, and every
static JS/CSS count unchanged.

No visual code, tokens, layout, focus behavior, platform shortcut, terminal
routing, SSH/runtime behavior, provider behavior, or folder-workspace behavior
changed.

## Source and emitted reachability

Production A:

`index.html -> assets/App-Ci_esR-V.js -> PinnedTabCloseDialog`

The component-bearing `"Close pinned tab?"` implementation was in the eager
`assets/App-Ci_esR-V.js` chunk, which was 1,553,772 raw bytes.

Production B:

`index.html -> assets/App-xTNBNFEg.js -> PinnedTabCloseDialogHost`

On the first non-null request:

`PinnedTabCloseDialogHost -> loadSettingsModule -> assets/Settings-Ct_y93Cg.js -> PinnedTabCloseDialog`

The eager App chunk is 1,551,291 raw bytes. The dialog implementation is no longer
in it and is emitted in the pre-existing Settings dynamic entry. The Settings
entry grows only on the lazy side and is not part of the main-window static
closure.

## Fresh production A/B

Command for both builds:

```text
pnpm run build:electron-vite
```

Archived artifacts:

The paths below were ephemeral local build directories used during measurement,
not durable artifacts. The recorded hashes, byte counts, manifests, and
conclusions in this report are the portable evidence.

- A: `/tmp/orca-pinned-tab-close-dialog-a.vSX6Ku`
- B: `/tmp/orca-pinned-tab-close-dialog-b.nZidJE`

| Entry | A raw | A gzip | A JS/CSS | B raw | B gzip | B JS/CSS | Raw delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Electron main entry | 776,873 | 174,092 | 1/0 | 776,873 | 174,092 | 1/0 | 0 |
| Electron preload entry | 130,798 | 20,642 | 1/0 | 130,798 | 20,642 | 1/0 | 0 |
| Main renderer static closure | 8,419,021 | 1,878,382 | 292/2 | 8,416,540 | 1,877,823 | 292/2 | -2,481 |
| Popout renderer static closure | 4,507,253 | 984,615 | 77/2 | 4,507,253 | 984,615 | 77/2 | 0 |
| Web renderer static closure | 4,360,652 | 928,352 | 33/1 | 4,360,652 | 928,355 | 33/1 | 0 |

The closure gzip figures sum each independently gzipped emitted file, matching the
checked-in reporter. Web gzip changed by three bytes because its preload map
contains changed hashed App filenames; its raw size and JS/CSS counts are exactly
unchanged.

Entry and closure SHA-256 evidence:

| Entry | A emitted file / SHA-256 | B emitted file / SHA-256 | A closure-manifest SHA-256 | B closure-manifest SHA-256 |
| --- | --- | --- | --- | --- |
| Main renderer | `assets/index-BA5SMP-t.js` / `de8e663ddf2221774a5ca15e060077fd7fcc5a62bcc81c962608eb15faa0d964` | `assets/index-Bo3thIVg.js` / `75b6a5ab6613febe862c593824ed754febb465cc7fbfc95782c7671a86991cdc` | `319b1e52def92f4b5cffb46e3ec1b51ab741835f519360e0c6b8bb401ab9592d` | `1704e50a0e37f3d56b7f4700e649e06f88670c7e59a7f1eb7a4ef960dede02f5` |
| Popout | `assets/popout-BD9-2Cja.js` / `1ae8a4ad2c961bb5fb3be2f515b0335576526b0cd1b409ebc66f1d9e60ded74a` | identical | `e20bb9bfab534fcbe64f1d82ebe3d27c5a39c3158e803511ee6967a042371c06` | identical |
| Web | `assets/web-8LsiV0SA.js` / `87e5081c86f08716e735031827995748574abe24d2ae09a0bd2008d2c1021de9` | `assets/web-BbxUr5FJ.js` / `4b542c49f858523dda96d95240fe4996b4b0701cc784e1b8a7b670114660cb51` | `8846b5c61f38b60ee80db3482ba018d12e37ae3f994de1f3ccb7cdeef8fa7949` | `be8b408bf16e356926fdb1e2c658be36671bc3ae5dc4677d412a56178d41e686` |

Electron identities:

- Main `out/main/index.js` A/B SHA-256:
  `6e75b9d4862f1219c23f16d6c920004167d7dae1995498caaacc5354a9d8f8fd`.
- Preload `out/preload/index.js` A/B SHA-256:
  `c388a39cdca9609760e286d95b87ad1e53793720450e507f830ff1f6c5bd259f`.
- All 184 files under `out/main` were byte-for-byte identical. Both sorted
  path/size/SHA manifests hash to
  `907325898b9e2dcdbd572ca60c10d4595f656933b070566c9cea5050c7157cb8`.
- The one preload file was byte-for-byte identical. Both sorted manifests hash to
  `6533a865267aa457293cf183850e1480898704395f4431682703824557c84d97`.
- A renderer manifest: 403,000 bytes,
  `dc7342d1664bca2c5f42074479a81e7670655adde174c65718571c5311667123`.
- B renderer manifest: 403,000 bytes,
  `92ad617f8c8aee6d4c4a23622f524266cbe9c93b3fe65544d1acb833dc3f0d67`.
- Both renderer trees contained 786 emitted files plus the manifest.

## Inclusive manifest and Acorn validation

Both A and B produced:

- 778 manifest records and 778 referenced emitted targets;
- 6,460 manifest import/dynamic-import edges;
- 697 JavaScript targets parsed by Acorn using latest ECMAScript module syntax;
- 6,491 AST module edges;
- 6,489 literal relative emitted edges;
- zero missing, out-of-root, or unparsable targets.

The validation included manifest imports, dynamic imports, CSS/assets, emitted
static imports, re-exports, and literal dynamic imports.

## Budgets

Only `renderer-index.maxRawBytes` was reduced, from 8,468,828 to 8,466,347,
exactly matching the retained 2,481-byte reduction. B preserves the prior 49,807
bytes of main-renderer raw headroom. Renderer file-count budgets were unchanged.

Electron main remains 776,873 raw against 825,109, exactly 48,236 bytes of
headroom.

## Behavior and quality gates

- Focused dialog/host/store/terminal-close Vitest: 6 files, 56 tests passed.
  - no lazy load while the request is null;
  - request present before host subscription;
  - null first-load fallback;
  - one lazy load and one mounted dialog instance;
  - dismiss then reopen preserves the mounted instance;
  - dialog checkbox resets for the next request;
  - confirm, dismiss, and don't-ask preference behavior;
  - queued store requests and inter-request guard;
  - terminal close and kill-all pinned guards.
- Native/CLI IPC and parked-terminal watcher Vitest: 2 files, 144 tests passed,
  including pinned confirm/cancel replies and buffered-exit ownership.
- `pnpm run typecheck:web`: passed.
- Targeted `oxlint --deny-warnings`: passed.
- Targeted `oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered
  suppressions and no new bypass.
- `pnpm run check:electron-bundle-budgets`: passed.
- `git diff --check`: passed.

No max-lines disable or budget increase was added.

## Files in this tranche

- `config/electron-bundle-budgets.json`
- `src/renderer/src/App.tsx`
- `src/renderer/src/components/settings/Settings.tsx`
- `src/renderer/src/components/terminal-pane/PinnedTabCloseDialogHost.tsx`
- `src/renderer/src/components/terminal-pane/pinned-tab-close-dialog-lazy-boundary.test.tsx`
- `tools/benchmarks/results/phase1-pinned-tab-close-dialog-lazy-boundary-2026-07-30.md`

## Residual limits

No packaged macOS, Linux, or Windows launch was performed. Packaged ASAR lazy
loading, real cross-platform focus/keyboard behavior, SSH/runtime latency, and a
real IPC-originated pinned close remain unvalidated in this tranche; the evidence
is production-build, static-closure, source audit, type/lint/format, and focused
behavior coverage.
