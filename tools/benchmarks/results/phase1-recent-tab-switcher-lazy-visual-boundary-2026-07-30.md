# Phase 1 recent-tab switcher lazy visual boundary — 2026-07-30

**Result:** rejected. The measured controller/visual split reduced the main-window static
closure by 455 raw bytes, but automatic shared-chunk allocation added one JavaScript file
and raw bytes to both dashboard-popout and web. Only this negative report is retained; all
candidate source/tests were removed, the accepted checkpoint was restored exactly, and no
budget changed.

## Production ownership and behavior audit

The accepted `RecentTabSwitcher.tsx` has two deliberately eager input paths:

1. Native `window.api.ui.onCtrlTabKeyDown` advances the switcher, and
   `onCtrlTabKeyUp` commits the selected identity.
2. Capture-phase DOM `keydown`/`keyup` listeners provide the CDP/test fallback. Matching
   events call `preventDefault` and `stopPropagation` before terminal input can observe them.

Both paths use `matchesRecentTabSwitcherChord`, `getShortcutPlatform`, and the current
keybinding overrides. The shared shortcut policy requires Ctrl+Tab, excludes Meta/Alt, gates
the held interaction on `tab.previousRecent`, treats Shift as direction rather than a
separate binding, and recognizes both Control release and the Electron Tab-release fallback.
`Terminal.tsx` intentionally yields matching Ctrl+Tab events to this capture/native owner
before its ordinary previous-recent handler, preserving terminal-first keybinding policy.
Main-window and browser-guest input owners use the same shared policy.

`openOrAdvance` reads the current store only when invoked. It rejects non-terminal views and
missing worktree identities, then builds the visible model for the active group using the
configured MRU or sequential order. Repeated advances preserve the selected tab key across a
fresh model before applying direction. Commit clears the controller state before activating
the selected editor, browser, or terminal identity. Escape and blur cancel without
activation; unmount removes both native callbacks and all DOM listeners.

The model is based on the active worktree/group and unified visible tab identities, so it
does not assume a git worktree or local runtime. Folder workspaces, local/WSL/SSH/relay/
remote-runtime terminals, browsers, editor tabs, providers, and Git policy were not changed.

The rejected candidate kept `RecentTabSwitcherHost` at the exact existing
`RecoverableRenderErrorBoundary` placement in `App.tsx`. That eager host retained all native
and capture-phase callbacks, model construction, selected identity, commit/cancel, and
cleanup. It used `lazyWithRetry` with reload key `recent-tab-switcher` to load only the
portal/listbox/icon surface after the first successful open. A permanent latch kept the
loaded surface component mounted while closed. Controller tests proved no load for startup
or a rejected open, correct event ordering, repeated advancement, Escape/blur cancellation,
native commit while the chunk was unresolved, cleanup, retry identity, and mounted state
continuity. The unchanged surface preserved its portal, listbox/option roles, accessible
label, exact copy, selection styling, dirty marker, icons, tokens, and floating shadow.

## Why the candidate was rejected

B emitted the intended dynamic visual surface:

- `src/components/tab-bar/RecentTabSwitcher.tsx` →
  `assets/RecentTabSwitcher-DbtTOQcn.js`
- 3,359 raw / 1,265 gzip bytes
- SHA-256 `eedd8dc397eb8f0313cfa00dfd7c21b566d241c00de30f4543fb299c55ef1631`
- dynamic importer `_App-DnzSeDqT.js`

The visual surface was absent from all three B static closures. Its Lucide icon dependencies,
however, caused Rolldown to extract
`assets/createLucideIcon-D99aGs7B.js` as a new shared static chunk: 3,344 raw / 1,100 gzip
bytes, SHA-256
`adc1731cb067df724d0014e9678010e1affab5e90efafba7d116e6b9579efc23`.
That allocation added one eager JavaScript file to every renderer entry through these exact
B manifest paths:

- `index.html` → `_App-DnzSeDqT.js` → `_createLucideIcon-D99aGs7B.js`
- `popout.html` → `_workspace-status-iHjOceCR.js` → `_createLucideIcon-D99aGs7B.js`
- `web-index.html` → `_cable-DBe33Ms2.js` → `_createLucideIcon-D99aGs7B.js`

Moving the icons back into the controller would defeat the visual-only boundary. Replacing
the established Lucide icons, changing the visual copy/tokens, or widening this into a
manual shared-chunk policy was outside the requested small candidate and was not attempted.

## Fresh A/B production evidence

The paths below were ephemeral local build directories used during measurement, not durable
artifacts. The hashes, byte counts, manifests, and conclusions recorded here are the portable
evidence.

- A artifact: `/tmp/orca-recent-tab-switcher-a.QuecOq`
- Rejected B artifact: `/tmp/orca-recent-tab-switcher-b.rroQ8F`
- A transformed 2,003 main, 17 preload, and 9,186 renderer modules.
- B transformed 2,003 main, 17 preload, and 9,187 renderer modules.
- Both builds emitted only the two existing CSS `::highlight(...)` parser warnings.

