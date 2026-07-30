# Phase 1 terminal view-attributes startup boundary — 2026-07-30

## Result

The retained change moves the app-start publication path out of
`components/terminal-pane/terminal-appearance.ts` into the concrete
`components/terminal-pane/terminal-view-start.ts` leaf. `App.tsx` still publishes immediately
after the awaited settings read and before the remaining hydration chain.

| Static closure   |     A raw |     B raw | Raw change |    A gzip |    B gzip | Gzip change | A JS | B JS | A CSS | B CSS |
| ---------------- | --------: | --------: | ---------: | --------: | --------: | ----------: | ---: | ---: | ----: | ----: |
| Main window      | 8,798,746 | 8,450,230 |   -348,516 | 1,969,591 | 1,883,919 |     -85,672 |  292 |  292 |     2 |     2 |
| Dashboard popout | 4,507,253 | 4,507,253 |          0 |   984,615 |   984,615 |           0 |   77 |   77 |     2 |     2 |
| Web renderer     | 4,360,652 | 4,360,652 |          0 |   928,352 |   928,347 |          -5 |   33 |   33 |     1 |     1 |

No renderer entry raw size or JavaScript/CSS count increased. Electron main remained 776,873
raw / 174,092 gzip and preload remained 130,798 raw / 20,642 gzip.

## Importer and lifecycle audit

Before the edit, the production importers of `terminal-appearance.ts` were:

- `App.tsx`, only for `publishTerminalViewAttributesAtAppStart`;
- `use-terminal-pane-lifecycle.ts`, for the later pane-owner
  `applyTerminalAppearance`;
- `TerminalSettingsPreview.tsx`, for pure theme composition; and
- the already-lazy `AgentTerminalPreview.tsx`, also for pure theme composition.

The publisher has one module-global dedupe owner in
`terminal-view-attributes-publisher.ts`. The retained leaf and
`terminal-appearance.ts` both import that same module, so app-start publication and the later
pane-mount application still share one cache and one publish function identity.
`terminal-appearance.ts` re-exports `composeActiveTerminalTheme`, `hexToRgba`, and
`isHexColor`, preserving existing preview and test import identities while retaining all
pane-manager, fit, transport resize, mode-2031, font, cursor, and style behavior at the
existing lifecycle owner.

The source path relevant to startup is now:

`App.tsx -> terminal-view-start.ts -> terminal-theme.ts / terminal-themes-data.ts /
terminal-view-attributes-publisher.ts`

The new leaf has no source import of pane manager, terminal pane lifecycle,
`sync-runtime-graph`, PTY connection/dispatcher/transport, or
`applyTerminalAppearance`. `sync-runtime-graph.ts` continues to import terminal-theme policy
directly, and the root store continues to import its terminal slice, which continues to
schedule runtime-graph sync. Those owners and paths were not moved.

The A Vite manifest showed both direct emitted paths:

- `index.html -> assets/terminal-appearance-CQ9bghuq.js`
- `assets/App-D3NC2vQN.js -> assets/terminal-appearance-CQ9bghuq.js`

That A chunk was 363,645 raw / 90,080 gzip with SHA-256
`9cf0c348f8f17fdfe59a851d073e40d94b9068665c3a611dc00ea71ed1bff3f2`. It imported
`store-C4ip2Tem.js` and contained the startup publication together with pane/mobile-fit,
Windows/runtime, and terminal lifecycle implementation code because of the shared/circular
allocation.

The B manifest instead has:

`index.html -> assets/terminal-view-start-tVBEoFhs.js`

The B leaf chunk is 15,136 raw / 4,427 gzip with SHA-256
`c656f95dd1454a0c2a660fb9e480ceaed25fc6ca7fc1a264a5e81041f7d703da`.
No `terminal-appearance` key or file is statically reachable from the B main entry. The new
chunk still imports the already-eager root-store shared chunk because of Rollup's existing
shared allocation, but its source graph does not import the store, pane manager, runtime
graph, or PTY implementations. Popout and web do not statically reach the new leaf.

A preliminary, unretained `terminal-view-attributes-startup` filename increased popout and
web raw closures by 13 bytes each because Vite embedded the longer basename in shared preload
maps. The retained `terminal-view-start` name is concrete and matches the former
`terminal-appearance` basename length, eliminating that cross-entry filename tax.

## Behavioral preservation

`App.tsx` still awaits `fetchSettings`, reads the same `useAppStore` state, computes the same
system dark/light preference, and publishes before keybindings, persisted UI, restored
terminal, and pane-mount work. Null settings remain a no-op. Built-in and custom terminal
themes, overrides, background/cursor opacity composition, and published color-scheme mode
use the same implementations.

Hidden-at-launch PTYs therefore retain the pre-pane OSC 10/11 answer publication. A later
`applyTerminalAppearance` call uses the same publisher cache and remains a deduped no-op when
the attributes are unchanged. No terminal restore, local/WSL/SSH/relay/runtime routing,
folder-workspace, provider, input, theme, or pane lifecycle policy changed.

