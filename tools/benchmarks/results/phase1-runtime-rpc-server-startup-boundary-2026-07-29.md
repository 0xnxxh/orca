# Phase 1 OrcaRuntimeRpcServer startup boundary — 2026-07-29

**Scope:** Move the concrete `OrcaRuntimeRpcServer` graph behind one startup capability while
preserving constructor timing, option expressions and identities, immediate global assignment,
mobile/relay consumers, desktop and headless readiness, and committed teardown.

## Result

`src/main/index.ts` now type-imports `OrcaRuntimeRpcServer`. At the original constructor point,
after serve-option resolution and canonical pairing-data migration, it awaits exactly one
`./startup/runtime-rpc-server-startup-capability` import and synchronously invokes the factory
with the original options object. The returned direct instance is immediately assigned to the
existing module-level `runtimeRpc` slot before every downstream consumer.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  4,924,069 | 4,836,604 |    -87,465 |   1,049,526 |  1,028,806 |     -20,720 |

The preload and all renderer static graphs were byte-for-byte unchanged:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

A SHA-256 manifest comparison matched all 786 emitted files outside `out/main`, covering the
complete preload and renderer output.

## Importer and constructor audit

Before the edit, production-source search excluding tests found `src/main/index.ts` as the sole
value importer and sole constructor site. `src/main/ipc/mobile.ts` and
`src/main/runtime/relay/desktop-relay-service.ts` already imported the server type-only.
`src/main/server/serve-readiness.ts` also type-imported only
`PairingOfferUnavailableReason`. Runtime RPC unit and integration tests retain their deliberate
direct constructors.

After the edit, `src/main/startup/runtime-rpc-server-startup-capability.ts` is the sole production
value importer and constructor site. `index.ts` has no eager value import or direct constructor,
and contains exactly one dynamic capability import and one factory call.

## Capability contract and constructor effects

The capability is intentionally a one-argument constructor-tuple seam:

```ts
type OrcaRuntimeRpcServerParameters = ConstructorParameters<typeof OrcaRuntimeRpcServer>

export function createOrcaRuntimeRpcServerStartupCapability(
  options: OrcaRuntimeRpcServerParameters[0]
): OrcaRuntimeRpcServer
```

It returns `new OrcaRuntimeRpcServer(options)` directly. It introduces no alternate option
schema, wrapper, policy, or lifecycle owner.

Construction still runs synchronously at the former site and preserves these effects:

- creates the process-scoped random RPC authentication token;
- constructs the `RpcDispatcher` with the exact runtime singleton;
- captures the canonical user-data path, PID/platform defaults, WebSocket gate and port policy,
  bundled web-client root, keepalive/admission limits, and metadata ownership cadence;
- constructs `RelayRevokeOutbox` with that same canonical path, including its existing
  synchronous load, secure-file hardening, JSON validation, and fail-empty fallback;
- initializes the existing transport, pairing, relay, long-poll, abort-controller, listener,
  and binary-stream state without starting transports.

No code in `runtime-rpc.ts` changed. Socket sweeping, Unix/named-pipe setup, WebSocket admission,
pairing registry and E2EE initialization, metadata publication/ownership reclaim, keepalive,
long-poll caps, relay binding, and stop semantics remain owned by `start()`/`stop()` exactly as
before.

## Option identity and startup order

The complete options expression remains in `index.ts`:

- `runtime` is the same immediately assigned `OrcaRuntimeService` singleton;
- `userDataPath` remains `getCanonicalUserDataPath()`;
- `enableWebSocket` remains `true`;
- E2E still uses port `0` unless a validated `ORCA_E2E_RUNTIME_WS_PORT` override is present;
- non-E2E development still pins port `6769`;
- an explicit serve port still sets both `wsPort` and `preferPinnedWsPort: true`;
- `webClientRoot` remains `getBundledWebClientRoot()`.

The retained ordering is:

1. validate E2E WebSocket input and derive the development port;
2. resolve `ServeOptions`, preserving the existing exit-on-invalid-options path;
3. migrate pairing data from Electron's late user-data path to the canonical path;
4. await the single startup capability and construct the server with the original expression;
5. immediately assign the live server to module-level `runtimeRpc`;
6. register mobile IPC with the same relay-status and pending-auth callbacks;
7. install the unpaired-device failure callback;
8. start terminal runtime startup services and install macOS activation wiring;
9. continue into the unchanged serve or desktop startup branch.

