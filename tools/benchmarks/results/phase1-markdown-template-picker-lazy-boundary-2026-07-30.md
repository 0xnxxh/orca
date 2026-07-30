# Phase 1 Markdown template picker lazy-boundary audit — 2026-07-30

**Result:** rejected. The measured lazy-on-first-request candidate reduced the main-window
static closure by 1,144 raw bytes, but automatic shared-chunk allocation added one JavaScript
file and raw bytes to both the dashboard-popout and web closures. Only this negative report
is retained; the candidate implementation, tests, and output were removed, the accepted
source/output baseline was restored exactly, and no budget changed.

## Production ownership and behavior audit

The accepted source path is:

`App.tsx` → `MarkdownTemplatePicker.tsx` → `CommandDialog`

`MarkdownTemplatePicker` owns the only eager `subscribeMarkdownTemplatePicker` listener and
keeps the active request in both state and a ref. A replacement request cancels the prior
request before installing the new identity. Unmount cancels the active request and removes
the singleton listener. Cancel, blank, and template selections all clear the active identity
before invoking its once-wrapped resolver.

The request module intentionally is not a durable store:

- a request with zero templates resolves immediately to `{ type: 'blank' }`;
- a request made without the mounted listener also resolves immediately to blank; and
- a delivered request has one generated ID, the original template identities, and a resolver
  protected by `once`.

`createUntitledMarkdownFileWithTemplateSelection` discovers templates in the selected runtime
and requests a selection before creating the file. The runtime operation arguments continue
to carry the selected local, WSL, SSH, relay, or remote-runtime identity; the picker itself
does not assume a local filesystem or git worktree. Folder workspaces and provider/Git policy
are outside this UI request boundary and were not changed.

The candidate kept a narrow eager `MarkdownTemplatePickerHost` at the exact existing
`RecoverableRenderErrorBoundary` placement in `App.tsx`. The host retained listener,
replacement, unmount, and resolution ownership; `lazyWithRetry` dynamically imported only
the existing visual surface with reload key `markdown-template-picker` after the first real
request. A permanent mounted latch kept the loaded surface mounted through later close and
reopen cycles, while `Suspense` used the existing blank fallback. Focused candidate tests
proved no pre-request load, zero-template/no-listener blank behavior, replacement while the
chunk was unresolved, unmount cancellation, once-only resolution, selection identity, retry
key, and mounted-instance continuity.

## Why the candidate was rejected

B emitted the intended dynamic surface:

- `src/components/editor/MarkdownTemplatePicker.tsx` →
  `assets/MarkdownTemplatePicker-BhSHOf-f.js`
- 3,510 raw / 997 gzip bytes
- SHA-256 `2324892a6e93f33e40761f32129df5a4d5dc1f54b700afb662ae7df00a6150ed`
- dynamic importer `_App-BMTSSdCQ.js`

The surface was absent from all three B static entry closures. However, its `CommandDialog`
dependencies caused Rolldown to extract `assets/utils-CpTw4IZK.js` as a new shared static
chunk: 63,446 raw / 13,707 gzip bytes, SHA-256
`de0bc0dc34d80e5522f95e3e1e0e0d6bd5f76105c028e5246d988919f44a06fa`.
That allocation added one static JavaScript file to every renderer entry through these exact
B manifest paths:

- `index.html` → `_checkbox-D-XjhT6S.js` → `_utils-CpTw4IZK.js`
- `popout.html` → `_dropdown-menu-BC06w94O.js` → `_utils-CpTw4IZK.js`
- `web-index.html` → `_label-DgUD63C_.js` → `_utils-CpTw4IZK.js`

The split was beneficial only to the main-window raw total. Because both unrelated renderer
entries grew in raw bytes and JavaScript count, B failed the strict retention rule. Reusing a
misleading settings-owned loader or widening this into shared UI/chunk partitioning was
outside the requested narrow ownership boundary and was not attempted.

## Fresh A/B production evidence

The paths below were ephemeral local build directories used during measurement, not durable
artifacts. The hashes, byte counts, manifests, and conclusions recorded here are the portable
evidence.

- A artifact: `/tmp/orca-markdown-template-picker-a.uAneXM`
- Rejected B artifact: `/tmp/orca-markdown-template-picker-b.yphkkd`
- A transformed 2,003 main, 17 preload, and 9,186 renderer modules.
- B transformed 2,003 main, 17 preload, and 9,187 renderer modules.
- Both builds emitted only the two existing CSS `::highlight(...)` parser warnings.

