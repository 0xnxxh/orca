# Phase 1 on-demand app-overlay chunk allocation audit — 2026-07-30

**Result:** rejected. A shared deferred app-overlay source module successfully deferred the
Markdown template picker and recent-tab switcher visual code, but Rolldown again extracted
the same 63,446-byte utility chunk into all three static renderer closures. One narrowly
scoped `advancedChunks` arm removed that extra file but recursively captured 847,208 bytes
and made the alleged deferred capability static in every renderer entry. All source,
configuration, test, output, and budget changes were restored; only this negative audit is
retained.

## Inputs and allocation model

The fresh baseline is checkpoint `e6f4772e82fa8b75c52baf14aa026032a844982b`.
The two preceding negative reports predicted the two allocation hazards:

- the Markdown picker boundary extracted `utils-CpTw4IZK.js`, 63,446 raw / 13,707 gzip;
- the recent-tab boundary separately extracted a Lucide factory chunk.

Rolldown `1.0.0-beta.53`'s installed type documentation says `manualChunks` is deprecated and
translated to an `advancedChunks` group. An advanced group captures matched-module
dependencies recursively by default, group constraints fall back to automatic chunking
when unmet, higher priority wins, and separator-safe regular expressions should use
`[\\/]`. Those contracts ruled out a broad vendor split and made recursive dependency
capture an explicit measured risk rather than an assumption.

## Prototype ownership and behavior

The combined arm used one concretely owned loader:

`loadDeferredAppOverlayModule()` → `DeferredAppOverlaySurfaces.tsx`

It did not reuse the Settings loader. The dynamic module exported only
`MarkdownTemplatePickerSurface` and `RecentTabSwitcherSurface`; narrow eager hosts remained
at the exact existing `App.tsx` error-boundary positions and inside the same tooltip,
confirmation, and link-routing providers.

The Markdown host retained the singleton request listener, active request/ref, replacement
cancellation, unmount cancellation, and once-protected resolver. It latched the shared
surface after the first delivered request, so zero-template and no-listener requests still
resolved immediately to blank without loading, replacement remained valid while the chunk
was unresolved, and the loaded instance stayed mounted across later close/reopen cycles.

The recent-tab host retained native and capture-phase DOM input ownership, current-store
model construction, direction, selected identity, commit/cancel, and cleanup. Only a
successful open latched the shared surface. Commit remained controller-owned while the
chunk was unresolved; Escape and blur still canceled; native and DOM ordering, user and
platform bindings, MRU/sequential models, accessibility, copy, tokens, icons, portal, and
mounted continuity were unchanged.

Candidate-focused tests covered no-request/rejected-open deferral, Markdown blank fallbacks,
replacement, unmount, once-only resolution, selection identity, both retry keys, recent-tab
unresolved-chunk commit, native input, DOM capture ordering, cancellation, cleanup, and
mounted continuity. The focused candidate/config run passed 7 files and 55 tests.

## Fresh measured arms

- A, accepted source: `/tmp/orca-overlay-allocation-a.9ucEuF`
- B, combined source grouping: `/tmp/orca-overlay-allocation-b-combined.wo0HK6`
- C, one allocation intervention: `/tmp/orca-overlay-allocation-c-advanced.aJlNSR`
- Restored A confirmation: `/tmp/orca-overlay-allocation-restored.lNm0Of`

All builds transformed 2,003 main and 17 preload modules. A transformed 9,186 renderer
modules; B and C transformed 9,187. Every build emitted only the two existing
`::highlight(...)` CSS parser warnings.

| Static closure   |          A raw / gzip |          B raw / gzip | B raw / gzip change | A JS/CSS | B JS/CSS |
| ---------------- | --------------------: | --------------------: | ------------------: | -------: | -------: |
| Main window      | 8,416,540 / 1,877,823 | 8,412,795 / 1,877,323 |       -3,745 / -500 |  292 / 2 |  293 / 2 |
| Dashboard popout |   4,507,253 / 984,615 |   4,507,716 / 985,055 |         +463 / +440 |   77 / 2 |   78 / 2 |
| Web renderer     |   4,360,652 / 928,355 |   4,361,076 / 928,746 |         +424 / +391 |   33 / 1 |   34 / 1 |

