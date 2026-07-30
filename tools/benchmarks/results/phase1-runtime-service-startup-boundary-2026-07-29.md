# Phase 1 OrcaRuntimeService startup boundary — 2026-07-29

**Scope:** Move the concrete `OrcaRuntimeService` implementation behind one startup capability
while preserving its exact construction point, constructor side effects, dependency identities,
global assignment, downstream wiring, desktop/headless readiness, and committed teardown.

## Result

`src/main/index.ts` now type-imports both `OrcaRuntimeService` and
`RuntimeWorktreeLifecycleEvent`. At the original constructor site it awaits exactly one
`./startup/runtime-service-startup-capability` import, then synchronously calls the returned
factory with the original constructor tuple. The same live instance is immediately assigned to
the existing module-level `runtime` slot before every provider, browser, automation, account,
plugin, mobile, RPC, desktop, headless, and teardown consumer.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  6,549,287 | 4,924,069 | -1,625,218 |   1,375,919 |  1,049,526 |    -326,393 |

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

Before the edit, a production-source search excluding tests found `src/main/index.ts` as the sole
value importer and sole production constructor site for `OrcaRuntimeService`. Every other
production consumer imports the class type-only, including:

- runtime RPC server, dispatcher, core, terminal guards, every typed method surface, federation
  control/sync/setup/observation, and worktree teardown;
- core/runtime/PTY/SSH/worktree/plugin/notification/terminal-preview/workspace-cleanup IPC;
- SSH relay sessions and remote Orca CLI;
- main-window attachment, automation headless workspace creation, and agent-browser,
  emulator, and offscreen-browser startup capabilities.

The two direct constructors under `tests/e2e/fixtures` are test clients, not production entry
consumers, and remain unchanged.

After the edit, `src/main/startup/runtime-service-startup-capability.ts` is the sole production
value importer and sole production constructor site. `index.ts` has one dynamic import, one
factory call, no direct constructor, and no eager runtime-service value import.

## Capability interface and identity

The capability is intentionally a constructor-tuple seam:

```ts
type OrcaRuntimeServiceParameters = ConstructorParameters<typeof OrcaRuntimeService>

export function createOrcaRuntimeServiceStartupCapability(
  ...args: OrcaRuntimeServiceParameters
): OrcaRuntimeService
```

It does not export a new dependency bag, duplicate runtime types, wrap the returned service, or
move any composition policy. The module import is awaited at the old constructor point; the
factory itself remains synchronous and returns the direct `new OrcaRuntimeService(...args)`
instance.

The focused factory test records the constructed object and proves Store, StatsCollector, and
the complete dependency object reach the constructor by identity. Source tests prove the exact
same callback expressions remain in `index.ts`:

- profile-scoped agent-session claim signer;
- lazy current local PTY provider and per-connection SSH provider thunks;
- provider PTY state cleanup;
- terminal agent-status ingest and live terminal side-effect renderer send;
- desktop-window status resolver;
- filtered live-agent snapshot, complete provider-session snapshot, and per-pane rows;
- additional managed-Codex AI Vault paths and legacy shared-session resume preparation;
- managed agent-hook environment builder;
- orchestration environment resolve/call transport.

## Constructor side effects

No `OrcaRuntimeService` implementation changed. The constructor still runs synchronously at the
same services-initialization point, preserving:

- per-process `runtimeId` and `startedAt` creation;
- initialization of the runtime-owned orchestration federation, graph, tab, mobile navigation,
  terminal identity/idempotency, PTY stream, subscription, browser, remote-desktop, worktree,
  Git fetch, watcher, reconciliation, waiter, listener, and teardown maps/sets;
- mobile selection hydration from the original Store and installation of the persistence
  listener back to that same Store;
- the original StatsCollector reference and `AgentDetector(stats)` identity;
- agent and provider-session status callback capture;
- shared AI Vault session-source configuration for desktop and serve;
- lazy local/SSH provider resolution, stopped-PTY cleanup, terminal status, terminal side
  effects, hook environment, desktop status, AI Vault resume, agent-session signer, and
  orchestration transport capture;
- registration of the ConPTY DA1 override installer and terminal view-attributes applier against
  this exact live runtime;
- construction of the existing mobile coalescer, terminal-create idempotency owner, and Claude
  agent-teams owner without starting unrelated external work.

Default fallbacks remain untouched: absent orchestration transport and callbacks remain null,
desktop status still defaults to `openable`, and an absent signer still creates the ephemeral
signer from the new runtime ID.

## Startup order and downstream identity

