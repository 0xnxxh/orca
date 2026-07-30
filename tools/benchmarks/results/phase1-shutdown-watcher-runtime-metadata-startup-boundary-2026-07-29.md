# Phase 1 shutdown watcher/runtime-metadata startup boundary — 2026-07-29

**Scope:** Move the five remaining watcher shutdown, runtime-file drain,
runtime-metadata ownership, and quit-deadline values behind one exact-identity app-ready
capability while preserving their existing resource and lifecycle owners.

## Result

`src/main/index.ts` now dynamically imports
`./startup/shutdown-watcher-runtime-metadata-startup-capability` immediately after installing
the retained runtime-connectivity capability. It installs the exact aggregate before any
filesystem IPC handler, worktree-base watcher, runtime file watcher, runtime RPC transport, or
runtime metadata writer can be reached.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  3,410,984 |   776,873 | -2,634,111 |     720,505 |    174,092 |    -546,413 |

The preload and renderer outputs remained byte-identical:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

## Production importer and lifecycle audit

The pre-edit audit covered every production occurrence beneath `src/main` and `src/shared`:

- `closeAllWatchers`, `disposeWorktreeBaseDirectoryWatchers`,
  `awaitRuntimeFileWatcherUnsubscribes`, `clearRuntimeMetadataIfOwned`, and
  `settleTeardownWithinDeadline` each had exactly one production caller in
  `src/main/index.ts` outside its defining module.
- `filesystem-watcher.ts` retains all local, WSL, SSH, Parcel native/forked watcher maps,
  installation generations, capacity retries, dormant/rearm state, pending unsubscribe
  tracking, timers, provider registration, error reporting, and cleanup implementation.
- `worktree-base-directory-watcher.ts` retains local polling, SSH subscriptions, generation,
  pending synchronization, notification timers, head identity refresh, and warning cleanup.
- `orca-runtime-files.ts` retains runtime file watcher leases, SSH rearm, physical stop
  tracking, and the pending unsubscribe set.
- `runtime-metadata.ts` retains the canonical metadata path, read/write/remove operations, and
  the PID plus runtime-ID ownership comparison.
- `quit-teardown-deadline.ts` retains its 20-second default, unref'ed timer, all-settled race,
  and pending-name result.

Filesystem watcher handlers are registered only through the deferred core IPC registry after
desktop startup reaches `openMainWindow()`. Worktree-base synchronization is attached from
main-window services and later settings/repository events. Runtime file watches require the
runtime service and RPC methods. Runtime metadata is written only when the runtime RPC server
starts. All of those reachable creation paths occur after the new capability installation in
both desktop and headless serve startup.

No local/WSL/SSH/remote path policy, folder-workspace routing, Git/provider behavior, mobile or
relay wiring, i18n/telemetry policy, platform check, watcher key, metadata path, shutdown
deadline, or packaged relative import changed.

## Exact identity and early-quit proof

`createShutdownWatcherRuntimeMetadataStartupCapability()` returns the five original imported
function references directly. The owner stores and returns the installed object by identity,
throws on required access before installation, and exposes one typed optional getter for the
eager `will-quit` handler.

Pre-install quit is resource-free:

1. Electron registers `before-quit` and `will-quit` eagerly, so quit can be requested while the
   app-ready dynamic imports are still pending.
2. Before capability installation, no core filesystem IPC handler or main-window service has
   registered, no runtime RPC instance exists, and no candidate-owned watcher or metadata
   resource can have been created.
3. `shutdownWatchersOnce()` therefore returns a resolved promise when the optional owner is
   absent. It does not set `watcherShutdownPromise` or `watcherShutdownDone`; an installation
   that becomes visible later cannot be hidden by a memoized pre-install no-op.
4. The optional deadline path resolves to the same empty pending-name result (`[]`) because
   every candidate teardown is resource-free. The `runtimeRpc` branch is absent, so runtime
   watcher drain and owned metadata clear remain no-ops.
5. After installation, the optional getter returns the exact aggregate. Watcher cleanup enters
   the original promise memoization, and any existing `runtimeRpc` uses the required fail-closed
   getter for drain and metadata clear, so installed cleanup is not silently skipped.

The retained two-pass shutdown order remains:

1. `before-quit` fences relay/mobile work and disposes awake/rate-limit state.
2. `will-quit` stops plugin, hook, stats, browser, emulator, and PTY resources in the original
   order.
3. `shutdownWatchersOnce()` starts and remains memoized for installed resources.
4. The first pass prevents default and captures `process.pid` plus
   `runtime?.getRuntimeId()` synchronously.