B emitted one documented deferred capability file:

- `assets/DeferredAppOverlaySurfaces-CzfSTmPr.js`
- 6,532 raw / 1,915 gzip
- SHA-256 `21630582b6d9563c1eb687cefe88dac50eeedb94c637df3d0d3758ec9f89a074`

The surface was absent from all static closures. Its imports nevertheless caused the exact
previous Markdown hazard to recur:

- `assets/utils-CpTw4IZK.js`
- 63,446 raw / 13,707 gzip
- SHA-256 `de0bc0dc34d80e5522f95e3e1e0e0d6bd5f76105c028e5246d988919f44a06fa`

The exact B static paths were:

- `index.html` → `index-CQHAljKw.js` → `checkbox-DsU9bKK9.js` →
  `utils-CpTw4IZK.js`
- `popout.html` → `popout-C0YDWIOW.js` → `dropdown-menu-D0X_LBOW.js` →
  `utils-CpTw4IZK.js`
- `web-index.html` → `web-Btz34HG8.js` → `label-CVwIOaA-.js` →
  `utils-CpTw4IZK.js`

Thus combined source grouping improved main raw/gzip but increased both unrelated renderer
raw totals, gzip totals, and JavaScript counts. It failed retention.

## Allocation arm

C added one separator-safe, exact-source `advancedChunks` group named
`deferred-app-overlays`, with priority 10 and the documented default recursive dependency
capture. A focused deterministic config test proved that the predicate matched the target
on POSIX and Windows paths and rejected a test file and Settings.

| Static closure   |          C raw / gzip |     Change from A | C JS/CSS | JS/CSS change |
| ---------------- | --------------------: | ----------------: | -------: | ------------: |
| Main window      | 8,410,490 / 1,873,465 |   -6,050 / -4,358 |  280 / 2 |       -12 / 0 |
| Dashboard popout |   4,532,625 / 988,687 |  +25,372 / +4,072 |   67 / 2 |       -10 / 0 |
| Web renderer     |   4,455,290 / 949,915 | +94,638 / +21,560 |   29 / 1 |        -4 / 0 |

Recursive capture emitted:

- `assets/deferred-app-overlays-BZIPmf1j.js`
- 847,208 raw / 264,564 gzip
- SHA-256 `017386baa10078d9be72026505d72b1c8aa653d82f85ebf16c6d4baa56aa7517`

The nominal dynamic entry became a 189-byte facade, while the 847-kilobyte capability was a
direct static import of `index-DbgAJPlm.js`, `popout-C1lyyCh5.js`, and `web-CvH36JNi.js`.
C reduced file counts but defeated on-demand allocation and materially regressed popout and
web raw/gzip totals. No second bundler intervention was attempted.

## Exact manifests and validation

The manifest hashes below use sorted
`path<TAB>raw<TAB>gzip<TAB>file-sha256` rows. Complete renderer validation checked every
manifest import key, dynamic-import key, emitted JavaScript/CSS file, and declared asset;
all paths resolved beneath the artifact root. No entry's static graph imported another HTML
entry.

