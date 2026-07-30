# Phase 1 runtime-connectivity startup boundary — 2026-07-29

**Scope:** Move the remaining runtime-connectivity, mobile registration, and pairing
composition leaves behind one exact-identity app-ready capability while preserving the
runtime server, relay service, remote-environment, mobile, serve, and shutdown owners.

## Result

`src/main/index.ts` now dynamically imports
`./startup/runtime-connectivity-startup-capability` after installing the retained
account-runtime coordination capability. It immediately installs the returned exact-identity
aggregate in a fail-closed owner before its first runtime transport, signer, mobile, or serve
consumer.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  3,544,763 | 3,410,984 |   -133,779 |     748,197 |    720,505 |     -27,692 |

The preload and renderer outputs remained byte-identical:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

## Production importer and consumer audit

The audit covered `src/main/index.ts` plus every production TypeScript occurrence beneath
`src/main` and `src/shared`, excluding tests and specs, before editing:

- `registerMobileHandlers` had one production caller, `index.ts`; `ipc/mobile.ts` owns its
  implementation and all mobile IPC registration behavior.
- `loadAgentSessionClaimSigner` had one production caller, `index.ts`;
  `agent-session-claim-identity.ts` retains key creation, hardening, corruption refusal, and
  signer identity.
- `fingerprintOrchestrationPeer` had one production caller, `index.ts`;
  `environment-transport.ts` retains the fingerprint implementation and transport contract.
- `callRuntimeEnvironment` was also consumed by runtime-session scanning, runtime-environment
  IPC, and clipboard runtime image upload. The capability returns the same cached module
  function; those consumers and the routing module are unchanged.
- `resolveEnvironment` and `getPreferredPairingOffer` were also consumed by the
  runtime-environment store/routing/IPC/settings and shared-control paths. The capability
  returns those same module function identities without wrapping or copying their state.
- `resolveAdvertisedPairingEndpoint` was also consumed by `OrcaRuntimeRpcServer`. The
  capability returns the same function while the server retains its direct import.

After the edit, the capability is the sole production value importer of all seven functions
as an aggregate. `index.ts` retains only the type import for
`OrchestrationEnvironmentTransport` and the eager, type-only owner. There was no pre-ready
call to any candidate; module-scope `printServeReady` is first invoked in the headless branch
after runtime RPC construction and mobile registration.

## Identity and ordering

`createRuntimeConnectivityStartupCapability()` returns the imported function references
directly:

- `callRuntimeEnvironment`;
- `fingerprintOrchestrationPeer`;
- `getPreferredPairingOffer`;
- `loadAgentSessionClaimSigner`;
- `registerMobileHandlers`;
- `resolveAdvertisedPairingEndpoint`; and
- `resolveEnvironment`.

The owner stores and returns that same object by identity and throws before installation.
The retained order is:

1. Electron reaches `app.whenReady()`.
2. Existing browser, main-window, terminal, updater, shell, hook, Codex-session,
   telemetry, crash/hang, and account-runtime capabilities are installed in their prior order.
3. The runtime-connectivity capability is imported, created, and installed.
4. Crash-store, browser certificate, Store, account, rate-limit, and other retained startup
   work proceeds unchanged.
5. The orchestration environment transport captures the installed exact functions with the
   original user-data path, selector, method, params, timeout, `undefined` revision, and
   envelope expressions.
6. Runtime-service construction receives the claim signer created at the original point from
   the same two profile-path expressions.
7. Runtime RPC is constructed and immediately assigned as before.
8. Mobile handlers register against that exact server with the original relay-status and
   pending-auth closures before the unpaired-device callback, terminal services, or either
   serve/desktop startup branch.
9. Headless readiness resolves the pairing endpoint only after RPC startup; desktop relay
   construction and provider wiring remain after the window/RPC `Promise.all`.

The capability adds no wrapper, alternate schema, lifecycle, policy, cache, listener, or
error handling.

## Preserved policy and ownership

Pre-ready profile/bootstrap, single-instance, GPU fallback, first breadcrumbs, cross-platform
path normalization, default WSL distro, auth-restart preservation, SSH/remote provider policy,
folder-workspace policy, Git/provider policy, and shutdown ownership remain eager and
unchanged. `awaitRuntimeFileWatcherUnsubscribes` and `clearRuntimeMetadataIfOwned` remain direct
imports used by the existing committed `will-quit` chain; this tranche did not move or wrap
runtime metadata cleanup.

