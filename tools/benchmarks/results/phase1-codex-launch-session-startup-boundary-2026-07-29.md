# Phase 1 Codex launch/session startup boundary — 2026-07-29

**Scope:** Move the remaining eager Codex launch, hook, trust, resume, migration,
backfill, index-heal, runtime-selection, and home-path values in `src/main/index.ts`
behind one exact-identity app-ready capability.

## Result

`src/main/index.ts` now performs one dynamic import of
`./startup/codex-launch-session-startup-capability` immediately after installing the
retained agent-hook capability. It installs the returned object in a typed,
fail-closed owner before Store construction or any live Codex consumer.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  3,636,591 | 3,590,383 |    -46,208 |     769,478 |    759,456 |     -10,022 |

The preload and renderer outputs were byte-identical:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

## Production importer audit

Before this tranche, `index.ts` directly value-imported:

- `markCodexProjectTrusted`;
- `normalizeCodexRuntimeSelection`;
- `codexHookService` and `setSystemCodexHomeHookSweepSuppressed`;
- `ensureRealHomeCodexHookState` and `isRealHomeCodexHookLaneUsable`;
- `setCodexTrustGrantTelemetry`;
- `startCodexSessionBackfillInBackground` and
  `startCodexSessionIndexHealInBackground`;
- `createCodexSessionMigrationScheduler`;
- `prepareLegacySharedCodexSessionResume`;
- `resolveHostCodexSessionSourceHome`;
- `prepareCodexSessionResume`; and
- `getOrcaManagedCodexHomePath` and `getSystemCodexHomePath`.

The production audit found these other importer groups:

- retained runtime-service and core-IPC graphs consume agent-trust presets for local,
  WSL, SSH, and remote worktree trust;
- the retained account-services graph consumes runtime selection, runtime-home
  resolution, hook install material, session-source paths, and Codex home paths;
- the retained terminal-runtime graph consumes runtime selection, hook service, and
  system-home resolution for PTY launch and WSL environment construction;
- the retained agent-hook graph consumes the same `codexHookService` singleton through
  managed-hook controls, remote installers, WSL relay dependencies, and SSH relay
  sessions;
- the retained Codex-usage Store graph and deferred core/native-chat paths consume
  Codex home discovery without becoming new eager `index.ts` paths; and
- session backfill, index heal, legacy resume, and real-home hook modules form the same
  internal Codex graph now rooted by the new aggregate.

`index.ts` retains only the type-only `CodexAccountSelectionTarget` import from
runtime selection. Cross-domain leaves such as telemetry `track`, WSL distro
resolution, cross-platform path comparison, Store/runtime/account types, and agent-hook
enablement remain in their existing owners.

Several target modules can already be evaluated by retained app-ready capabilities,
especially hook service and Codex home paths through the agent-hook aggregate. Node/Electron
module caching means the new aggregate returns those exact existing singleton and function
objects rather than creating alternate state.

## Lifecycle and identity audit

There is no supported pre-app-ready Codex launch or resume event. Before readiness,
`index.ts` only declares callbacks. Store hydration, account construction, runtime
construction, IPC registration, PTY registration, window creation, SSH relay creation,
and headless serve startup all happen inside or after `app.whenReady`.

The retained order is:

1. browser, main-window, terminal-runtime, updater-runtime, desktop-shell, and
   agent-hook capabilities load and install;
2. the Codex launch/session aggregate loads once, returns the original exports, and is
   installed in the typed owner;
3. certificate handling, CLI/WSL reconciliation, Store construction, hydration, and
   telemetry initialization retain their existing positions;
4. trust-grant telemetry is injected after `initTelemetry` and before observability,
   account, runtime, IPC, or renderer consumers;
5. account-service configuration installs the same real-home lane gate and system-home
   sweep gate, then constructs the migration scheduler with the same eligibility,
   quitting, home resolver, backfill, and index-heal identities;
6. runtime and window AI Vault callbacks keep the same legacy-resume function and live
   settings/home resolution;
7. first-window and headless terminal registration keep the same synchronous launch
   preparation and asynchronous session-resume callbacks; and
8. managed hook reconciliation, window opening, RPC readiness, serve promotion, and
   teardown retain their original downstream order.

The three functions declared before readiness—Codex runtime-home launch preparation,
session-resume preparation, and main-window creation—read the typed owner synchronously
and fail closed if called before installation. Their post-readiness callers receive the
original identities. No launch API became asynchronous.

The capability factory only returns imported identities. It does not construct a new hook
service, create a scheduler early, mutate home selection, grant trust, install hooks,
start background work, or emit telemetry.

## Preserved contracts

- Real versus Orca-managed `CODEX_HOME` selection, account ranking, trusted-home
  provenance, and legacy shared-home migration are unchanged.
- Synchronous project trust marking still occurs before recognized local Codex launch
  and resume, with the same best-effort warning behavior.