| Evidence                          | A                                                                        | B                                                                        | C                                                                        |
| --------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Renderer manifest entries/hash    | 778 / `92ad617f8c8aee6d4c4a23622f524266cbe9c93b3fe65544d1acb833dc3f0d67` | 781 / `822391bb7cca41790c9972d31b907854d63c5a139f28517b54dee16fc3bef151` | 767 / `b2fbd6ec8671c03dde0a0b997e8e0fec5ada8e543cd1c6e6736c47ace2cf8d04` |
| Static/dynamic edges              | 6,247 / 213                                                              | 6,323 / 214                                                              | 5,745 / 214                                                              |
| Emitted references / failures     | 860 / 0                                                                  | 863 / 0                                                                  | 849 / 0                                                                  |
| Renderer files / tree hash        | 787 / `ab7d45d0f56191bca710c0fb0746e4900d953a971e43a80ff92123925784a30a` | 790 / `f28e3933578d9b5c2d1742f1d27ea6b34f0871cd1c2544d2480f8aae089e3ff0` | 776 / `de06487083c2f409de3cb751c1b80d9af2eefa01034c0b5a04ee78f53d9dd555` |
| Complete output files / tree hash | 972 / `eee5f7a4dbe84c00c74e6605aa19fbedf43e1ce8c6aaa2a760d0bfda07df8e1f` | 975 / `5e4170e379d74db1de0c5effad47655c26d36dcea110cdb608d0d746bf1d1648` | 961 / `4f090bb9f918e576efbda927602872e9711558059df97e37f912e6d7413ca7fc` |
| Main closure rows/hash            | 294 / `cd84b2b8294f67ba89ae7afa6067664ed7e920c3ea8f0ae239bc47fb15debf2c` | 295 / `73a8d2e8443e99c6b4c29731d0db5a9fe96ed5efcd8dc0fcd533fe152e6e24f1` | 282 / `f2f3f7581fa5bade10d48e1bb4479ac406a933424ca25d04d6d18dc37391d020` |
| Popout closure rows/hash          | 79 / `f5f2e8ef7e1f7685321c05d3940484b8bc51d54f916f8f01ec8709cb006fbf87`  | 80 / `c0b4381dd9a001ea6eaaa1121129ec2b1f1cc885c2a51218173b5f6e4cc73710`  | 69 / `6b267d5bc49c91d97b2a61dbf21b3a8c563e0fc4d2efaedd447ca4430ba9bebd`  |
| Web closure rows/hash             | 34 / `076e3afcb45d1d195eef95a88cd6f2574f4b6fb92d158188cd5378f4899a039f`  | 35 / `72120bff1ca31bafd455648fd09796df125e5cce826a0b2aed09d4ed0c03e162`  | 30 / `702c3bc77887293a8dc1316f32a5172fc582cba12e28f11ccd3de9aec540efe1`  |

Electron main and preload were byte-identical across A, B, and C:

| Entry   |        Raw / gzip | SHA-256                                                            |
| ------- | ----------------: | ------------------------------------------------------------------ |
| Main    | 776,873 / 174,092 | `6e75b9d4862f1219c23f16d6c920004167d7dae1995498caaacc5354a9d8f8fd` |
| Preload |  130,798 / 20,642 | `c388a39cdca9609760e286d95b87ad1e53793720450e507f830ff1f6c5bd259f` |

## Restoration and checks

The accepted renderer-index raw budget remains 8,466,347, preserving exactly 49,807 bytes
over A. No budget was raised or changed. After both arms were rejected, all prototype,
allocation, focused-test, and budget edits were removed with patch edits rather than
checkout/reset.

- Candidate behavior plus deterministic allocation predicate: 7 files and 55 tests passed.
- `pnpm run typecheck:web`: passed on the candidate.
- Restored recent-tab native/browser/model/policy and Markdown creation run: 8 files and 217
  tests passed.
- Restored `pnpm run typecheck:web`: passed.
- Targeted `oxlint --deny-warnings` and `oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed.
- `pnpm run check:electron-bundle-budgets`: passed against the restored A output.
- Complete restored manifest/path/entry-cycle validation: passed.
- The restored 972-file output tree was byte-identical to fresh A, with tree hash
  `eee5f7a4dbe84c00c74e6605aa19fbedf43e1ce8c6aaa2a760d0bfda07df8e1f`.
- `git diff --check`: passed.

No packaged launch smoke was run on macOS, Linux, or Windows. The builds and manifest
validation ran on this macOS worktree; packaged cross-platform launch behavior remains
unresolved.
