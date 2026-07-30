# Phase 1 crash/hang runtime startup boundary — 2026-07-29

**Scope:** Move the app-ready crash report, hang watchdog, recovery-classification,
and process-gone composition values behind one exact-identity startup capability while
retaining the two proven pre-ready leaves and all GPU fallback policy.

## Result

`src/main/index.ts` now dynamically imports
`./startup/crash-hang-runtime-startup-capability` immediately after installing the
telemetry/observability capability. The returned object is installed in a typed,
fail-closed owner before constructing the crash report store, installing the watchdog,
consuming the previous-run marker, registering the certificate handler, changing the
app name, or starting any window/runtime consumer.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  3,573,732 | 3,557,573 |    -16,159 |     755,124 |    750,742 |      -4,382 |

The preload and renderer outputs remained byte-identical:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

## Production importer audit

Before this tranche, `index.ts` eagerly value-imported:

- `recordCrashBreadcrumb` and `recordCoalescedCrashBreadcrumb`;
- `recordDurableCrashBreadcrumb`;
- `installMainThreadHangWatchdog`;
- `consumeHangDetectionMarker` and `hangDetectionMarkerPath`;
- `getMainProcessLifecycleIdentity`;
- `CrashReportStore`;
- `shouldRecoverRendererAfterProcessGone`; and
- `recordProcessGoneCrash`.

The complete production importer audit found:

- `crash-breadcrumb-store` is also used by durable/process-gone recording, system
  resume, PTY/filesystem/crash IPC, and GitHub PR refresh coalescers.
- `durable-crash-breadcrumb` is also used by app relaunch, updater lifecycle
  diagnostics, the main-process error guards, and process-gone recording.
- `hang-detection-marker` is shared with the watchdog and its child entry;
  `main-thread-hang-watchdog` otherwise had only the direct `index.ts` importer.
- `main-process-lifecycle-identity` is shared by durable and process-gone recording.
- Other production imports of `CrashReportStore` are type-only in core and
  crash-reporting IPC registration.
- `process-gone-classification` is also used by the recorder and as a type by its
  diagnostics module; `process-gone-recorder` otherwise had only the direct
  `index.ts` importer.

ES module caching keeps one identity for every value regardless of whether another
retained graph reaches the module first. The capability returns those exact imports;
it does not wrap, recreate, or copy their state.

## Lifecycle audit

Two calls genuinely precede `app.whenReady()` and therefore remain narrow eager
imports:

- `recordCrashBreadcrumb('app_started', ...)`, after canonical data-path capture and
  only when the single-instance lock is owned; and
- `getMainProcessLifecycleIdentity()` for that breadcrumb.

`maybeApplyGpuFallbackForThisLaunch()` also runs before readiness because Electron's
hardware-acceleration switch must be applied before the app is ready. Its marker,
tracker, thresholds, candidate decision, restart prompt, and direct
`gpu_fallback_applied` breadcrumb remain eager and unchanged.

The prior `CrashReportStore.fromUserData()` call only captured a path. There was no
pre-ready process-gone listener, renderer, window, crash-report IPC handler, or report
read/write. It now runs at the first safe app-ready point, still before `app.setName`,
so its default `app.getPath('userData')` input and canonical-path timing are unchanged.
The store class, write chain, Windows ACL recovery, sanitization, dedupe, and report
ownership are untouched.

The watchdog installation and previous marker consumption remain adjacent and keep
the canonical user-data input. Marker-to-durable-breadcrumb ordering is unchanged;
the later telemetry event still occurs only after telemetry initialization.

Predeclared live functions use the required owner for agent-state coalescing, settings
breadcrumbs, renderer recovery/classification, manual reloads, GPU child-crash
handling, and process-gone persistence. Every such callback is installed or reachable
only after capability installation. `will-quit` has no crash/hang-capability consumer,
so no optional early-quit owner path was necessary.

No renderer/child recovery policy, metadata, `CrashReportStore` ownership, main-window
recreation, headless serve behavior, or shutdown ordering moved into the capability.
SSH/remote, WSL, and folder-workspace paths continue through their existing runtime
and PTY boundaries. No Git command or provider behavior changed.

