# Phase 1 dashboard terminal-preview lazy boundary — 2026-07-30

**Scope:** Defer `AgentTerminalPreview.tsx` and its terminal-only renderer graph until
`AgentTerminalDialog` renders a card with a live `ptyId`, without beginning the root-store
partition.

## Result

`AgentTerminalDialog.tsx` now loads `AgentTerminalPreview` through `lazyWithRetry` only inside
the existing live-PTY branch. The Suspense fallback preserves the preview's existing viewport
height, width, padding, and background while the chunk loads.

| Renderer static closure |     A raw |     B raw | Raw change |    A gzip |    B gzip | Gzip change | A JS | B JS | A CSS | B CSS |
| ----------------------- | --------: | --------: | ---------: | --------: | --------: | ----------: | ---: | ---: | ----: | ----: |
| Main window             | 9,815,193 | 8,798,746 | -1,016,447 | 2,190,210 | 1,969,591 |    -220,619 |  294 |  292 |     3 |     2 |
| Dashboard popout        | 5,894,305 | 4,507,253 | -1,387,052 | 1,297,290 |   984,615 |    -312,675 |   83 |   77 |     3 |     2 |
| Web renderer            | 4,360,776 | 4,360,652 |       -124 |   928,388 |   928,352 |         -36 |   33 |   33 |     1 |     1 |

No renderer entry increased. Electron main remained 776,873 raw / 174,092 gzip, and preload
remained 130,798 raw / 20,642 gzip.

## Production importer and behavior audit

Before editing, `AgentTerminalDialog.tsx` was the only production importer of
`AgentTerminalPreview`. `AgentKanbanBoard.tsx` owns the dialog and is shared by:

- the separate dashboard popout through `DashboardPopoutRoot.tsx`; and
- the in-window dashboard drawer through `AgentDashboardDrawer.tsx`.

The preview's static graph included xterm and its CSS, terminal appearance/theme composition,
the app store, input signal tracking, Kitty keyboard state, IME compatibility, paste/copy
routing, ligatures, grid claiming, shortcut-platform policy, and the terminal preview preload
API. None of those implementations moved or changed.

The dialog shell remains eager. Its card header, close button, no-live-terminal message, Open
worktree action, `Dialog` open state, `onOpenChange`, reveal payload, click-outside behavior,
and focus/Escape handlers are unchanged. A card without `ptyId` still renders the closed-pane
message immediately and does not request the lazy module. A live `ptyId` renders the
dimension-preserving fallback, then passes the same `ptyId` and `terminalInput` identity into
the preview.

The preview still focuses xterm after the live snapshot paints. Escape remains intercepted
only when its target is inside `.xterm`; Radix click-outside behavior remains owned by the
dialog. Terminal input, app-menu paste, clipboard paste, keybindings, Kitty mode, host input
profile, theme/font/ligature updates, SSH/runtime PTY routing, and unsubscribe/dispose behavior
remain in `AgentTerminalPreview` and its existing modules. No provider, workspace, path,
platform, or store policy changed.

The lazy boundary uses reload key `dashboard-agent-terminal-preview`, following the existing
retry/reload conventions. It does not add a new store boundary or modify either dashboard
root.

## Fresh A/B evidence

The paths below were ephemeral local build directories used during measurement,
not durable artifacts. The recorded hashes, byte counts, manifests, and
conclusions in this report are the portable evidence.

- A artifact: `/tmp/orca-dashboard-preview-a.bye4Ur`
- B artifact: `/tmp/orca-dashboard-preview-b.hcsBwl`
- Both builds transformed 2,003 main, 17 preload, and 9,181 renderer modules.
- Both emitted only the two existing CSS `::highlight(...)` parser warnings.

Electron entry hashes were unchanged:

- main SHA-256:
  `6e75b9d4862f1219c23f16d6c920004167d7dae1995498caaacc5354a9d8f8fd`
- preload SHA-256:
  `c388a39cdca9609760e286d95b87ad1e53793720450e507f830ff1f6c5bd259f`

