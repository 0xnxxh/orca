# Phase 1 dashboard-popout root-store boundary audit — 2026-07-30

**Result:** rejected. The smallest measured popout-only candidate did not remove the root
renderer store from the popout static closure and increased both other renderer entries.
Only this report is retained; all candidate source edits were removed and no budget changed.

## Production import and behavior audit

The accepted source graph has two eager root-store consumers in the popout bootstrap:

1. `src/renderer/popout.html` loads `src/renderer/src/popout.tsx`.
2. `popout.tsx` directly imports `useAppStore` from `./store`.
3. The module-level synchronous settings read seeds `useAppStore` before React mounts, and
   `PopoutSettingsSync` reads settings, fetches keybindings, merges settings change events,
   hydrates the async settings result, and reapplies theme/font changes.
4. `popout.tsx` also imports `I18nProvider`; that provider independently imports
   `useAppStore` to select `settings.uiLanguage` and combines it with the standalone plugin
   language-pack store.

The dashboard branch is:

`popout.tsx` → `DashboardPopoutRoot.tsx` → `AgentKanbanBoard.tsx` →
`AgentKanbanCard.tsx` / `AgentDashboardToolbar.tsx` / `AgentTerminalDialog.tsx`.

None of those dashboard source modules imports the root store. In A, however, Rolldown emits
the board as `assets/AgentKanbanBoard-Bsagvlaj.js`, and its static import table includes
`assets/store-C4ip2Tem.js`. The emitted board import obtains
`agentTypeToIconAgent`, `formatAgentTypeLabel`, and `DEFAULT_APP_FONT_FAMILY` from that chunk:
the first two originate in the board's `@/lib/agent-status` dependencies, while the font
constant reaches the shared chunk through `popout.tsx` → `lib/app-font-family.ts` →
`shared/constants.ts`. Thus the manifest has both exact static paths:

- `popout.html` → `_store-C4ip2Tem.js`
- `_AgentKanbanBoard-Bsagvlaj.js` → `_store-C4ip2Tem.js`

The retained AgentTerminalPreview boundary is not an eager source edge.
`AgentTerminalDialog.tsx` dynamically imports `AgentTerminalPreview.tsx` only for a live
`ptyId`. Inside that lazy graph, `AgentTerminalPreview.tsx` reads live settings/keybindings
from `useAppStore`, and `preview-terminal-key-handler.ts` reads keybinding overrides for
copy/paste policy. Those reads preserve terminal theme/font/ligatures, macOS Option handling,
macOS `Meta` versus Linux/Windows `Ctrl` clipboard chords, Kitty input policy, and user
overrides. Moving popout settings to local React state alone would stop seeding those lazy
consumers and is not behaviorally equivalent without a new typed preference boundary.

AgentTerminalPreview continues to receive the relayed `terminalInput` profile and uses the
existing terminal-preview preload APIs; this preserves local, WSL, SSH, and remote-runtime
byte routing. Dashboard cards and reveal payloads retain repo/worktree IDs without assuming
a git worktree, so folder-workspace behavior is unchanged. No provider, plugin-language-pack,
keybinding, dialog, drawer, focus, Escape, click-outside, or routing owner was changed.

## Candidate audit

Two reversible measurements were made after A:

1. Replacing only the direct `popout.tsx` settings store usage with local React state reduced
   popout static raw by 166 bytes, from 4,507,253 to 4,507,087, but
   `_AgentKanbanBoard-Bsagvlaj.js` still statically imported `_store-C4ip2Tem.js`. This also
   omitted the existing keybinding hydration and was therefore not a behaviorally complete
   candidate.
2. The smallest popout-only structural boundary then loaded `AgentKanbanBoard` through
   `lazyWithRetry`/`Suspense` in `DashboardPopoutRoot`. This removed the board-to-store static
   edge, but the popout still statically reached `assets/store-BsaMDYw-.js` through
   `I18nProvider`. Automatic chunk repartitioning also increased the main and web renderer
   static closures.

The second measurement is the rejected B below. It fails three retention requirements:

- root store remains statically reachable from `popout.html`;
- main renderer raw/count increased; and
- web renderer raw/count increased.

A behavior-complete removal would therefore require at least a store-free popout i18n owner,
a typed settings/keybinding preference owner for the lazy preview, and isolation of the board
chunk's shared allocations. That is a multi-owner store partition rather than the requested
small boundary, so it was not attempted.

## Fresh A/B production evidence

The paths below were ephemeral local build directories used during measurement,
not durable artifacts. The recorded hashes, byte counts, manifests, and
conclusions in this report are the portable evidence.

- A artifact: `/tmp/orca-popout-root-store-a.5VHJvi`
- Rejected B artifact: `/tmp/orca-popout-root-store-b-rejected.GeNJ8h`
- Restored output was rebuilt after removing the candidate and is file-for-file identical to
  A across all 972 output files. Its sorted output manifest SHA-256 is
  `f93152dd5325963b0482fdca8310c0652837c848d6d3c3a4fce5c530aea4e581`.
- A, B, and the restored build each transformed 2,003 main, 17 preload, and 9,181 renderer
  modules. Each emitted only the two existing CSS `::highlight(...)` parser warnings.