## A/B evidence and hashes

Fresh production evidence:

The paths below were ephemeral local build directories used during measurement,
not durable artifacts. The recorded hashes, byte counts, manifests, and
conclusions in this report are the portable evidence.

- A: `/tmp/orca-crash-hang-runtime-a.2SGiME`
- B: `/tmp/orca-crash-hang-runtime-final-b.ys96bL`
- A transformed 1,995 main, 17 preload, and 9,181 renderer modules.
- B transformed 1,997 main, 17 preload, and 9,181 renderer modules.
- Both builds emitted only the two existing CSS `::highlight(...)` parser warnings.

Entry hashes:

- A `out/main/index.js` SHA-256:
  `196f22d886cf0e6d534b1ea6ed73ece9a3bf561fb55a252a47109f5b0313bbfc`
- B `out/main/index.js` SHA-256:
  `ee3964bc76235c05c55ea67e53408dddabfa88ffec6e958de33323420c9b2fe6`

The sorted A and B non-main manifests each contain exactly 786 rows and are
byte-identical. Their SHA-256 is
`e7fed74bb51c30b41084a2a5d052f5dc0773a696552f1a8e051d363ed4be762a`.
An explicit `diff -u` produced no output, and all 786 B files passed verification
against the A manifest.

The A main manifest contains 134 rows with SHA-256
`2ef872fbaf337b2068950ff1a4593017fc64e29f9dc54fd7954b6cecf862fcb9`.
The B main manifest contains 135 rows with SHA-256
`4bc1da573d6dd46d3167ce729de32f55d91f9339ce2fb974776992255d1daf13`.

## Emitted chunk and closure

The retained build emits
`out/main/chunks/crash-hang-runtime-startup-capability-D0EviH4j.js` at 18,987 raw
bytes with SHA-256
`4a2993ecba5a67781daab5215ad0c25a64e50f59d80e2205cc8383ba3832d2ea`.
Its four direct literal relative edges are:

- `./chunk-BTjIgr6M.js`
- `./win32-utils-DtAFUr2N.js`
- `../index.js`
- `./hang-detection-marker-CisIg30K.js`

The `../index.js` edge is the bundler's shared-entry cycle and preserves existing
singleton state rather than duplicating it.

An inclusive Acorn AST walk followed literal relative import, export,
dynamic-import, and `require` edges. The capability closure visited 125 JavaScript
files and validated 673 edges. A separate scan of all 135 emitted-main JavaScript
files validated 721 edges. Every resolved target exists and remains beneath
`out/main`; no edge escapes the emitted directory.

## Budget arithmetic

The previous Electron-main raw budget was 3,621,968 bytes. Lowering only that value by
the exact 16,159-byte reduction produces 3,605,809 bytes:

`3,605,809 - 3,557,573 = 48,236`

Preload and renderer budgets are unchanged.

## Validation

- Fresh A and B production Electron/Vite builds: passed.
- Focused capability, owner, source-boundary, crash breadcrumb/report,
  durable-breadcrumb, lifecycle identity, process-gone classification/dedupe/
  diagnostics/recording, renderer recovery, GPU fallback, hang marker/watchdog/
  telemetry/child-loop, crash IPC, relaunch, main-process error guard, main-window
  create/attach, startup ordering, serve activation, runtime capability, renderer
  shutdown checkpoint, and quit-policy suite: 36 files / 319 tests passed.
- SSH-rearm, remote runtime request, WSL terminal host, folder-workspace path,
  headless-display, and PTY startup-order representatives: 6 files / 30 tests passed.
- Aggregate test result: 42 files / 349 tests passed.
- `pnpm run typecheck:node`: passed.
- Targeted `oxlint --deny-warnings`: passed.
- Targeted `oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with no new bypasses.
- `pnpm run check:electron-bundle-budgets`: passed.
- `git diff --check`: passed.

## Platform limitation

The source, unit/integration tests, and generated-closure validation cover the
cross-platform gates and retain the existing Windows path/ACL, macOS lifecycle, Linux
headless, WSL, SSH/remote, and folder-workspace code. Packaged-ASAR launch verification
was not run on macOS, Linux, and Windows and remains explicitly unresolved.
