# Phase 1 account-services startup boundary

- **Date:** 2026-07-29
- **Scope:** Move the five related account-service constructors behind one aggregate startup
  capability while preserving construction side effects, Codex migration policy, identity, and
  all downstream rate-limit/runtime/IPC/window/PTY/automation/quit wiring.

## Result

`src/main/index.ts` now type-imports `RateLimitService`, `CodexRuntimeHomeService`,
`CodexAccountService`, `ClaudeRuntimeAuthService`, and `ClaudeAccountService`. At the original
construction point it awaits exactly one
`./startup/account-services-startup-capability` import and synchronously calls one aggregate
factory. The factory returns the same five live instances, which `index.ts` assigns to the
existing globals before any post-construction wiring.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  7,728,795 | 7,331,492 |   -397,303 |   1,615,903 |  1,539,032 |     -76,871 |

The preload and all renderer static graphs were byte-for-byte unchanged:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

A SHA-256 manifest comparison matched all 786 emitted files outside `out/main`, covering the
complete preload and renderer output.

## Importer, constructor, and interface evidence

Before the edit, production-source searches excluding tests found `src/main/index.ts` as the
sole direct constructor site for all five classes and the only production value importer needed
for startup construction. Runtime, core IPC, provider-specific IPC, auth preservation, account
target sync, and the account services themselves consume these dependencies through type-only
imports.

After the edit, `src/main/startup/account-services-startup-capability.ts` is the sole production
constructor site and value importer for all five classes. `index.ts` has one aggregate dynamic
import, one factory call, and no direct constructor. This is intentionally one aggregate
capability rather than five mechanical dynamic imports.

The factory contract is:

- the original `Store` instance;
- one narrow `configureCodexRuntimeHome(runtimeHome)` composition callback;
- a callback result containing only the `CodexAccountService` lifecycle and
  `afterCodexAccountCreated` hook needed to preserve startup sequencing;
- a return value containing the five named live services.

It does not expose raw constructor argument bags. The factory remains synchronous after the
awaited module import, so constructor execution, post-Codex scheduling, and global assignment
complete in one JavaScript turn before the asynchronous Claude runtime-auth sync can resume.

The exact internal order is covered by a focused test:

1. `RateLimitService`
2. `CodexRuntimeHomeService`
3. `configureCodexRuntimeHome`
4. `CodexAccountService` with the callback-provided lifecycle
5. callback-provided `afterCodexAccountCreated`
6. `ClaudeRuntimeAuthService`
7. `ClaudeAccountService`

The same `Store` object is passed by identity to both runtime-auth services and both account
services. The same `RateLimitService` is passed to both account services, the same
`CodexRuntimeHomeService` is passed to the Codex account service, and the same
`ClaudeRuntimeAuthService` is passed to the Claude account service. The returned values are
those exact constructed objects.

## Preserved constructor side effects and Codex policy

No service implementation or constructor changed:

- `RateLimitService` retains its initial provider state, Grok auth snapshot, fetch generations,
  polling state, abort/fetch queues, caches, resolvers, and listeners.
- `CodexRuntimeHomeService` still performs legacy shared-auth, managed-state, and active-home
  migrations; initializes last-synced state; and synchronously attempts the current-selection
  sync before configuration continues.
- `CodexAccountService` still hydrates the reset-credit ledger and synchronizes canonical config
  to managed homes during construction.
- `ClaudeRuntimeAuthService` still initializes last-synced state and starts its asynchronous safe
  current-selection sync at the same relative point.
- `ClaudeAccountService` still receives the already-created shared rate-limit and runtime-auth
  services without adding constructor work.

The explicit configuration callback remains in `index.ts`, where policy ownership belonged:

- it assigns the live runtime-home service before installing callbacks;
- it retains the real-home lane gate through `isRealHomeCodexHookLaneUsable`;
- it retains system-home hook-sweep suppression with the same global service, persisted
  hook-setting, downgrade, opt-out, and incapable-lane behavior;
- it creates the same `createCodexSessionMigrationScheduler` with the same real-home eligibility,
  `isQuitting` fence, system-home override, backfill, and index-heal functions;
- it returns `requestRun` as `onHostSystemDefaultSelected`;
- it returns `scheduleInitialRun` as the post-Codex-account hook, so initial scheduling remains
  after Codex account construction and before Claude runtime-auth construction.

