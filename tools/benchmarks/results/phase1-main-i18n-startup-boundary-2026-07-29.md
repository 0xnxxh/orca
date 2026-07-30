# Phase 1 main-process i18n startup boundary audit — 2026-07-29

**Result:** Candidate rejected and reverted because the fresh production B entry was larger
than A. No main-process i18n capability, owner, source-boundary test, index qualification, prior
boundary assertion, or budget edit was retained.

## Candidate scope

The measured candidate moved only the three direct `src/main/index.ts` values from
`./i18n/main-i18n`:

- `ensureMainI18n`;
- `setMainPluginLanguagePacks`; and
- `setMainUiLanguage`.

It dynamically imported one `main-i18n-startup-capability` immediately after the retained
runtime-connectivity capability, returned the three original function identities, and installed
the result in a typed fail-closed owner. Initial initialization used the exact installed object;
the plugin content-pack callback used the owner and retained its original language-pack list,
settings language, and menu-rebuild expressions.

The candidate added narrow capability, owner, and source-boundary coverage. It also temporarily
updated only the existing plugin-system boundary assertion from the direct
`setMainPluginLanguagePacks(` identifier to the owner-qualified identifier. That assertion
maintenance and every candidate source/test file were reverted after measurement.

## Production importer and lifecycle audit

The audit covered all production TypeScript occurrences beneath `src/main` and `src/shared`,
excluding tests and specs:

- `src/main/index.ts` directly imports the three candidate values.
- `src/main/ipc/settings.ts` directly imports `setMainUiLanguage` and awaits it in the existing
  settings-update handler.
- `src/main/menu/register-app-menu.ts` directly imports `translateMain` for application-menu
  labels.
- `src/main/runtime/runtime-rpc-startup-failure.ts` directly imports `translateMain` for
  startup-failure dialog copy and remains eagerly reachable from `index.ts`.
- `src/main/tray/system-tray.ts` directly imports `translateMain` for tray labels and tooltips.
- `src/main/window/createMainWindow.ts` directly imports `translateMain` for window-owned
  notification copy.

All importers resolve the same cached `main-i18n` module and therefore the same
`i18next.createInstance()` result, `initialized` flag, plugin-language-pack array, registered
language set, lazy backend, and locale-loader table. Moving only the three `index.ts` references
cannot remove `main-i18n` from the eager entry because the preserved runtime-RPC failure module
still brings `translateMain` into that graph.

The candidate kept `translateMain`, settings IPC, menus, dialogs, tray, and window consumers at
their existing owners. It also preserved:

- one i18next instance and module cache;
- lazy `es`, `ja`, `ko`, and `zh` catalog imports;
- English default-value fallbacks and pseudo-localization;
- plugin language-pack replacement and resource-bundle registration;
- UI-language selection, system-locale fallback, and plugin-locale fallback;
- plugin content-pack change -> language change -> menu rebuild behavior;
- `services-initialized` -> `ensureMainI18n` -> initial language ->
  `i18n-ready` -> menu registration ordering; and
- existing promise rejection/error propagation.

No pre-ready bootstrap/profile, platform, Store/account, runtime, mobile, relay, shutdown,
macOS/Linux/Windows, WSL, SSH/remote, folder-workspace, Git/provider, or plugin-provider behavior
was moved.

## Fresh A/B measurement

| Surface       |     A raw |     B raw | Raw change |  A gzip |  B gzip | Gzip change |
| ------------- | --------: | --------: | ---------: | ------: | ------: | ----------: |
| Electron main | 3,410,984 | 3,411,700 |   **+716** | 720,505 | 720,607 |    **+102** |

The paths below were ephemeral local build directories used during measurement,
not durable artifacts. The recorded hashes, byte counts, manifests, and
conclusions in this report are the portable evidence.

- A artifact: `/tmp/orca-main-i18n-a.298cGW`
- B artifact: `/tmp/orca-main-i18n-b.Tkjj42`
- A transformed 2,001 main, 17 preload, and 9,181 renderer modules.
- B transformed 2,003 main, 17 preload, and 9,181 renderer modules.
- Both builds emitted only the two existing CSS `::highlight(...)` parser warnings.

Entry SHA-256:

- A:
  `edc16e8482159539251fe9e26cc62bbf3391f3e244035cbf62c1860b093104d5`
- B:
  `601b57173e7bddbf6867302d6b951d9be1939c057747279c1ba82e206a5f99bb`

The A and B non-main manifests each contain exactly 786 rows and are byte-identical. Their
SHA-256 is
`f72f00efd1bc891383c4664090bfcea870746c0e8de2e84a8dfa1c2f09b19da2`.

The A main manifest contains 144 rows with SHA-256
`d3397a4b92ea2f1e411fd1e26c715bddc075510296b6610d49bec0d776c8d611`.
The B main manifest contains 145 rows with SHA-256
`03e1abfbe95cfd0d305ada11b2d79e3acc39758bf0c67c5784ae5a6852270fba`.

## Candidate emitted closure

The rejected B emitted
`out/main/chunks/main-i18n-startup-capability-B7xJCZeI.js` at 355 raw / 184 gzip bytes with
SHA-256
`6d7689a27183398f914191228506fcc004f36ed671aafe8c1e969a882164124a`.
Its sole direct literal relative edge was `../index.js`: the bundler kept `main-i18n` in the
entry and emitted only an indirection chunk back to that existing graph.

An inclusive Acorn AST walk followed literal relative import, export, dynamic-import, and
`require` edges. The candidate capability closure visited 135 JavaScript files and validated
733 edges. The complete B emitted-main scan visited 145 JavaScript files and validated 783
edges. Every target existed beneath `out/main`; no edge escaped the emitted directory.

After reverting, a fresh production build restored the accepted entry byte-for-byte at
3,410,984 raw / 720,505 gzip with the A SHA above. Its complete emitted-main scan again visited
144 JavaScript files and validated 781 literal relative edges beneath `out/main`.

## Budget consequence

The accepted budget remains unchanged at 3,459,220 bytes:

`3,459,220 - 3,410,984 = 48,236`

Had B been retained, headroom would have fallen to 47,520 bytes, violating both the
raw-reduction requirement and the exact-headroom contract. No budget file change was made by
this tranche.

## Tests and checks

- Candidate capability/owner/source-boundary plus inherited plugin-system boundary:
  4 files / 12 tests passed before measurement.
- Restored focused i18n, settings IPC, menu, runtime-RPC failure dialog, plugin-system,
  desktop startup/shell, and main-window suite: 10 files / 175 tests passed and 1 skipped.
- A, rejected B, and restored production `pnpm run build:electron-vite`: passed.
- The restored entry exactly matches the independently accepted raw, gzip, and SHA baseline.

The final typecheck, lint, format, max-lines, bundle-budget, and diff checks apply to the
restored worktree plus this evidence report; their results are recorded in the worker
completion.

## Residual packaged-ASAR limitation

The production builds and inclusive closure scans validate emitted relative resolution on this
macOS worktree. Packaged-ASAR launch smokes were not run on macOS, Linux, or Windows and remain
unresolved.