Headless serve still awaits the managed-WSL and local-PTY barriers, registers headless PTY,
conditionally attaches the offscreen backend, publishes the empty window graph, awaits
`runtimeRpc.start()`, settles activation, installs signal handlers, starts automations, and only
then publishes readiness. Desktop still starts the first window and the same server in
`Promise.all`, reports RPC startup failure against that window, and only afterward attempts
configured relay startup.

The same server remains passed by identity to mobile handlers and `DesktopRelayService`. Relay
status, pending-auth, unpaired-device, pairing-provider, terminal, activation, WebSocket endpoint,
and runtime metadata consumers are unchanged. `before-quit` still clears the pairing provider;
`will-quit` still calls `stop()` before clearing metadata owned by the same runtime ID and PID.

## Platform, SSH, and folder-workspace compatibility

This change moves only module reachability. Platform checks, Windows named-pipe behavior,
Unix-socket sweeping, WSL startup barriers, SSH/remote runtime routing, relay transport, folder
workspace identifiers, and Git-worktree routing remain in their existing owners. No Git command,
provider selection, IPC/RPC schema, authentication rule, or filesystem path expression changed.

## Emitted capability and packaged-relative closure

The emitted capability is
`out/main/chunks/runtime-rpc-server-startup-capability-Dh0h-y00.js`
(90,302 raw / 22,416 gzip bytes). `out/main/index.js` loads it through the relative specifier
`./chunks/runtime-rpc-server-startup-capability-Dh0h-y00.js`.

The entry specifier contains no parent traversal and resolves beneath `out/main`. The capability
has 17 direct static relative dependencies, including the expected `../index.js` cycle created by
existing RPC dependencies on main-owned exports. CommonJS resolves that cycle through the already
executing entry module.

An AST-based graph walk from the capability visited 77 JavaScript files and validated 335
relative edges. Every target exists and stays beneath `out/main`. A separate complete emitted-main
scan checked all 87 JavaScript files and all 376 static relative references with the same result.

## Budget

The prior `electron-main` raw budget was 4,972,305 bytes. Lowering only that budget by the exact
87,465-byte reduction produces 4,884,840 bytes and leaves exactly 48,236 bytes (0.997%) of
headroom over the 4,836,604-byte entry. Preload and renderer budgets are unchanged.

## Validation

- Fresh production A and B `pnpm run build:electron-vite`: passed. The baseline transformed
  1,974 main modules and the retained build transformed 1,975; both transformed 17 preload
  modules and 9,181 renderer modules.
- Focused capability, source-boundary, and inherited runtime-service boundary suite: passed,
  3 files with 10 tests.
- Complete `src/main/runtime` suite, covering the full `runtime/rpc` tree, runtime RPC server,
  mobile pairing/E2EE, relay, remote runtime, orchestration, terminal, browser, account,
  automation, plugin, worktree, and teardown behavior: 188 files passed and 1 skipped; 3,003
  tests passed and 6 skipped.
- Representative mobile IPC, remote-environment routing, SSH notification routing,
  desktop/serve activation and readiness, core-IPC/offscreen/relay startup boundaries, macOS
  activation, headless workspace, updater serve handoff, shutdown checkpoint, and relaunch
  suite: 18 files and 115 tests passed.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint`: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 4,836,604 actual versus 4,884,840
  budgeted main bytes.
- `git diff --check`: passed with no whitespace errors.

## Warnings and residual limitation

Both production builds contained the same two existing CSS optimizer warnings:

1. `::highlight(markdown-preview-search-match)` is reported as an unrecognized pseudo-element.
2. `::highlight(markdown-preview-search-active-match)` is reported as an unrecognized
   pseudo-element.

The complete runtime test run also emitted its existing warning that one test process sets
`NODE_TLS_REJECT_UNAUTHORIZED=0`; no test failed.

The production build and dependency-closure checks prove packaged-relative emitted resolution on
this macOS worktree. This tranche did not run packaged-ASAR launch smokes on macOS, Linux, and
Windows. Cross-platform packaged launch verification remains the residual limitation.
