# Phase 1 Store startup boundary — 2026-07-29

**Scope:** Remove the concrete persistence implementation from the eager Electron-main graph while
preserving one shared early path state, mobile pairing migration, Store construction effects,
active-profile identity, downstream service identity, and committed teardown.

## Result

`src/main/index.ts` now type-imports `Store`, eagerly imports only the narrow
`persistence-data-path` API, and awaits one `./startup/store-startup-capability` module at the
former constructor point. The factory synchronously constructs the direct Store with the original
`{ dataFile: activeOrcaProfile.dataFile }` object, and `index.ts` immediately assigns that live
instance to its existing module-level slot.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  4,836,604 | 4,592,251 |   -244,353 |   1,028,806 |    978,843 |     -49,963 |

The preload and all renderer static graphs were byte-for-byte unchanged:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

The sorted SHA-256 manifests for all 786 files outside `out/main` were identical. Each manifest
contained 786 rows / 89,303 bytes and had SHA-256
`e7fed74bb51c30b41084a2a5d052f5dc0773a696552f1a8e051d363ed4be762a`; a direct diff produced no
output.

## Production importer and eager-graph audit

Before the edit:

- `src/main/index.ts` was the sole production Store constructor and value-imported `Store`,
  `initDataPath`, `getCanonicalUserDataPath`, and
  `migrateMobilePairingDataToCanonicalUserDataPath` from `persistence.ts`.
- `src/main/ipc/cli.ts`, `src/main/macos-tcc-prompt-notice.ts`,
  `src/main/serve-update-handoff.ts`, and
  `src/main/ssh/ssh-remote-cli-host-passthrough.ts` value-imported the canonical path getter from
  `persistence.ts`.
- `src/main/ipc/onboarding.ts` value-imported the unrelated `sanitizeOnboardingUpdate` policy. It
  remains unchanged behind the existing deferred aggregate core-IPC boundary.
- The remaining production Store consumers imported it type-only. The eager `index.ts` path
  imports nevertheless made the complete persistence implementation reachable from
  `out/main/index.js`.

After the edit:

- `src/main/startup/store-startup-capability.ts` is the sole production Store value importer and
  constructor site.
- `index.ts` has one type-only Store import, one dynamic capability import, one factory call, and
  no direct constructor.
- All five early path consumers use `persistence-data-path.ts`; none imports the path API from
  `persistence.ts`.
- `persistence.ts` imports the concrete data-file getter from that module and compatibility
  re-exports the three existing public path functions, so source consumers/tests retain their
  contract without a second state owner.

The B build emits the persistence graph as a separate chunk rather than keeping it in the
4,592,251-byte entry.

## Shared path state and migration

`persistence-data-path.ts` owns exactly one pair of captured values: the canonical user-data
directory and its `orca-data.json` path. The behavior is unchanged:

- `initDataPath()` reads `app.getPath('userData')` once at its existing top-level startup point,
  after development-path redirection and before `app.setName`.
- The data-file fallback reads the current Electron user-data path and initializes both values.
- The canonical-directory fallback reads the current Electron user-data path only when no
  directory has been captured.
- A later explicit `initDataPath()` still replaces either fallback with the intended startup
  capture.
- Every path is assembled with `path.join`; source/target equivalence uses `path.resolve`, so
  Windows, macOS, and Linux separator and normalization behavior is preserved.

Mobile credential migration still:

1. no-ops when source and canonical directories resolve identically;
2. derives both paths from the shared registry/keypair filename source of truth;
3. requires the complete source pair;
4. refuses to overwrite when either canonical target exists;
5. creates the canonical directory recursively;
6. copies both files and re-applies `hardenExistingSecureFile` to each target, retaining POSIX
   modes and Windows current-user ACL hardening.

Focused tests prove fallback capture, post-`app.setName` stability, direct/re-export function
identity, shared state, `path.join` output, paired migration, and both hardening calls. The
pre-existing mobile pairing path suite continues to cover all-or-nothing migration, partial
target/source handling, same-directory/fresh-install no-ops, canonical registry/E2EE placement,
and restart discovery.

## Store capability and constructor effects

The capability uses the real constructor tuple and returns the direct object:

```ts
type StoreParameters = ConstructorParameters<typeof Store>

export function createStoreStartupCapability(...args: StoreParameters): Store {
  return new Store(...args)
}
```

No persistence option, schema, default, migration, or listener moved. At the original startup
point the same Store constructor still synchronously:

