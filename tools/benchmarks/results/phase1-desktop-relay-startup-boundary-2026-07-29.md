# Phase 1 DesktopRelayService startup boundary

- **Date:** 2026-07-29
- **Scope:** Move only `DesktopRelayService` construction out of the eager Electron main graph
  while preserving cloud-auth gating, runtime and window ordering, live-service identity, pairing
  provider wiring, relay status publication, and lifecycle fencing.

## Result

`src/main/index.ts` now type-imports `DesktopRelayService` and awaits the dynamic
`./startup/desktop-relay-service-startup-capability` import at the original construction site.
The capability calls only `new DesktopRelayService(options)` with the original options object and
returns that same live instance. `RelayBrokerStatus` remains an eager type-only import from
`relay-session-broker`.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  7,794,590 | 7,731,484 |    -63,106 |   1,630,202 |  1,616,703 |     -13,499 |

The preload and all renderer static graphs were byte-for-byte unchanged:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

A SHA-256 manifest comparison also matched all 786 emitted files under `out/preload` and
`out/renderer`.

## Importer and constructor evidence

Before the edit, a production-source search excluding tests found `src/main/index.ts` as the sole
value importer and sole direct constructor of
`src/main/runtime/relay/desktop-relay-service.ts`. There were no other production
`DesktopRelayService` consumers. `src/main/index.ts` and `src/main/ipc/mobile.ts` imported
`RelayBrokerStatus` type-only; relay-internal status consumers were also type-only except for the
existing `RelaySessionBroker` value import in the service implementation.

After the edit,
`src/main/startup/desktop-relay-service-startup-capability.ts` is the sole production value
importer and direct constructor. `src/main/index.ts` remains the only production owner of the
live service reference and now imports its class type-only. The service and every relay
implementation module are otherwise untouched, preserving connection, authentication,
demand-ledger, revoke-outbox, HTTP/control, device authorization, and E2EE behavior.

## Preserved gate, ordering, identity, and lifecycle

The awaited capability import and construction remain inside the existing
`if (cloudAuth.configured) { try { ... } }` block. Unconfigured cloud auth still performs no
relay import or construction. Import or construction failures still reach the unchanged warning
fallback, `[relay] Desktop relay startup unavailable:`, without changing desktop readiness.

Desktop startup order remains:

1. `openMainWindow()` and `runtimeRpc.start()` run in the existing `Promise.all`.
2. Runtime RPC failure handling remains before cloud-auth evaluation.
3. The configured-cloud-auth `try` dynamically loads the capability and constructs with the
   original `authConfig`, profile user-data path, app version, `runtimeRpc`, and status callback.
4. The returned live instance is assigned to `desktopRelayService`.
5. The mobile relay pairing provider is installed with closures over that same local instance.
6. `relayService.start()` runs only after assignment and provider wiring.

The status starts at the unchanged `'offline'` default. The original callback still assigns
`desktopRelayStatus` before sending `mobile:relayStatusChanged` through the current main window.
The mobile IPC status getter continues to read the same global value.

Pairing creation, queued revoke handling, demand changes, endpoint discovery, and provisioning
continue to call the same live service through the unchanged pairing-provider closures. The
original `runtimeRpc` object is passed into construction and used for the provider, so runtime
RPC identity and main-window ordering are unchanged.

The same global instance remains referenced by the relaunch callback, Orca profile auth-mutation
callback, profile sign-out callback, and `before-quit` handler. Relaunch, sign-out, and quit still
call `fenceAndCloseNow()`; auth mutation still calls `authMutated()`. Quit still fences the relay
before clearing the runtime pairing provider. No relay API, cloud configuration rule, status
contract, account/rate-limit/plugin behavior, or SSH/folder-workspace path changed.

## Generated chunk and packaged-relative resolution

The emitted capability chunk is
`out/main/chunks/desktop-relay-service-startup-capability-BcByl8gs.js` (64,047 raw / 14,073 gzip
bytes). `out/main/index.js` loads it through
`./chunks/desktop-relay-service-startup-capability-BcByl8gs.js`.

The entry specifier is relative, contains no parent traversal, and resolves under `out/main`.
Every relative dependency in the capability chunk was resolved and confirmed to exist under
`out/main`:

- `./chunk-BTjIgr6M.js`
- `./tui-agent-config-CgQCoDXB.js`
- `../index.js`

These paths match packaged-relative CommonJS resolution.

## Budget

The prior `electron-main` raw budget was 7,842,826 bytes. Lowering it by the exact measured
63,106-byte improvement produces a new budget of 7,779,720 bytes and leaves exactly 48,236 bytes
(0.624%) of headroom over the 7,731,484-byte entry. No preload or renderer budget changed.

## Validation

- Fresh production A and B `pnpm run build:electron-vite`: passed. The baseline transformed
  1,968 main modules; the post-edit build transformed 1,969. Both transformed 17 preload modules
  and 9,181 renderer modules.
- Focused DesktopRelayService, auth coordinator and recovery, session broker, HTTP/control,
  demand, revoke, E2EE, pairing, relay transport, runtime RPC failure, desktop startup, and serve
  activation suite: passed, 17 files and 108 tests.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint` on the touched source and tests: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check` on the touched source, tests, and budget: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 7,731,484 actual versus 7,779,720 budgeted
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