The complete A and B main manifests each contain 184 rows, are byte-identical, and have
SHA-256 `3576805e0f10c1c6c3ca473257901f824326f4e2b1a0a224bbb50e72eb28a5f2`.
The preload manifests each contain one row, are byte-identical, and have SHA-256
`3bb30bdb361c7c99cc423e4a4939399f8cb29042d653bdbfe5ef582034d9ed00`.

Renderer manifest SHA-256:

- A:
  `7f7495f0cea8ef15df213841a3e2ede31f0867bd172b2f050d69afa02998095b`
- B:
  `471f551a8431804bccd958cdf7ba831451e7560ae1422e5ade93030e0fcad90c`

Sorted static-closure manifests:

| Entry  | A rows | A manifest SHA-256                                                 | B rows | B manifest SHA-256                                                 |
| ------ | -----: | ------------------------------------------------------------------ | -----: | ------------------------------------------------------------------ |
| Main   |    297 | `bd65e941cd75035cd7b5d6f1e027a090ba67ed0d0a397a58bd7d8468864b77af` |    294 | `dd6c97cc5a75469e0c34cf13ba151d20193bf1491916962f956fb587fd8401a5` |
| Popout |     86 | `6a9828657de40275fb00a6c3caf2ff23add7dd1ed8208c8d420a2b2857b9f1bf` |     79 | `81498ed245318f0b027106a450854db8243163b95006f23b10e7fb1c38e15824` |
| Web    |     34 | `faac8fc0fd25c148ddc7ba44e686a683acca9fda7bf5b8d988a3aefda776c699` |     34 | `8c5c1a2232fd581fe45af47a58db0bdded2ff7ec8e97696debbcc2eef55417d1` |

Rows include JavaScript and CSS files and contain each emitted file's SHA-256 plus its
renderer-relative path.

## Lazy entry and inclusive validation

The retained build emits
`out/renderer/assets/AgentTerminalPreview-lt0BHchT.js` at 24,766 raw / 6,688 gzip bytes with
SHA-256 `38a9279d8ac0fe51835c3a0c392dbf7711f3c2b60fd514557fefd779969f9018`.

Its manifest-static closure contains 21 JavaScript files and one CSS file: 4,354,274 raw /
1,001,727 gzip bytes. The preview entry is not in the main-window, popout, or web static
closure. `AgentKanbanBoard-Bsagvlaj.js` retains the dynamic edge and Vite preload map, including
the xterm stylesheet.

Validation covered the complete B Vite manifest:

- 778 manifest entries;
- 6,248 static import-key edges;
- 213 dynamic import-key edges;
- 860 emitted JavaScript/CSS/asset references.

Every manifest key and emitted target exists beneath `out/renderer`. An inclusive Acorn AST
walk from the lazy entry followed literal relative import, export, and dynamic-import edges
through 59 JavaScript files and validated 226 edges. No target was missing and no path escaped
the renderer output.

## Budget ratchets

Only reduced renderer budgets changed, by each exact retained improvement:

| Entry  | Raw budget | Raw headroom | JS budget | JS headroom | CSS budget | CSS headroom |
| ------ | ---------: | -----------: | --------: | ----------: | ---------: | -----------: |
| Main   |  8,848,553 |       49,807 |       293 |           1 |          2 |            0 |
| Popout |  4,537,948 |       30,695 |        78 |           1 |          2 |            0 |
| Web    |  4,384,876 |       24,224 |        34 |           1 |          1 |            0 |

Electron main remains budgeted at 825,109:

`825,109 - 776,873 = 48,236`

No budget increased.

## Tests and validation

- Fresh A and B `pnpm run build:electron-vite`: passed.
- Focused lazy-boundary, live-PTY load, dialog prop routing, preview input/copy/paste/focus,
  board/card lifecycle, popout snapshot/relay, settings menu, and app startup-routing suite:
  9 files and 97 tests passed.
- `pnpm run typecheck:web`: passed.
- Targeted `pnpm exec oxlint --deny-warnings`: passed.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed.
- `git diff --check`: passed.

## Remaining limitation

The production builds, manifest validation, and emitted AST closure were run on this macOS
worktree. No packaged launch smoke was run on macOS, Linux, or Windows, so packaged
cross-platform launch coverage remains unresolved.
