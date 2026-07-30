# Phase 1 agent-hook runtime startup boundary — 2026-07-29

**Scope:** Move the remaining eager agent-hook server, WSL relay, managed-installer,
provider-session, migration, and first-work rename identities behind one aggregate app-ready
capability without changing their state ownership or lifecycle ordering.

## Result

`src/main/index.ts` no longer value-imports any of the eleven targeted agent-hook values. It
performs one dynamic import of `./startup/agent-hook-runtime-startup-capability`, installs the
exact returned object in a typed owner, and uses those identities through existing startup,
runtime, window, managed-hook, and shutdown call sites.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  3,697,673 | 3,636,591 |    -61,082 |     785,736 |    769,478 |     -16,258 |

The preload and every renderer static graph were byte-identical:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

The sorted SHA-256 manifests for all 786 files outside `out/main` were identical. Each manifest
contained 786 rows / 89,303 bytes and had SHA-256
`e7fed74bb51c30b41084a2a5d052f5dc0773a696552f1a8e051d363ed4be762a`;
their direct diff was empty.

## Production importer audit

Before this tranche, `index.ts` directly imported:

- `runManagedHookInstallers`;
- `isAgentStatusHooksEnabled`;
- `MANAGED_AGENT_HOOK_INSTALLERS`;
- `removeManagedAgentHooks`;
- `agentHookServer`;
- `createHookProviderSessionInvalidator`;
- `wslHookRelayManager`;
- `maybeAutoRenameBranchOnFirstWork`;
- `rememberBranchRenameFailureOutput`;
- `renameWorktreeFolderOnFirstWork`; and
- `setMigrationUnsupportedPtyListener`.

The complete production audit found these other importers:

- `persistence.ts` consumes the exact server and migration-state modules for persisted pane aliases,
  authority transfer, and persistence listeners. Store construction is behind the retained Store
  startup capability.
- `ipc/pty.ts` consumes the same server, WSL relay manager, enablement predicate, and migration
  state for local/WSL PTY environments, relay provisioning, alias cleanup, and spawn metadata. It
  is behind the retained terminal-runtime capability.
- agent-hooks, agent-pane-authority, settings, and worktree IPC consume the same server, migration,
  enablement, and rename-failure modules behind the retained core-IPC registry.
- `ssh/ssh-relay-session.ts` consumes the same server and enablement predicate for remote ingestion,
  connection cleanup, and SSH status gating.
- `runtime/orca-runtime.ts` consumes the same managed-hook control module for live setting changes
  behind the retained runtime-service capability.
- `wsl-hook-relay-deps.ts` closes over the same server for coordinates, endpoint paths, and remote
  relay ingestion.

The terminal-runtime and main-window capabilities may evaluate some shared modules before this
aggregate loads, but module caching ensures the aggregate returns those exact existing singleton
objects. No replacement server, relay manager, status map, listener registry, timer, or installer
array is created.

## Lifecycle and order audit

There is no supported pre-app-ready hook event. Before readiness, `index.ts` only defines callback
functions; Store hydration, terminal startup, runtime construction, window creation, PTY
registration, SSH relay construction, and managed-hook reconciliation all occur inside or after
`app.whenReady`.

The retained order is:

1. Browser, main-window, terminal-runtime, updater-runtime, and desktop-shell capabilities load
   and install.
2. The agent-hook aggregate loads once and its exact object is installed in the owner.
3. Browser setup and certificate handling continue, followed by CLI/WSL reconciliation.
4. Store construction and hydration run with the same server singleton already available for pane
   alias restoration and migration state.
5. Status and provider-session subscriptions are attached to the same server; their snapshots,
   provider-session invalidation, AgentAwake updates, and mobile publication order are unchanged.
6. Runtime construction receives the same terminal-status ingestion callback, live status and
   provider-session snapshot callbacks, and gated PTY environment builder.
7. Plugin enriched-status subscription and managed-hook install/remove reconciliation retain their
   original positions.
8. Terminal startup invokes the same first-window service aggregate. The hook server still starts
   only when enabled, with the original packaged/dev environment, canonical Electron userData
   argument, dev endpoint namespace, milestone logging, and fail-open error callback.
9. Desktop loads core IPC before opening its window while headless serve waits for its existing
   PTY/WSL barriers; both modes share the same live hook server and relay identities.

The owner throws if a required consumer runs before installation. `will-quit` uses the optional
owner read because Electron can theoretically quit before readiness. Before installation neither
singleton could have started, so the no-op is safe; after installation it calls the exact
`agentHookServer.stop` and `wslHookRelayManager.disposeAll` methods at the original positions.

## Identity and behavior preservation

The capability returns original exports without wrapping them. This preserves:

- status, provider-session, enriched-status, pane-authority, prompt-interaction, replay, and
  migration-unsupported state;