The retained startup sequence is:

1. finish account-service construction and all rate-limit/account resolver configuration;
2. create the orchestration environment transport in `index.ts`;
3. await the single runtime startup-capability module;
4. synchronously construct `OrcaRuntimeService` with the original Store, StatsCollector, signer,
   callbacks, and transport;
5. immediately assign `runtime = runtimeService`;
6. publish current provider-session identities;
7. install the browser guest-state listener;
8. construct AutomationService and attach that same automation singleton;
9. attach the same account/rate-limit services and commit-message environment resolvers;
10. construct and wire the plugin system, worktree lifecycle listener, agent-browser bridge, and
    emulator bridge;
11. construct runtime RPC with the same runtime instance and register mobile handlers;
12. continue unchanged into headless PTY/offscreen/RPC/readiness or desktop core-IPC/window/RPC
    startup.

The automation dispatcher still closes over the same `runtimeService` for new-per-run worktree
creation, existing-workspace terminal launch, worktree lookup, terminal wait, and terminal read.
Core IPC and window attachment still receive the module-level `runtime` assigned from that exact
instance. Runtime RPC, SSH/relay, folder workspaces, browser/emulator/offscreen capabilities,
plugins, account methods, orchestration environment calls, local/WSL/SSH/remote routing, and
Git-provider/Git-2.25 behavior are otherwise unchanged.

Committed `will-quit` still uses the same runtime for agent-browser destruction, offscreen
browser destruction, emulator destruction, runtime ID ownership, RPC stop, watcher settlement,
and the existing bounded teardown barrier. No runtime API, RPC/IPC channel, lifecycle listener,
or shutdown policy moved.

## Emitted capability and packaged-relative closure

The emitted capability is
`out/main/chunks/runtime-service-startup-capability-B_2CmlDx.js`
(1,153,694 raw / 221,753 gzip bytes). `out/main/index.js` loads it through
`./chunks/runtime-service-startup-capability-B_2CmlDx.js`.

The entry specifier is relative, contains no parent traversal, and resolves beneath `out/main`.
The capability has 30 direct static relative dependencies, including the expected `../index.js`
cycle created by existing runtime dependencies on main-owned exports. At load time the entry is
already executing and CommonJS resolves that cycle through the same module instance.

A graph walk from the capability visited 76 JavaScript files and validated 317 relative edges.
Every target exists and stays beneath `out/main`. A separate complete emitted-main scan checked
all 86 JavaScript files and all 358 static relative references with the same result.

## Budget

The prior `electron-main` raw budget was 6,597,523 bytes. Lowering only that budget by the exact
1,625,218-byte reduction produces 4,972,305 bytes and leaves exactly 48,236 bytes (0.980%) of
headroom over the 4,924,069-byte entry. Preload and renderer budgets are unchanged.

## Validation

- Fresh production A and B `pnpm run build:electron-vite`: passed. The baseline transformed
  1,973 main modules and the retained build transformed 1,974; both transformed 17 preload
  modules and 9,181 renderer modules.
- Focused capability and source-boundary suite: passed, 2 files with 5 tests.
- Complete `src/main/runtime` suite, covering OrcaRuntimeService, runtime RPC/core/methods,
  terminal/mobile/session/browser/account/automation/plugin/orchestration behavior, transports,
  worktree lifecycle, and shutdown owners: 188 files passed and 1 skipped; 3,003 tests passed and
  6 skipped.
- Cross-domain core IPC, PTY/mobile/SSH/worktree, provider, account/automation/plugin,
  browser/emulator, AI Vault, window creation/attachment/activation, desktop/serve readiness,
  auth preservation, relaunch, and renderer shutdown suite: passed, 51 files with 950 tests.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint`: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 4,924,069 actual versus 4,972,305 budgeted
  main bytes.
- `git diff --check`: passed with no whitespace errors.

## Warnings and residual limitation

Both production builds contained the same two existing CSS optimizer warnings and no new build
warning:

1. `::highlight(markdown-preview-search-match)` is reported as an unrecognized pseudo-element.
2. `::highlight(markdown-preview-search-active-match)` is reported as an unrecognized
   pseudo-element.

The complete runtime test run also emitted its existing warning that one test process sets
`NODE_TLS_REJECT_UNAUTHORIZED=0`; no test failed.

The production build and dependency-closure checks prove packaged-relative emitted resolution on
this macOS worktree. This tranche did not run a packaged ASAR launch smoke on macOS, Linux, or
Windows. Cross-platform packaged launch verification remains the residual limitation.