The scheduler remains owned by the composition callback. Its 15-second deferred initial run,
single active task, stop observation, rerun request, backfill-before-index-heal order, error
fallback, and quit/eligibility fencing are unchanged.

## Preserved downstream identity and lifecycle

All post-construction wiring remains in `index.ts` and occurs after the five global assignments:

- Codex home preparation for rate-limit fetches and initial host/WSL targets;
- Claude auth preparation and initial host/WSL targets;
- settings-driven account runtime-target synchronization;
- live Claude statusline rate-limit ingest and drained-live-PTY refresh;
- OpenCode Go, MiniMax, Gemini CLI OAuth, and proxy resolvers;
- inactive managed Claude and Codex account resolvers, including WSL metadata;
- `runtimeService.setAccountServices({ claudeAccounts, codexAccounts, rateLimits })`;
- commit-message and terminal launch preparation;
- core account, config-sync, MiniMax, and rate-limit IPC handlers;
- main-window rate-limit attachment and deferred polling start.

The existing `openMainWindow` guards still require all five services before core handlers or
renderer readiness. `registerCoreHandlers` receives the same global account/rate-limit
singletons, and Codex config sync still resolves `codexAccounts.runtimeHomeService`, preserving
identity. Runtime account list/select/remove/reset-credit RPC methods use the same objects
installed through `setAccountServices`.

Codex PTY, commit-message, AI-vault discovery/resume, trust-grant, managed-hook, and session
preparation continue to use the same runtime-home global. Claude PTY and rate-limit preparation
continue to use the same runtime-auth global. Relaunch and update preparation still calls
`preserveAgentAuthBeforeRestart` with both globals, including host Codex, WSL Codex, and
asynchronous Claude sync within the existing bounded timeout.

No local, WSL, SSH, remote-runtime, or folder-workspace routing changed. SSH/remote targets still
delegate to their existing provider/runtime paths; host and WSL account selection normalization,
managed-home metadata, folder-workspace identities, and Git behavior are untouched. The
`before-quit` handler still calls `rateLimits?.stop()` at the same point, preserving timer,
listener, and in-flight fetch cleanup.

## Generated chunk and packaged-relative resolution

The emitted capability chunk is
`out/main/chunks/account-services-startup-capability-BYfjIGox.js` (393,058 raw / 76,556 gzip
bytes). `out/main/index.js` loads it through
`./chunks/account-services-startup-capability-BYfjIGox.js`.

The entry specifier is relative, contains no parent traversal, and resolves under `out/main`.
Every relative dependency in the capability chunk was resolved and confirmed to exist under
`out/main`:

- `./chunk-BTjIgr6M.js`
- `./win32-utils-DtAFUr2N.js`
- `./codex-app-server-client-BaImxMIx.js`
- `./wsl-paths-B-s6uTn_.js`
- `./hook-service-Bs9D1qTr.js`
- `./pty-path-safety-P8gLt_xB.js`
- `./codex-home-paths-BljbrLeG.js`
- `./wsl-login-shell-command-Jp1YK-Ls.js`
- `./wsl-By_HVg-G.js`
- `../index.js`
- `./codex-usage-store-startup-capability-sx-AiLqS.js`

These paths match packaged-relative CommonJS resolution.

## Budget

The prior `electron-main` raw budget was 7,777,031 bytes. Lowering it by the exact measured
397,303-byte improvement produces a new budget of 7,379,728 bytes and leaves exactly 48,236
bytes (0.658%) of headroom over the 7,331,492-byte entry. No preload or renderer budget changed.

## Validation

- Fresh production A and B `pnpm run build:electron-vite`: passed. The baseline transformed
  1,970 main modules; the post-edit build transformed 1,971. Both transformed 17 preload modules
  and 9,181 renderer modules.
- Focused aggregate capability/boundary, rate-limit service and fetch targets, Codex
  runtime-home/account/session migration, Claude runtime-auth/account/live-PTY, runtime accounts,
  full runtime, core/rate-limit IPC, auth preservation, PTY launch, commit environment,
  desktop/serve startup, and runtime startup-failure suite: passed, 27 files with 1,834 tests
  passed and one skipped.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint` on the touched source and tests: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check` on the touched source, tests, report, and budget: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 7,331,492 actual versus 7,379,728 budgeted
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
