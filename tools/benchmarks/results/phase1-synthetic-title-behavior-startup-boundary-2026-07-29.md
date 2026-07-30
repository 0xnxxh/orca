# Phase 1 synthetic-title behavior startup boundary — negative audit — 2026-07-29

**Scope:** Audit and measure one exact-identity app-ready aggregate for the six remaining
synthetic-title and TUI-permission values imported directly by `src/main/index.ts`.

## Result

The candidate was safe to install after the retained runtime-connectivity capability, but it
was not a raw Electron-main reduction. The candidate increased `out/main/index.js` by 330
bytes, so its capability, owner, tests, and `index.ts` wiring were reverted. This report is
the only retained file from the tranche; the Electron-main budget remains unchanged.

| Surface       |     A raw |     B raw | Raw change |  A gzip |  B gzip | Gzip change |
| ------------- | --------: | --------: | ---------: | ------: | ------: | ----------: |
| Electron main | 3,410,984 | 3,411,314 |       +330 | 720,505 | 720,390 |        -115 |

The B raw result fails the mandatory reduction gate. It would also leave only 47,906 bytes
below the unchanged 3,459,220-byte budget, rather than the required 48,236. A post-revert
production build returned exactly to 3,410,984 raw / 720,505 gzip with 48,236 bytes of
headroom.

## Production importer and consumer audit

The audit covered every production occurrence beneath `src/main` and `src/shared` before
editing:

- `advanceSyntheticTitleSpinnerEntries`, `shouldSendSyntheticTitleFrame`,
  `shouldCopySyntheticTitleFrameToPtyData`, `shouldDriveSyntheticAgentTitleFromHook`, and
  `resolveTuiAgentPermissionMode` each had one direct production caller in `src/main/index.ts`
  outside their implementation modules.
- `getSyntheticAgentTitleProfile` also remains a production dependency of
  `src/shared/agent-title-owner.ts` and `src/shared/foreground-wrapper-agent.ts`.
- The hook consumers are callback bodies registered by `openMainWindow()`.
  `agentHookServer.setListener` can synchronously replay cached status, so installation had to
  precede the first possible `openMainWindow()` call.
- Frame visibility and PTY routing are reached from `sendSyntheticTitle`; spinner advancement
  is reached only from the interval created after a spinner entry exists; permission-mode
  derivation is reached only from the hook callback.
- Pre-ready second-instance activation cannot reach these consumers:
  `focusExistingMainWindow()` returns `pending` until `app.isReady()`, and after ready the
  Store/runtime/account/service guards needed by `openMainWindow()` are initialized only after
  the proposed installation point.

The measured candidate therefore installed immediately after
`installRuntimeConnectivityStartupCapability(runtimeConnectivity)` and before crash-store
creation or any reachable window/hook consumer. Its typed owner threw before installation and
returned the exact installed aggregate object. The aggregate returned all six original
function references without wrappers.

No map, constant, timer, listener, hook publication, PTY lookup, PTY data copy, BEL/final-frame
path, renderer visibility check, permission calculation, or teardown function moved. The
candidate did not alter pre-ready bootstrap/profile or platform policy, Store/account/runtime,
mobile/relay/i18n, macOS/Linux/Windows, WSL/SSH/remote, folder-workspace, Git/provider, plugin,
or shutdown ownership.

## Why the candidate did not reduce raw main

The candidate emitted
`out/main/chunks/synthetic-title-behavior-startup-capability-CWRc-CtO.js` at 1,403 raw / 563
gzip bytes with SHA-256
`d4874144a1274c05cb6bd3be214ad8ebb5378386f662ec79e723bfd585fee029`.

Its three direct literal-relative edges were:

- `./tui-agent-config-DMkBaphp.js`;
- `./synthetic-agent-title-B5wBI6ut.js`; and
- `../index.js`.

The emitted capability had to import `resolveTuiAgentPermissionMode` back from `index.js`.
Together with the remaining production importers of the shared synthetic-agent-title module,
the exact-identity aggregate did not remove enough code from the entry to offset its owner,
getter calls, dynamic-import wiring, and new chunk. The resulting circular entry edge is valid,
but the raw entry grew, making this exact six-value aggregate unsuitable for retention.

## Fresh A/B evidence

The paths below were ephemeral local build directories used during measurement,
not durable artifacts. The recorded hashes, byte counts, manifests, and
conclusions in this report are the portable evidence.

- A artifact: `/tmp/orca-synthetic-title-a.DRSTOq`
- B artifact: `/tmp/orca-synthetic-title-b.CQdzZU`
- A transformed 2,001 main, 17 preload, and 9,181 renderer modules.
- B transformed 2,003 main, 17 preload, and 9,181 renderer modules.
- Both builds emitted only the two existing CSS `::highlight(...)` parser warnings.

Entry SHA-256 values:

- A:
  `edc16e8482159539251fe9e26cc62bbf3391f3e244035cbf62c1860b093104d5`
- B:
  `b3c3b5092c07e6a5eba30f99e98713074945fbfc9e806ac6b3d28ddd2d3ca9b9`
- post-revert:
  `edc16e8482159539251fe9e26cc62bbf3391f3e244035cbf62c1860b093104d5`

The sorted A and B non-main manifests use paths relative to `out`, contain exactly 786 rows,
and are byte-identical. Their SHA-256 is
`68ba944c45d80c14c538180894eade74a3897e120fa0bf6a89fbb60500a3ab01`.

The relative-path A main manifest contains 144 rows with SHA-256
`67b2600ac0301057f0353e4208dc591309c5d9bd63c9d821cc768e1f3b9ca3d9`.
The B main manifest contains 146 rows with SHA-256
`07d71a13d8bc6b8d189ea07b22fb984a022e39b55715a7bedf49aa2d6bcbdfa8`.

## Inclusive emitted closure

An Acorn AST walk followed literal relative import, export, dynamic-import, and `require`
edges:

- A complete emitted main: 144 JavaScript files and 781 validated edges.
- B capability closure: 136 JavaScript files and 737 validated edges.
- B complete emitted main: 146 JavaScript files and 787 validated edges.

Every referenced target existed and resolved beneath its copied `out/main`; no edge escaped
the emitted directory.

## Tests and gates

Before measurement, the candidate capability, owner, source-boundary, spinner, visibility,
frame-routing, shared synthetic-agent-title, and TUI-permission suite passed: 8 files and 27
tests. The new coverage proved exact function identity, fail-closed access, installed object
identity, ordering after runtime-connectivity and before window creation, type-only/absent
direct source imports, and preservation of maps, timers, routing, and teardown ownership.

No existing boundary assertion required maintenance: only the discarded candidate's new
source-boundary test referred to the qualified identifiers.

Because the mandatory fresh raw-size gate failed, the candidate was reverted before the
broader hook/PTY/runtime/startup/teardown, typecheck, lint, format, ratchet, and retained-budget
gates. After the revert, the five retained behavior files passed 20 tests; targeted report
formatting, `check:max-lines-ratchet`, `check:electron-bundle-budgets`, non-main manifest
equality, and `git diff --check` also passed. The post-revert production build reproduced the
accepted baseline exactly, and the checked-in Electron-main budget was not changed.

## Residual packaged-ASAR limitation

The fresh production builds and inclusive emitted-closure scans validate relative resolution
on this macOS worktree. This negative audit did not run packaged-ASAR launch smokes on macOS,
Linux, or Windows; cross-platform packaged launch verification remains unresolved.