| Static closure   |     A raw |     B raw | Raw change |    A gzip |    B gzip | Gzip change | A JS | B JS | A CSS | B CSS |
| ---------------- | --------: | --------: | ---------: | --------: | --------: | ----------: | ---: | ---: | ----: | ----: |
| Main window      | 8,798,746 | 8,803,798 |     +5,052 | 1,969,591 | 1,972,921 |      +3,330 |  292 |  297 |     2 |     2 |
| Dashboard popout | 4,507,253 | 4,130,954 |   -376,299 |   984,615 |   875,364 |    -109,251 |   77 |   28 |     2 |     1 |
| Web renderer     | 4,360,652 | 4,363,659 |     +3,007 |   928,352 |   930,785 |      +2,433 |   33 |   36 |     1 |     1 |

Electron entries were file-for-file identical:

| Entry   | A/B raw | A/B gzip | A/B SHA-256                                                        |
| ------- | ------: | -------: | ------------------------------------------------------------------ |
| Main    | 776,873 |  174,092 | `6e75b9d4862f1219c23f16d6c920004167d7dae1995498caaacc5354a9d8f8fd` |
| Preload | 130,798 |   20,642 | `c388a39cdca9609760e286d95b87ad1e53793720450e507f830ff1f6c5bd259f` |

The complete main trees each contain 184 files and have sorted manifest SHA-256
`30ad89a0187516526b13c69c58fd76ba3a853ad3c2707080cd17206b910ee38f`.
The preload trees each contain one file and have sorted manifest SHA-256
`258a659699aac742ff29ce6bb44d9b9a43dca8a7b449c203821f809df64d6ce0`.
The renderer manifests contain 778 A entries and 784 B entries with SHA-256
`471f551a8431804bccd958cdf7ba831451e7560ae1422e5ade93030e0fcad90c` and
`51ee225c6521512a6d7b8b3bbb31bb11fa333079a5338525b33f1432942e5238`,
respectively.

Sorted static-closure manifests include path, raw, gzip, and file SHA-256:

| Entry  | A rows / manifest SHA-256                                                | B rows / manifest SHA-256                                                |
| ------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Main   | 294 / `02ec537878e1782f937ecc28eaad58fa8d0b0ab88bffbf09365755a1256c5df5` | 299 / `0558b1b56828e1aa029f9dfe862dc3d794029a6afca4efd41c57f88b2a2c52c9` |
| Popout | 79 / `a445cebbc0de337cd09fc1278e1a27bf28271b21bbef8b42b3d614df15aa8f5d`  | 29 / `b26a5663b0cb878e83bf1e70f29deb5dc58b332f619817af4e8d7e3667fcc044`  |
| Web    | 34 / `8c462ab4027db1482fc4b38975bd46adb1aea66f366e3e68261c80aaff8e71ac`  | 37 / `8049431c6405efe223bf05b40de3ef28f13f3429244f8b495deff1fd0717ca6e`  |

The A root-store artifact is `assets/store-C4ip2Tem.js`: 1,950,409 raw / 390,353
gzip, SHA-256
`cb139656cd20b778d71dd636603b84649a1767c2f8129d5a99dc775e17dece0b`.
The B artifact is `assets/store-BsaMDYw-.js`: 1,884,306 raw / 375,376 gzip,
SHA-256
`99baff55d754e5e96607688036e09e426373d1994ca46ad55e948bf07bca08e6`.
B moves the board to a dynamic edge but still has the exact static path
`popout.html` → `_store-BsaMDYw-.js`.

Electron main remains within its 825,109 raw budget with exactly 48,236 bytes of headroom:

`825,109 - 776,873 = 48,236`

No renderer or Electron budget was edited.

## Manifest and emitted-closure validation

Every manifest import key, dynamic-import key, JavaScript/CSS file, and declared asset exists
beneath its renderer artifact root:

| Arm | Manifest entries | Static edges | Dynamic edges | Emitted references | Failures |
| --- | ---------------: | -----------: | ------------: | -----------------: | -------: |
| A   |              778 |        6,248 |           213 |                860 |        0 |
| B   |              784 |        6,532 |           214 |                866 |        0 |

An inclusive Acorn walk followed every literal relative static import, export, and dynamic
import from each emitted entry:

| Arm / entry | JS files | Relative edges | Missing, escaping, or parse failures |
| ----------- | -------: | -------------: | -----------------------------------: |
| A main      |      694 |          6,291 |                                    0 |
| A popout    |      119 |            483 |                                    0 |
| A web       |      695 |          6,317 |                                    0 |
| B main      |      699 |          6,554 |                                    0 |
| B popout    |      125 |            536 |                                    0 |
| B web       |      700 |          6,583 |                                    0 |

## Validation

- Fresh A, rejected B, and restored `pnpm run build:electron-vite`: passed.
- Restored output versus A: 972/972 files identical.
- Focused dashboard popout, dialog, board, preview, keybinding, routing, and i18n suite:
  15 files and 125 tests passed.
- `pnpm run typecheck:web`: passed.
- Targeted `oxlint --deny-warnings`: passed.
- Targeted `oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed.
- `git diff --check`: passed.

## Residual risk

The root store remains intentionally eager in the accepted popout build. A later tranche must
design the i18n and terminal preference owners together and remeasure Rolldown's cross-entry
chunk allocation; changing only the obvious direct import is misleading.

No packaged launch smoke was run on macOS, Linux, or Windows. Production builds, manifest
validation, and emitted AST closure validation were run on this macOS worktree, so packaged
cross-platform launch behavior remains unresolved.
