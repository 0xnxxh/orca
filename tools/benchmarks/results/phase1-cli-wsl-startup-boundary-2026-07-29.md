# Phase 1 CLI/WSL startup boundary — 2026-07-29

**Scope:** Remove the CLI installer, packaged-Linux bare dispatcher, and managed WSL
reconciliation implementation from the eager Electron-main graph while preserving the original
platform gates, reconciliation barrier, serve behavior, and CLI ownership rules.

## Result

`src/main/index.ts` now awaits one `./startup/cli-wsl-startup-capability` module immediately after
`app.setName`. One aggregate capability supplies the original reconciliation function, constructs
the original `CliInstaller` only for the existing serve-only install path, and supplies the
original Linux dispatcher function.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  4,592,251 | 4,565,102 |    -27,149 |     978,843 |    972,143 |      -6,700 |

The preload and all renderer static graphs were byte-for-byte unchanged:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

The sorted SHA-256 manifests for all 786 files outside `out/main` were identical. Each manifest
contained 786 rows / 87,731 bytes and had SHA-256
`68ba944c45d80c14c538180894eade74a3897e120fa0bf6a89fbb60500a3ab01`; a direct diff produced no
output.

## Production importer audit

Before the edit, `src/main/index.ts` eagerly value-imported:

- `CliInstaller` from `cli-installer.ts`;
- `installLinuxBareOrcaDispatcher` from `linux-bare-orca-dispatcher.ts`;
- `reconcileManagedWslCliRegistrations` from
  `wsl-cli-registration-reconciliation.ts`.

The reconciliation module also imports `CliInstaller`, `WslCliInstaller`, the registration
registry, and the serialized registration operation. The dispatcher imports the shared bundled
launcher and AppImage wrapper implementation from the CLI installer graph.

Other production consumers remain unchanged:

- `wsl-cli-installer.ts` constructs `CliInstaller` for its default host installer.
- `linux-terminal-orca-cli-shim.ts` consumes the dispatcher's script builder through PTY IPC.
- `ipc/cli.ts` consumes the installer and WSL registration APIs behind the already-deferred
  aggregate core-IPC boundary.

After the edit, `index.ts` has no eager import from any of the three target modules and no direct
`CliInstaller` construction. `cli-wsl-startup-capability.ts` is their single aggregate startup
import seam. It uses `ConstructorParameters<typeof CliInstaller>` so the concrete installer
options remain checked without exporting a new broad dependency bag.

## Lifecycle and platform behavior

The retained startup order is:

1. Electron readiness, certificate setup, app model ID, and `app.setName` complete.
2. The one aggregate CLI/WSL capability loads.
3. Managed WSL status becomes `pending`.
4. Reconciliation receives the same `app.isPackaged`, canonical user-data path, and app version.
5. The same per-distro failed/repaired messages run; completion sets `settled`, while discovery
   failure sets `failed` and retains the original warning.
6. The exact reconciliation promise is passed once to
   `createWslCliReconciliationStartupBarrier`.
7. First-window startup and headless serve continue to consume the same bounded two-second
   barrier; desktop startup remains independent of unbounded reconciliation.

The reconciliation implementation still returns immediately without WSL discovery unless the
host is packaged Windows. Candidate selection, host launcher probing, per-distro serialization,
two-worker repair concurrency, ownership observations, error isolation, and registry paths remain
owned by their existing modules.

In serve mode:

- CLI auto-install remains after RPC start and signal-handler setup, before readiness publication,
  and remains limited to macOS/Linux.
- The capability constructs one live `CliInstaller` with the same options object. Its
  `privilegedRunner` still rejects with
  `serve CLI auto-install must not request administrator privileges`, preventing a headless admin
  prompt.
- Status/result logging and the best-effort error warning are unchanged; Windows remains excluded.
- The bare `orca` dispatcher remains gated on packaged Linux plus `process.resourcesPath`, and
  receives the same resources path.
- AppImage targeting, bundled `orca-ide` resolution, foreign-file protection, managed marker,
  `~/.local/bin` location, and executable mode remain in the unchanged dispatcher implementation.

No Store, runtime, folder-workspace, SSH/remote routing, PATH, launcher, Git-provider, or Git 2.25
behavior changed. Remote serve still performs only the host-platform work admitted by the same
runtime gates.

## Capability identity and source boundaries

The capability returns the imported reconciliation and dispatcher functions by identity.
`installServeCli` synchronously constructs the original live `CliInstaller` and invokes
`install()` on that same instance. Focused tests verify the exact option object identities,
constructor/instance identity, one dynamic import/factory, load position, status/error branches,
the shared reconciliation promise, both barrier consumers, serve-only gates, privileged-runner
rejection, dispatcher inputs, and readiness order.

The existing desktop startup ordering test was updated only to anchor reconciliation at the new
aggregate capability call; all of its barrier and desktop-independence assertions remain intact.

## Emitted chunk and relative dependency closure

The B build emits
`out/main/chunks/cli-wsl-startup-capability-DTv3bK3F.js`
(3,610 raw / 1,271 gzip bytes; SHA-256
`19c0e3402a2b576bf96cfe09ab7df200128f8d4b7c8d56a271d654987ef1e990`).
Its five direct static relative dependencies are:

- `./win32-utils-DtAFUr2N.js`
- `./fs-utils-D5115c5m.js`
- `./wsl-BkPuEmkc.js`
- `../index.js`
- `./wsl-cli-installer-Crb-rbWF.js`

The `../index.js` edge is the bundler's expected shared-module cycle; the capability remains
dynamically entered from `index.js`.

An AST-based walk from the capability visited 87 JavaScript files and validated 401 relative
edges. A separate complete emitted-main scan checked all 97 JavaScript files and all 446 literal
relative `require`, `import`, and export references. Every target exists and resolves beneath
`out/main`; no specifier escapes through parent traversal.

## Budget

The prior `electron-main` raw budget was 4,640,487 bytes. Lowering only that budget by the exact
27,149-byte reduction produces 4,613,338 bytes and leaves exactly 48,236 bytes of headroom over
the 4,565,102-byte entry. Preload and renderer budgets are unchanged.

## Validation

- Fresh production A and B `pnpm run build:electron-vite`: passed. The baseline transformed
  1,977 main modules and the retained build transformed 1,978; both transformed 17 preload
  modules and 9,181 renderer modules.
- Complete `src/main/cli` plus CLI IPC, WSL installer/registry/reconciliation/serialization,
  reconciliation barrier, serve readiness/stdout/update handoff, headless updater/automation,
  desktop startup ordering, runtime RPC failure, SSH/remote CLI routing, orchestration CLI,
  relaunch, process-parent shutdown, window quit policy, and WSL host coverage: 33 files passed
  and 1 skipped; 273 tests passed and 3 skipped.
- Focused capability and source-boundary subset: 2 files / 8 tests passed.
- `pnpm run typecheck:node`: passed with no diagnostics.
- Targeted `pnpm exec oxlint`: passed with no diagnostics.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed at 4,565,102 actual versus 4,613,338 budgeted
  main bytes.
- `git diff --check`: passed with no whitespace errors.

## Warnings and remaining limitation

Both production builds emitted the same existing CSS optimizer warnings for
`::highlight(markdown-preview-search-match)` and
`::highlight(markdown-preview-search-active-match)`.

The production build and dependency-closure checks prove packaged-relative emitted resolution on
this macOS worktree. This tranche did not run packaged-ASAR launch smokes on macOS, Linux, and
Windows. Cross-platform packaged launch verification remains the residual limitation.