| Static closure   |     A raw |     B raw | Raw change |    A gzip |    B gzip | Gzip change | A JS | B JS | A CSS | B CSS |
| ---------------- | --------: | --------: | ---------: | --------: | --------: | ----------: | ---: | ---: | ----: | ----: |
| Main window      | 8,416,540 | 8,416,085 |       -455 | 1,877,823 | 1,877,276 |        -547 |  292 |  293 |     2 |     2 |
| Dashboard popout | 4,507,253 | 4,508,049 |       +796 |   984,615 |   984,849 |        +234 |   77 |   78 |     2 |     2 |
| Web renderer     | 4,360,652 | 4,361,042 |       +390 |   928,355 |   928,648 |        +293 |   33 |   34 |     1 |     1 |

Electron entries were file-for-file identical:

| Entry   | A/B raw | A/B gzip | A/B SHA-256                                                        |
| ------- | ------: | -------: | ------------------------------------------------------------------ |
| Main    | 776,873 |  174,092 | `6e75b9d4862f1219c23f16d6c920004167d7dae1995498caaacc5354a9d8f8fd` |
| Preload | 130,798 |   20,642 | `c388a39cdca9609760e286d95b87ad1e53793720450e507f830ff1f6c5bd259f` |

The complete A and B main trees each contain 184 files and have identical sorted SHA-256
manifests:
`3576805e0f10c1c6c3ca473257901f824326f4e2b1a0a224bbb50e72eb28a5f2`.
The preload trees each contain one file and have identical sorted SHA-256 manifests:
`3bb30bdb361c7c99cc423e4a4939399f8cb29042d653bdbfe5ef582034d9ed00`.

The renderer manifests contain 778 A entries and 781 B entries. Their file SHA-256 values are
`92ad617f8c8aee6d4c4a23622f524266cbe9c93b3fe65544d1acb833dc3f0d67` and
`3fd9fb6e490332a02f58538cee915a4399ca6bc81ee6da6fa0514037b8d546e7`,
respectively. Complete output trees contain 972 A files and 975 B files; their sorted SHA-256
manifests are
`09ff908615c9ec1f7f45bfe4f8929e56c2afa25c4a2b32242665d184f4b15df0` and
`2286af9868206a2fb7626c2ec6c6a6468db096a530ac9b3ce40c9d9a7c3ab759`.

Sorted static-closure manifests include path, raw, gzip, and file SHA-256:

| Entry  | A rows / manifest SHA-256                                                | B rows / manifest SHA-256                                                |
| ------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Main   | 294 / `f863c014e40dd4cd49b0864e4fa61c5df98f185712f76b9227fbb5d2cc443488` | 295 / `a130a8d46fe1687b522efd966731a4a640b73bb3728687c7a1ad8d955ee28cdd` |
| Popout | 79 / `b83774dc8005e78455d394f6342824c9c21784c07813e43a3770d6c19ab61d45`  | 80 / `c94acad7289c5df20c9c0bf7311f352ac37a12f8c43e81d2ce586a732e5be84d`  |
| Web    | 34 / `46925643199b3b8f53da06bed01b5bed8ed070d79fb8b6214d70cf796672e571`  | 35 / `8ba3246bba99e03360b7d5b3bc58ef06cd738395e1c1081b3ea90ef17aca4526`  |

The accepted renderer-index raw budget remains 8,466,347, preserving its 49,807-byte
headroom over A. Electron main remains within its 825,109 raw budget with exactly 48,236
bytes of headroom. No budget was changed.

## Restoration and validation

After rejecting B, only candidate source/test edits were removed and the accepted source was
rebuilt. The restored build transformed 2,003 main, 17 preload, and 9,186 renderer modules
and is file-for-file identical to A across all 972 output files. Its sorted output manifest
SHA-256 is
`09ff908615c9ec1f7f45bfe4f8929e56c2afa25c4a2b32242665d184f4b15df0`.

Complete renderer manifest validation checked every import key, dynamic-import key, emitted
JavaScript/CSS file, and declared asset for existence beneath its artifact root:

| Arm | Manifest entries | Static edges | Dynamic edges | Emitted references | Missing/escaping failures |
| --- | ---------------: | -----------: | ------------: | -----------------: | ------------------------: |
| A   |              778 |        6,247 |           213 |                860 |                         0 |
| B   |              781 |        6,294 |           214 |                863 |                         0 |

- Candidate focused suite: 4 files and 42 tests passed before the rejected boundary tests
  were removed.
- Restored switcher/model/shared-policy/main-window/browser-guest suite: 5 files and 154 tests
  passed.
- `pnpm run typecheck:web`: passed.
- Targeted `oxlint --deny-warnings`: passed over App, switcher/model, Terminal, shared shortcut
  policy, and focused test source.
- Targeted `oxfmt --check`: passed over the same source plus this report.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed against the restored A output.
- `git diff --check`: passed.

## Residual risk

The accepted switcher visual remains eager. A later attempt would need a bundler allocation
strategy that keeps the visual dynamic without extracting Lucide's factory into every entry;
that is a shared renderer chunk concern rather than a safe change to the input controller.

No packaged launch smoke was run on macOS, Linux, or Windows. Production builds and complete
manifest validation ran on this macOS worktree, so packaged cross-platform launch behavior
remains unresolved.