5. RPC stop completes, runtime file watcher unsubscribes drain, then owned metadata is cleared
   using `getCanonicalUserDataPath()`, the captured PID, and the captured runtime ID.
6. The unchanged named deadline members cover daemon, runtime RPC, watchers, emulator, and
   plugin hosts.
7. Telemetry and observability shut down before setting the two-pass guard and calling
   `app.quit()` again.

Update-quit selection, daemon disconnect versus dev-parent shutdown, watcher rejection
logging, deadline warning behavior, and the second-pass guard are unchanged.

## Fresh A/B evidence

The paths below were ephemeral local build directories used during measurement,
not durable artifacts. The recorded hashes, byte counts, manifests, and
conclusions in this report are the portable evidence.

- A artifact: `/tmp/orca-shutdown-watcher-a.D2U64x`
- B artifact: `/tmp/orca-shutdown-watcher-b.WhEXdD`
- A transformed 2,001 main, 17 preload, and 9,181 renderer modules.
- B transformed 2,003 main, 17 preload, and 9,181 renderer modules.
- Both builds emitted only the two existing CSS `::highlight(...)` parser warnings.

Entry SHA-256:

- A:
  `edc16e8482159539251fe9e26cc62bbf3391f3e244035cbf62c1860b093104d5`
- B:
  `6e75b9d4862f1219c23f16d6c920004167d7dae1995498caaacc5354a9d8f8fd`

The sorted A and B non-main manifests use paths relative to `out`, contain exactly 786 rows,
and are byte-identical. Their SHA-256 is
`68ba944c45d80c14c538180894eade74a3897e120fa0bf6a89fbb60500a3ab01`.

The A relative-path main manifest contains 144 rows with SHA-256
`67b2600ac0301057f0353e4208dc591309c5d9bd63c9d821cc768e1f3b9ca3d9`.
The B main manifest contains 184 rows with SHA-256
`3576805e0f10c1c6c3ca473257901f824326f4e2b1a0a224bbb50e72eb28a5f2`.

## Emitted chunk and inclusive closure

The retained build emits
`out/main/chunks/shutdown-watcher-runtime-metadata-startup-capability-DkU2r7j5.js` at 3,391
raw / 1,376 gzip bytes with SHA-256
`94aed94476aadb13ca725a18c2dffff86aebaf9c5a7f6111229fcc5ac4e32877`.
It has 44 direct literal-relative edges, including the exact emitted filesystem watcher,
worktree-base watcher, runtime-files, runtime-metadata, Parcel watcher-process, local/SSH PTY,
WSL, worktree, hook, Git-dispatch, and shared policy chunks.

An inclusive Acorn AST walk followed literal relative import, export, dynamic-import, and
`require` edges:

- A complete emitted main: 144 JavaScript files and 781 validated edges.
- B capability closure: 174 JavaScript files and 1,132 validated edges.
- B complete emitted main: 184 JavaScript files and 1,183 validated edges.

Every referenced target existed and resolved beneath the copied `out/main`; no edge escaped
the emitted directory.

## Budget

The prior Electron-main raw budget was 3,459,220 bytes. Lowering only that value by the exact
2,634,111-byte improvement produces 825,109 bytes:

`825,109 - 776,873 = 48,236`

Preload and renderer budgets are unchanged.

## Tests and validation

- Fresh A and B `pnpm run build:electron-vite`: passed.
- Focused exact-identity capability, fail-closed/optional owner, source-boundary, early-quit,
  filesystem watcher local/remote/WSL unsubscribe/rearm, worktree-base watcher, runtime-file
  watcher/SSH rearm, runtime metadata/ownership, quit-deadline, desktop ordering, runtime
  RPC/service, terminal, telemetry, crash/hang, desktop-shell, and offscreen shutdown suite:
  22 files and 238 tests passed.
- `pnpm run typecheck:node`: passed.
- Targeted `pnpm exec oxlint --deny-warnings`: passed.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 776,873 actual versus 825,109 budgeted
  main bytes.
- `git diff --check`: passed.

No existing boundary assertion required maintenance; only the newly added boundary coverage
refers to the five qualified capability identifiers.

## Residual packaged-ASAR limitation

The fresh production builds and inclusive emitted-closure scans validate relative resolution
on this macOS worktree. This tranche did not run packaged-ASAR launch smokes on macOS, Linux,
or Windows; cross-platform packaged launch verification remains unresolved.