## Fresh A/B artifacts and hashes

The paths below were ephemeral local build directories used during measurement,
not durable artifacts. The recorded hashes, byte counts, manifests, and
conclusions in this report are the portable evidence.

- A: `/tmp/orca-terminal-view-startup-a.LZJNf7`
- B: `/tmp/orca-terminal-view-startup-b2.rlu8pp`

Electron entry SHA-256 values were identical:

- main A/B:
  `6e75b9d4862f1219c23f16d6c920004167d7dae1995498caaacc5354a9d8f8fd`
- preload A/B:
  `c388a39cdca9609760e286d95b87ad1e53793720450e507f830ff1f6c5bd259f`

Sorted full-tree manifests contain each relative path and file SHA-256:

| Output tree | A rows | A manifest SHA-256                                                 | B rows | B manifest SHA-256                                                 | Changed rows |
| ----------- | -----: | ------------------------------------------------------------------ | -----: | ------------------------------------------------------------------ | -----------: |
| Main        |    184 | `f4a845ee1e5ebc80c83b4fd10fc1f61ab52e36f82e0de80e308ebdc6cd1a4e85` |    184 | `f4a845ee1e5ebc80c83b4fd10fc1f61ab52e36f82e0de80e308ebdc6cd1a4e85` |            0 |
| Preload     |      1 | `41ff6755a20a376674371331e9787711cb1b1f32c46582c7cd99880a4c07baf6` |      1 | `41ff6755a20a376674371331e9787711cb1b1f32c46582c7cd99880a4c07baf6` |            0 |
| Renderer    |    787 | `c20ec9b73bdbc121aff57661290f3332d2b02d6a3c96a7f323883ff1bec09618` |    787 | `61e5a85c102d81f664360642655e3bd22aaa3a9787e1b0e200078c467cec4504` |           58 |

The Vite manifest contains 778 entries in each build:

- A SHA-256:
  `471f551a8431804bccd958cdf7ba831451e7560ae1422e5ade93030e0fcad90c`
- B SHA-256:
  `4142e98fc5f05ffd55e1c08e8cc4d0a4afb2997f95edafeb99c39dac71a2839b`

Sorted static-closure manifests contain each JavaScript/CSS path and file SHA-256:

| Entry  | A rows | A closure-manifest SHA-256                                         | B rows | B closure-manifest SHA-256                                         |
| ------ | -----: | ------------------------------------------------------------------ | -----: | ------------------------------------------------------------------ |
| Main   |    294 | `dd6c97cc5a75469e0c34cf13ba151d20193bf1491916962f956fb587fd8401a5` |    294 | `e1c1b5d9070b00ec0e0a3c77823d046a3c891b4a3f2ab0af9cef8d79533fc20c` |
| Popout |     79 | `81498ed245318f0b027106a450854db8243163b95006f23b10e7fb1c38e15824` |     79 | `e2600b6f0699021ac6f236777514e67430ffb24c61cd5ace8c8144f13e41b615` |
| Web    |     34 | `8c5c1a2232fd581fe45af47a58db0bdded2ff7ec8e97696debbcc2eef55417d1` |     34 | `1257316624b320c0fe1e398727077a55b50b85b9dbd528a7b9fbd40095eb8c65` |

## Emitted validation

The complete B Vite manifest validation covered:

- 778 manifest entries;
- 6,249 static import-key edges;
- 213 dynamic import-key edges; and
- 860 emitted file, CSS, and asset references.

Every manifest key and emitted target exists beneath `out/renderer`. An Acorn parse of all
702 emitted JavaScript files validated 6,491 literal relative import, export, and dynamic
import edges; no target was missing and no edge escaped the renderer output. The inclusive
Acorn walk from `assets/terminal-view-start-tVBEoFhs.js` reached 51 JavaScript files and
validated 196 edges.

## Budget ratchet

Only `renderer-index.maxRawBytes` changed, from 8,848,553 to 8,500,037, exactly matching the
retained 348,516-byte reduction. Its headroom remains:

`8,500,037 - 8,450,230 = 49,807`

The other renderer budgets and all JavaScript/CSS count budgets are unchanged. Electron main
remains budgeted at 825,109:

`825,109 - 776,873 = 48,236`

No budget increased.

## Tests and gates

- Fresh A and final B `pnpm run build:electron-vite`: passed.
- Focused terminal appearance/theme/publisher/source-boundary suite: 5 files, 61 tests passed.
- Broader app startup, terminal pane lifecycle, and runtime-graph suite: 14 files, 174 tests
  passed.
- `pnpm run typecheck:web`: passed.
- Targeted `pnpm exec oxlint --deny-warnings`: passed.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed.
- `git diff --check`: passed.

## Remaining limitations

The production builds and emitted validation ran in this macOS worktree. No packaged launch
smoke was run on macOS, Linux, or Windows, so packaged cross-platform launch coverage remains
unresolved. The retained boundary does not partition the already-eager root store or
runtime-graph graph; it only removes the startup-only App dependency on the pane appearance
lifecycle module.