- Real-home lane gating, hook sweep suppression, hook install/refresh policy, user-hook
  preservation, trust grants, and telemetry field ordering are unchanged.
- Backfill and index healing remain scheduler-owned background work and retain quitting,
  eligibility, initial-run, and account-selection triggers.
- Local, WSL, SSH, remote, and folder-workspace routing continues through the existing
  providers and runtime services. No local-worktree assumption was added.
- Windows, macOS, and Linux paths continue through existing path utilities and runtime
  gates. No Git command or provider behavior changed, so GitLab/other providers and the
  Git 2.25 baseline are unaffected.

## A/B artifacts and hashes

The paths below were ephemeral local build directories used during measurement,
not durable artifacts. The recorded hashes, byte counts, manifests, and
conclusions in this report are the portable evidence.

- Fresh A: `/tmp/orca-codex-launch-session-a.3ehphi`
- Final B: `/tmp/orca-codex-launch-session-b.27Upad`
- A entry SHA-256:
  `f215df1d66b8eea478f2910eb8ec0b2c697a218397c2384583c0f982569a5839`
- B entry SHA-256:
  `f6242c0955c8a600a44912e21eb0bdd8296483b859c615b36e998896892cf527`

Both sorted non-main manifests contain 786 rows / 89,303 bytes and have SHA-256
`e7fed74bb51c30b41084a2a5d052f5dc0773a696552f1a8e051d363ed4be762a`.
Their direct diff is empty.

The A main manifest contains 129 rows / 14,983 bytes and has SHA-256
`315147af4d068bd8d59f1bfa666aaf546e7224c0b67606bcf521110e8be4fe0a`.
The B main manifest contains 131 rows / 15,238 bytes and has SHA-256
`afbb9536871be0705da1b21523f5fbf30ecf990a00db13026f3e83c200a247f7`.

## Emitted chunk and closure

The retained build emits
`out/main/chunks/codex-launch-session-startup-capability-COnrYJZ9.js` at
47,423 raw bytes with SHA-256
`b9f86937f39af7bea2ae4b108d5ca3e1aec31c210e9f2a7b01056f1f4ee87355`.
Its nine direct literal relative edges are:

- `./chunk-BTjIgr6M.js`
- `./win32-utils-DtAFUr2N.js`
- `./fs-utils-D5115c5m.js`
- `./execution-host-DX_Sa8Eh.js`
- `./hook-service-BPcIgznJ.js`
- `./codex-app-server-client-C9VhVlb_.js`
- `./codex-home-paths-C8xszHr4.js`
- `../index.js`
- `./codex-session-file-listing-C1gM8eJG.js`

The `../index.js` edge is the bundler's shared-entry cycle and preserves composition-root
state rather than duplicating it.

An inclusive Acorn AST walk followed literal relative import, export,
dynamic-import, and `require` edges. The capability closure visited 121 JavaScript
files and validated 653 edges. A separate scan of all 131 emitted-main JavaScript
files validated 701 edges. Every resolved target exists and remains beneath
`out/main`; no edge escapes the emitted directory.

## Budget

The previous Electron-main raw budget was 3,684,827 bytes. Lowering only that value by
the exact 46,208-byte reduction produces 3,638,619 bytes:

`3,638,619 - 3,590,383 = 48,236`

Preload and renderer budgets are unchanged.

## Validation

- Fresh A and final B `pnpm run build:electron-vite`: passed; main transforms
  changed from 1,991 to 1,993, preload remained 17, and renderer remained 9,181.
- Focused capability, owner, source-boundary, project trust, hook service,
  real-home hook, trust grant/ledger/rollback/rebase, home path, runtime selection,
  account service, launch, resume, legacy migration, backfill, index heal,
  migration scheduler, PTY, runtime, account/agent-hook/terminal/runtime startup,
  desktop/serve startup, shutdown checkpoint, dev-parent shutdown, and relaunch
  coverage: 70 files / 2,190 passed and 6 skipped.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint --deny-warnings`: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions
  and no new bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 3,590,383 actual versus
  3,638,619 budgeted Electron-main bytes.
- `git diff --check`: passed.

The broad run initially exposed two stale source assertions in the previously retained,
untracked runtime-service boundary test: they still expected the pre-agent-hook
`agentHookServer` spelling. With coordinator authorization, only those two assertions
were updated to the already-retained `agentHooks.agentHookServer` identity. Production
code and ordering were not changed by that maintenance correction, and the affected
test passed in the final 70-file run.

Both production builds emitted the same existing CSS optimizer warnings for
`::highlight(markdown-preview-search-match)` and
`::highlight(markdown-preview-search-active-match)`.

## Remaining limitation

The production builds and Acorn scans validate emitted relative dependency resolution
on this macOS worktree. This tranche did not run packaged-ASAR launch smokes on macOS,
Linux, and Windows; cross-platform packaged launch verification remains explicitly
unresolved.
