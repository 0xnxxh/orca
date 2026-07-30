# Phase 1 telemetry/observability startup boundary — 2026-07-29

**Scope:** Move the remaining direct Electron-main telemetry and observability
composition values behind one exact-identity app-ready capability while preserving the
two lanes' independent state and lifecycle order.

## Result

`src/main/index.ts` now performs one dynamic import of
`./startup/telemetry-observability-startup-capability` immediately after the retained
Codex launch/session capability. It installs the exact returned object in a typed owner
before Store construction or any live telemetry/observability consumer.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  3,590,383 | 3,573,732 |    -16,651 |     759,456 |    755,124 |      -4,332 |

The preload and renderer outputs were byte-identical:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

## Production importer audit

Before this tranche, `index.ts` directly value-imported:

- `initObservability` and `shutdownObservability`;
- `initTelemetry`, `shutdownTelemetry`, `track`, and `trackAppOpenedOnce`;
- `classifyError`;
- `initCohortClassifier`;
- `initOnboardingCohortClassifier`; and
- `resolveConsent`.

The complete production audit found these other importer groups:

- `runtime/runtime-rpc-startup-failure.ts` remains an intentional eager leaf and
  imports the same telemetry `track` function for transport-start failure reporting.
  This keeps the client reachable in the entry, but does not create a second client,
  Store reference, session, burst cap, consent state, or shutdown gate.
- Retained agent-hook, terminal-runtime, account, runtime-service, core-IPC,
  desktop-relay, Star Nag, and usage graphs import the same telemetry client for
  daemon, PTY, hook, provider, repository, IPC, relay, and product events.
- The telemetry client itself imports cohort-at-emit and consent resolution, preserving
  its shutdown → burst-cap → consent → validator → capture ordering.
- Cohort, onboarding-cohort, and consent modules are also consumed through Store and
  deferred IPC graphs.
- Observability status and diagnostic bundle operations are consumed by deferred core
  IPC/runtime diagnostic paths and crash-feedback bundle construction.

Crash breadcrumbs, durable breadcrumbs, lifecycle diagnostics, runtime-RPC failure UI,
updater diagnostics, TCC notice handling, and other cross-domain leaves remain in their
existing eager owners.

## Lifecycle and order audit

There is no supported pre-app-ready telemetry or observability event in `index.ts`.
Before readiness, the daemon-start and main-window functions only declare callbacks.
Store construction, agent subscriptions, telemetry initialization, runtime/IPC
construction, terminal startup, and window creation all occur inside or after
`app.whenReady`.

The retained order is:

1. browser, main-window, terminal-runtime, updater-runtime, desktop-shell, agent-hook,
   and Codex capabilities load and install;
2. the telemetry/observability aggregate loads once, returns original exports, and is
   installed before Store construction;
3. Store construction, hydration, browser session setup, and agent subscriptions retain
   their positions;
4. `initTelemetry(store)` runs at its original point before any IPC/renderer can emit;
5. hang detection tracking follows telemetry initialization;
6. Codex trust-grant telemetry receives the same `track` identity and field mapping;
7. observability initializes before the main-process lifecycle breadcrumb;
8. both cohort classifiers initialize after that breadcrumb and before stats, account,
   runtime, IPC, or renderer consumers;
9. daemon fallback and first-window consent/app-opened callbacks resolve the
   fail-closed owner synchronously; and
10. committed quit still awaits telemetry shutdown, then observability shutdown, before
    the second `app.quit()`.

The `will-quit` handler can theoretically run before app readiness. It uses the
specifically named optional owner read. Before installation neither lane could have
initialized, so skipping both shutdown calls is safe. After installation it invokes the
same shutdown functions at the original positions. Live callbacks use the required
owner and fail closed if invoked before installation.

The capability factory only returns imported identities. It does not initialize
PostHog, install an observability sink, resolve consent, capture an event, set Store
state, reset burst caps, initialize cohorts, or begin shutdown.

## Preserved contracts

- Telemetry consent precedence, live settings reads, opt-in/out behavior, burst caps,
  validation, common properties, official-build gating, and PostHog singleton ownership
  are unchanged.
- `app_opened` still emits once only after the first main-window load and effective
  consent is enabled.
- Daemon startup errors retain the same classification and `daemon_start_failed`
  payload; runtime-RPC failures continue through their existing eager leaf.
- Codex trust-grant tracking keeps the same callback timing and property mapping.
- Cohort and onboarding-cohort Store references initialize at the same points and retain
  their never-crash fallback behavior.