| Static closure   |     A raw |     B raw | Raw change |    A gzip |    B gzip | Gzip change | A JS | B JS | A CSS | B CSS |
| ---------------- | --------: | --------: | ---------: | --------: | --------: | ----------: | ---: | ---: | ----: | ----: |
| Main window      | 8,416,540 | 8,415,396 |     -1,144 | 1,877,823 | 1,878,138 |        +315 |  292 |  293 |     2 |     2 |
| Dashboard popout | 4,507,253 | 4,507,716 |       +463 |   984,615 |   985,062 |        +447 |   77 |   78 |     2 |     2 |
| Web renderer     | 4,360,652 | 4,361,076 |       +424 |   928,355 |   928,758 |        +403 |   33 |   34 |     1 |     1 |

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

The renderer manifests contain 778 A entries and 780 B entries. Their file SHA-256 values are
`92ad617f8c8aee6d4c4a23622f524266cbe9c93b3fe65544d1acb833dc3f0d67` and
`113190ab27844d76cde6e001933ed2aadfe50bcb1bee6449b3ed06dc3fd63c3b`,
respectively. The complete output trees contain 972 A files and 974 B files; their sorted
SHA-256 manifests are
`09ff908615c9ec1f7f45bfe4f8929e56c2afa25c4a2b32242665d184f4b15df0` and
`8f1b49d7f289874113a4329e6d81e86e4693315d30e97980ef44465a5777bb41`.

Sorted static-closure manifests include path, raw, gzip, and file SHA-256:

| Entry  | A rows / manifest SHA-256                                                | B rows / manifest SHA-256                                                |
| ------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Main   | 294 / `f863c014e40dd4cd49b0864e4fa61c5df98f185712f76b9227fbb5d2cc443488` | 295 / `55f29097cf79973a7b579fba9ae68b50ed7202232fe380855e0086b3fc4ff1a5` |
| Popout | 79 / `b83774dc8005e78455d394f6342824c9c21784c07813e43a3770d6c19ab61d45`  | 80 / `df349c8b2ada54e6f852dca9ff585f5d62c45498dbeaff1c0611caa3cfbe844c`  |
| Web    | 34 / `46925643199b3b8f53da06bed01b5bed8ed070d79fb8b6214d70cf796672e571`  | 35 / `10d5726430fe7176e08ea501089fbcf89677c9bd5bc3621e2360801d7194ec16`  |

The accepted renderer-index raw budget remains 8,466,347, preserving its 49,807-byte
headroom over A. Electron main remains within its 825,109 raw budget with exactly 48,236
bytes of headroom. No budget was changed.

## Restoration and validation

After rejecting B, only the candidate source and test edits were removed and the accepted
source was rebuilt. The restored build transformed 2,003 main, 17 preload, and 9,186 renderer
modules and is file-for-file identical to A across all 972 output files. Its sorted output
manifest SHA-256 is
`09ff908615c9ec1f7f45bfe4f8929e56c2afa25c4a2b32242665d184f4b15df0`.

All 778 A and 780 B renderer manifest entries were checked. Every import key,
dynamic-import key, emitted JavaScript/CSS file, and declared asset exists beneath its
renderer artifact root; both arms had zero missing-target or escaping-path failures.

- Candidate-focused Vitest plus `create-untitled-markdown.test.ts`: 2 files and 11 tests
  passed before the rejected candidate tests were removed.
- Accepted focused `create-untitled-markdown.test.ts`: 1 file and 7 tests passed.
- `pnpm run typecheck:web`: passed.
- Targeted `oxlint --deny-warnings`: passed over the picker, request, creation, App, and
  focused test source.
- Targeted `oxfmt --check`: passed over the same source plus this report.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- `pnpm run check:electron-bundle-budgets`: passed against the restored A output.
- `git diff --check`: passed.

## Residual risk

The accepted picker remains eager. A future attempt needs an allocation strategy that keeps
the picker visual dynamic without extracting a new shared static utility chunk into popout
and web; that is a bundler/shared-UI concern rather than a safe change to request ownership.

No packaged launch smoke was run on macOS, Linux, or Windows. Production builds and manifest
validation ran on this macOS worktree, so packaged cross-platform launch behavior remains
unresolved.