Mobile interface enumeration, Windows firewall behavior, relay status and pairing callbacks,
direct/relay offer selection, E2EE, shared-control routing, Tailscale hints, environment
revision checks, WSL/SSH/relay transport, and runtime identity remain in their existing
modules. No platform check, path expression, RPC/IPC schema, Git command, provider gate,
workspace identifier, or shutdown deadline changed.

## Fresh A/B evidence

The paths below were ephemeral local build directories used during measurement,
not durable artifacts. The recorded hashes, byte counts, manifests, and
conclusions in this report are the portable evidence.

- A artifact: `/tmp/orca-runtime-connectivity-a.B92TPl`
- B artifact: `/tmp/orca-runtime-connectivity-b.uu3FlK`
- A transformed 1,999 main, 17 preload, and 9,181 renderer modules.
- B transformed 2,001 main, 17 preload, and 9,181 renderer modules.
- Both builds emitted only the two existing CSS `::highlight(...)` parser warnings.

Entry hashes:

- A SHA-256:
  `19b988fd4522bc961d6e36dc5e2a807b8a6c086b8c9aae5ced4a5d722c13c018`
- B SHA-256:
  `edc16e8482159539251fe9e26cc62bbf3391f3e244035cbf62c1860b093104d5`

The sorted A and B non-main manifests each contain exactly 786 rows and are byte-identical.
Their SHA-256 is
`f72f00efd1bc891383c4664090bfcea870746c0e8de2e84a8dfa1c2f09b19da2`.

The A main manifest contains 137 rows with SHA-256
`9ce920dd828918677a5eb377ea5112f8e01cbd0959905af58d6ade2b250d7768`.
The B main manifest contains 144 rows with SHA-256
`d3397a4b92ea2f1e411fd1e26c715bddc075510296b6610d49bec0d776c8d611`.

## Emitted chunk and inclusive closure

The retained build emits
`out/main/chunks/runtime-connectivity-startup-capability-CmTkK8-P.js` at 21,120 raw /
5,960 gzip bytes with SHA-256
`10273cd0d99f3f05a9c06d099c4979fb7763bd9658b70121da1ecb8880d3ac50`.
Its eight direct literal relative edges are:

- `./chunk-BTjIgr6M.js`
- `./node-bounded-file-reader-CljE4FRs.js`
- `./agent-session-resume-C5EO_KoU.js`
- `./agent-session-host-authority-8e3ngWcN.js`
- `./ws-outbound-backpressure-queue-0So6s2Fw.js`
- `./runtime-environment-transport-routing-DXhwBdYf.js`
- `./agent-session-claim-identity-D8BsfeXX.js`
- `./pairing-endpoint-FBorgZbp.js`

An inclusive Acorn AST walk followed literal relative import, export, dynamic-import, and
`require` edges. The capability closure visited 134 JavaScript files and validated 731
edges. A separate scan of all 144 emitted-main JavaScript files validated 781 edges. Every
target exists and resolves beneath `out/main`; no edge escapes the emitted directory.

## Budget

The prior Electron-main raw budget was 3,592,999 bytes. Lowering only that value by the
exact measured 133,779-byte improvement produces 3,459,220 bytes:

`3,459,220 - 3,410,984 = 48,236`

Preload and renderer budgets are unchanged.

## Validation

- Fresh A and B `pnpm run build:electron-vite`: passed.
- Focused capability, owner, source-boundary, runtime-service identity, mobile IPC,
  environment request/routing/revision, claim signer, pairing endpoint, mobile pairing/RPC,
  relay/E2EE, runtime RPC/service boundary, desktop ordering, and serve activation suite:
  26 files, 207 tests passed and 2 skipped.
- `pnpm run typecheck:node`: passed.
- Targeted `pnpm exec oxlint --deny-warnings`: passed.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 3,410,984 actual versus 3,459,220
  budgeted main bytes.
- `git diff --check`: passed.

## Residual packaged-ASAR limitation

The fresh production build and inclusive emitted-closure scans validate relative resolution
on this macOS worktree. This tranche did not run packaged-ASAR launch smokes on macOS, Linux,
or Windows; cross-platform packaged launch verification remains unresolved.