- Observability remains isolated from product telemetry, retains its environment gates,
  local sink ownership, lifecycle breadcrumb ordering, and tracer-before-sink shutdown.
- Desktop and headless serve use the same process-wide telemetry and observability
  identities. No local, WSL, SSH, remote, folder-workspace, Git-provider, Git 2.25, or
  macOS/Linux/Windows routing behavior changed.

## A/B artifacts and hashes

The paths below were ephemeral local build directories used during measurement,
not durable artifacts. The recorded hashes, byte counts, manifests, and
conclusions in this report are the portable evidence.

- Fresh A: `/tmp/orca-telemetry-observability-a.5x4rOo`
- Final B: `/tmp/orca-telemetry-observability-b.BLPjRb`
- A entry SHA-256:
  `f6242c0955c8a600a44912e21eb0bdd8296483b859c615b36e998896892cf527`
- B entry SHA-256:
  `196f22d886cf0e6d534b1ea6ed73ece9a3bf561fb55a252a47109f5b0313bbfc`

Both sorted non-main manifests contain 786 rows / 89,303 bytes and have SHA-256
`e7fed74bb51c30b41084a2a5d052f5dc0773a696552f1a8e051d363ed4be762a`.
Their direct diff is empty.

The A main manifest contains 131 rows / 15,238 bytes and has SHA-256
`afbb9536871be0705da1b21523f5fbf30ecf990a00db13026f3e83c200a247f7`.
The B main manifest contains 134 rows / 15,607 bytes and has SHA-256
`2ef872fbaf337b2068950ff1a4593017fc64e29f9dc54fd7954b6cecf862fcb9`.

## Emitted chunk and closure

The retained build emits
`out/main/chunks/telemetry-observability-startup-capability-CAjC2Tep.js` at
1,054 raw bytes with SHA-256
`579021b1805c414959206c9b7826bb69b9b0fbd1af4e78aedb03a64237569890`.
Its five direct literal relative edges are:

- `./tui-agent-config-DMkBaphp.js`
- `../index.js`
- `./daemon-file-log-DC6dBvZO.js`
- `./logs-directory-LBNBRBdv.js`
- `./onboarding-cohort-classifier-D_FlZnhw.js`

The `../index.js` edge is the bundler's shared-entry cycle and preserves composition-root
state rather than duplicating it.

An inclusive Acorn AST walk followed literal relative import, export,
dynamic-import, and `require` edges. The capability closure visited 124 JavaScript
files and validated 669 edges. A separate scan of all 134 emitted-main JavaScript
files validated 717 edges. Every resolved target exists and remains beneath
`out/main`; no edge escapes the emitted directory.

## Budget

The previous Electron-main raw budget was 3,638,619 bytes. Lowering only that value by
the exact 16,651-byte reduction produces 3,621,968 bytes:

`3,621,968 - 3,573,732 = 48,236`

Preload and renderer budgets are unchanged.

## Validation

- Fresh A and final B `pnpm run build:electron-vite`: passed; main transforms
  changed from 1,993 to 1,995, preload remained 17, and renderer remained 9,181.
- Focused capability, owner, source-boundary, telemetry client/lifecycle/consent,
  burst cap, validator, cohort, onboarding cohort, install ID, IPC telemetry,
  agent-hook install telemetry, Codex trust telemetry, hang telemetry,
  observability architecture/bundle/upload/instrumentation/sink/redaction/tracer,
  daemon startup, runtime-RPC failure, first-window, desktop/serve,
  terminal/runtime startup, full runtime, shutdown checkpoint, dev-parent shutdown,
  and relaunch coverage: 40 files / 1,345 passed and 1 skipped.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint --deny-warnings`: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions
  and no new bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 3,573,732 actual versus
  3,621,968 budgeted Electron-main bytes.
- `git diff --check`: passed.

The telemetry consent suite intentionally emitted its existing warning for
`DO_NOT_TRACK="0"` as an unrecognized truthy value. Both production builds emitted
the same existing CSS optimizer warnings for
`::highlight(markdown-preview-search-match)` and
`::highlight(markdown-preview-search-active-match)`.

## Remaining limitation

The production builds and Acorn scans validate emitted relative dependency resolution
on this macOS worktree. This tranche did not run packaged-ASAR launch smokes on macOS,
Linux, and Windows; cross-platform packaged launch verification remains explicitly
unresolved.