- live snapshots, pane rows, terminal ingestion, SSH remote ingestion, and connection cleanup;
- PTY hook coordinates, current endpoint-file lookup, WSL guest endpoint/overlay lookup, relay
  install recovery, and disposal;
- first-work branch rename gating, upstream probes, unique-name resolution, failure-output
  storage, and notification order;
- folder-workspace title/folder rename behavior, `moveWorktree` callback identity, workspace
  identity migration, and runtime notifications;
- managed installer array identity, enablement checks, install/remove policy, telemetry, and
  error timing;
- Codex real-home and managed-home hook checks before launch/resume;
- same-window listener detach/replay during close and macOS dock recreation; and
- desktop, headless serve, SSH, remote, WSL, and local PTY behavior.

No hook protocol, IPC/RPC channel, Git command, resource owner, telemetry event, or error policy
changed. First-work Git execution continues through the existing host-aware providers, so folder
workspaces, SSH/remote, WSL, Git providers, and the Git 2.25 baseline remain unchanged.

## Emitted chunks and dependency closure

The retained build emits
`out/main/chunks/agent-hook-runtime-startup-capability-Sk-DFQKy.js` at 15,834 raw / 4,536 gzip
bytes with SHA-256
`769ad9945eb09b6c13a1ca62c327a44ea892f84c2f9b72fdd4b6b42ed9128c7e`.
Its 19 static relative dependencies are:

- `./chunk-BTjIgr6M.js`
- `./win32-utils-DtAFUr2N.js`
- `./fs-utils-D5115c5m.js`
- `./tui-agent-config-DMkBaphp.js`
- `./execution-host-DX_Sa8Eh.js`
- `./wsl-BuuvEEky.js`
- `./hook-service-BPcIgznJ.js`
- `./agent-session-resume-C5EO_KoU.js`
- `./stable-pane-id-CMF3MDnN.js`
- `./grok-session-paths-D98Yfwjz.js`
- `./codex-app-server-client-C9VhVlb_.js`
- `./managed-agent-hook-controls-B0Ra2eJ_.js`
- `./codex-home-paths-C8xszHr4.js`
- `./worktree-id-zL7_Bkk5.js`
- `../index.js`
- `./macos-tailscale-dns-diagnostic-WXXhbYHn.js`
- `./agent-failure-output-CQ28WguA.js`
- `./branch-rename-failure-output-V43lcPT1.js`
- `./commit-message-agent-environment-DffRi7dm.js`

The `../index.js` edge is the bundler's expected shared-entry cycle and preserves shared
composition-root callbacks rather than duplicating state.

An Acorn AST walk of the capability closure visited 119 JavaScript files and validated 639
literal relative import, export, dynamic-import, and require edges. A separate full `out/main`
scan checked all 129 JavaScript files and 687 relative edges. Every resolved target exists beneath
`out/main`; no edge escapes the emitted directory.

The A entry SHA-256 was
`12659e2bc9a122e5d9e62a34e05aa8edab6e5c51ef2606f63400c5d5995b6aed`; the retained B entry
SHA-256 is `f215df1d66b8eea478f2910eb8ec0b2c697a218397c2384583c0f982569a5839`.

## Budget

The prior Electron-main raw budget was 3,745,909 bytes. Lowering only that budget by the exact
61,082-byte reduction produces 3,684,827 bytes and leaves exactly 48,236 bytes of headroom over
the 3,636,591-byte entry. Preload and renderer budgets are unchanged.

## Validation

- Fresh production A and final B `pnpm run build:electron-vite`: passed; main transforms changed
  from 1,989 to 1,991, preload remained 17 modules, and renderer remained 9,181 modules.
- Focused capability, owner, source-boundary, server, Claude statusline, Codex subagent, Grok
  discovery, provider-session, pane-authority, interactive-question, first-work branch/folder,
  failure-output, migration, managed-hook installer/runtime/lock/filesystem/stdin/timeout, WSL
  guest/relay/recovery/sentinel, hook IPC, PTY barrier/management, persistence hydration, SSH relay
  hook/session, runtime mobile snapshot, full runtime, first-window startup, desktop/serve
  activation, and shutdown coverage: 40 files / 1,868 passed and 2 skipped.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint --deny-warnings`: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 3,636,591 actual versus 3,684,827 budgeted
  Electron-main bytes.
- `git diff --check`: passed with no whitespace errors.

Both production builds emitted the same existing CSS optimizer warnings for
`::highlight(markdown-preview-search-match)` and
`::highlight(markdown-preview-search-active-match)`.

## Remaining limitation

The production build and closure scans validate emitted relative dependency resolution on this
macOS worktree. This tranche did not run packaged-ASAR launch smokes on macOS, Linux, and Windows;
cross-platform packaged launch verification remains explicitly unresolved.