- captures the active profile data file so later asynchronous writes cannot follow a global path;
- derives profile and legacy terminal scrollback snapshot roots;
- loads the persisted file with the existing default, corruption recovery, rolling backup,
  safeStorage decrypt, and normalization behavior;
- performs pane identity, workspace/folder, project, settings, UI, SSH/WSL/remote, automation,
  plugin, account, notification, and other existing migrations;
- creates the sidecar active-view preference;
- publishes migration-unsupported PTY entries and legacy pane aliases;
- registers PTY migration and agent-hook alias persistence listeners;
- schedules the same deferred save when normalization, load recovery, or folder adaptation
  changed state.

Atomic/durable persistence, encryption, backup rotation, coalesced writes, no-op hashing,
freeze/flush behavior, sidecar caches, schema/defaults, and every Store API remain untouched.

## Startup order and singleton identity

The retained order is:

1. capture persistence, AI Vault cache, profile, stats, and usage paths before `app.setName`;
2. complete Electron readiness setup and resolve the active Orca profile;
3. await the single Store capability;
4. synchronously construct with `activeOrcaProfile.dataFile`;
5. immediately assign module-level `store`;
6. publish the existing `store-loaded` milestone;
7. hydrate WSL fallback settings, install settings listeners, seed live Claude PTYs, apply the app
   icon/proxy/browser session, and initialize telemetry/observability;
8. pass that same Store to usage, account, keybinding, runtime, automation, plugin, IPC/RPC,
   window, desktop, serve, folder-workspace, SSH/WSL/remote, and updater consumers;
9. retain the existing committed `store?.flush()` in `will-quit`.

The added `await` occurs exactly where the direct constructor ran, after active-profile resolution
and before the first Store read. No readiness, renderer, desktop/headless, RPC, or window
consumer can observe an uninitialized Store.

## Emitted chunks and packaged-relative closure

The emitted factory is
`out/main/chunks/store-startup-capability-Bpu3rlAJ.js`
(596 raw / 319 gzip bytes). It statically reaches
`out/main/chunks/persistence-CKwdX_di.js`
(229,323 raw / 47,063 gzip bytes), which contains the deferred persistence implementation.
`out/main/index.js` loads the factory through the relative specifier
`./chunks/store-startup-capability-Bpu3rlAJ.js`.

The capability has 9 direct static relative dependencies. An AST-based walk from it visited 84
JavaScript files and validated 379 relative edges, including the expected existing CommonJS cycle
through `index.js`. A separate complete emitted-main scan checked all 94 JavaScript files and all
422 static relative references. Every target exists and resolves beneath `out/main`; no specifier
escapes through parent traversal.

## Budget

The prior `electron-main` raw budget was 4,884,840 bytes. Lowering only that budget by the exact
244,353-byte reduction produces 4,640,487 bytes and leaves exactly 48,236 bytes (1.050%) of
headroom over the 4,592,251-byte entry. Preload and renderer budgets are unchanged.

## Validation

- Fresh production A and B `pnpm run build:electron-vite`: passed. The baseline transformed
  1,975 main modules and the retained build transformed 1,977; both transformed 17 preload
  modules and 9,181 renderer modules.
- Focused path, migration, capability, import-boundary, startup-order, and affected-importer
  suite: 9 files and 94 tests passed.
- Broad persistence/profile suite: 22 files and 531 tests passed.
- Complete `src/main/runtime` suite, including mobile pairing/E2EE, RPC, relay, account/runtime
  identity, remote routing, folder/worktree lifecycle, and teardown: 188 files passed and 1
  skipped; 3,003 tests passed and 6 skipped.
- Representative account, runtime-home, core/mobile IPC, serve readiness, SSH/remote,
  folder-workspace, window, shutdown, and relaunch suite: 32 files passed; 485 tests passed and 5
  skipped.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint`: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 4,592,251 actual versus 4,640,487
  budgeted main bytes.
- `git diff --check`: passed with no whitespace errors.

## Warnings and remaining limitation

Both production builds contained the same two existing CSS optimizer warnings:

1. `::highlight(markdown-preview-search-match)` is reported as an unrecognized pseudo-element.
2. `::highlight(markdown-preview-search-active-match)` is reported as an unrecognized
   pseudo-element.

The complete runtime test run also emitted its existing warning that one test process sets
`NODE_TLS_REJECT_UNAUTHORIZED=0`; no test failed.

The production build and dependency-closure checks prove packaged-relative emitted resolution on
this macOS worktree. This tranche did not run packaged-ASAR launch smokes on macOS, Linux, and
Windows. Cross-platform packaged launch verification remains the residual limitation.
