# Phase 2 mobile Source Control repository-snapshot consumer — 2026-07-30

## Decision

Retain snapshot-first loading for only the first connected automatic load of a mounted mobile Source
Control client and status-identity context. On return from diff review, a fresh runtime-owner
projection now avoids a second physical status command; missing or inadmissible projections
immediately retain the existing fresh `git.status` path.

Checkpoint: `0b2662a400308c4fb98e1c8c9c575238adf0ed96`.

This change adds no cache, subscription, timer, TTL, second status identity, or desktop/web
consumer. Pull-to-refresh, Retry, mutation and commit reloads, branch operations, reconciliation,
PR creation/prefill safety reads, forced loads, and reconnects within the same mounted context stay
fresh.

## Boundary and admission

- The best-effort query sends only `{ worktree: "id:<worktree-id>" }`, selecting the exact default
  status identity already published by mobile Source Control.
- The runtime continues to resolve the exact worktree, native versus exact WSL distro, current SSH
  connection/provider incarnation, shared-link paths, and repository owner. The query reads that
  owner's existing projection without launching Git or SSH provider status work.
- Admission requires fresh current-generation status, repository-identity, conflict, and
  configured-upstream projections with finite revisions. The three status sibling identities must
  match and share a generation; upstream must share the generation but is not required to share the
  status identity.
- Status retention must be untruncated. Every retained status entry, repository head/branch, and
  conflict operation passes the existing mobile status parsing boundary. Snapshot-only upstream
  admission additionally requires non-negative safe-integer counts, a nonempty name when upstream
  exists, declared types for present optional fields, and the exact configured no-upstream shape:
  zero counts, no name or patch-equivalence, and only an optional
  `hasConfiguredPushTarget: true`; ambiguous diverged upstream without patch-equivalence is
  rejected.
- Missing, old-runtime, disconnected, rejected, malformed, stale, truncated,
  generation-mismatched, identity-mismatched, or unsafe-upstream results fall through to the
  unchanged selector-retrying `git.status` request. Existing unavailable and error copy is
  preserved.
- Initial disconnected/connecting effects do not consume the opportunity. Identical StrictMode
  effect re-entry coalesces, while later disconnect/reconnect transitions in the same mount use the
  fresh path. A replacement client, host/worktree identity, or remount is a new context with one
  opportunity.
- Load generations and identity/liveness gates suppress late projection commits after fresh-load,
  client, context, or mounted-screen replacement. Render-current client and connection-state guards
  make an in-flight read stale during replacement render, before the following passive effect can
  increment its load generation.
- Folder-workspace routing and exclusions, provider-neutral review behavior, and Git 2.25 command
  compatibility are unchanged; the query launches no new Git command.

## Deterministic physical measurement

`src/main/runtime/orca-runtime-git-repository-snapshot.test.ts` models mobile Source Control status,
opening diff review, and returning to a newly mounted Source Control screen. The checkpoint already
uses a snapshot for initial diff review.

| Boundary                                             | A — checkpoint | B — remount snapshot |
| ---------------------------------------------------- | -------------: | -------------------: |
| Native or exact-WSL physical status loads            |              2 |                    1 |
| Runtime-owned SSH `git.status` provider/mux requests |              2 |                    1 |
| Read-only repository-owner snapshot queries          |              1 |                    3 |
| Snapshot-query Git/provider status work              |              0 |                    0 |

A issues fresh status for the initial Source Control mount, one memory-only diff-review snapshot
query, and fresh status on Source Control remount. B models a cold first mount as one missing
snapshot query plus its fresh fallback, then uses memory-only snapshot queries for diff review and
the Source Control remount. Thus physical native/WSL status work and SSH provider/mux status work
fall from 2 to 1; the two additional B queries are owner-memory reads.

Focused mobile command:

```sh
pnpm --dir mobile exec vitest run \
  src/source-control/mobile-git-repository-snapshot.test.ts \
  src/source-control/mobile-source-control-status-read.test.ts \
  src/source-control/use-mobile-source-control-loaders.test.ts \
  src/session/mobile-diff-review-loaders.test.ts \
  src/session/use-mobile-diff-review-controller.test.ts
```

Result: 64 tests passed across five files after the strict snapshot-only upstream admission and
render-current liveness regressions.

Focused runtime command:

```sh
pnpm exec vitest run \
  src/main/runtime/orca-runtime-git-repository-snapshot.test.ts \
  src/main/runtime/mobile-rpc-allowlist.test.ts \
  src/main/runtime/rpc/methods/git.test.ts
```

Result: 42 tests passed across three files.

## Production bundle evidence

Fresh production output:

- A/current exact Electron archive:
  `/tmp/orca-phase2-mobile-diff-review-snapshot-b-final.jZQlRn/out`
- B/final-source rebuild:
  `/tmp/orca-phase2-mobile-source-control-snapshot-b-final.JOCet4/out`

The new source consumer is in the separate mobile application; the only host change is a test.
`diff -qr` found the complete Electron `out` trees byte-identical. The fresh build and
`pnpm run check:electron-bundle-budgets` passed with only the two known
`::highlight(markdown-preview-search-*)` CSS optimizer warnings.

| Entry            | A raw / gzip          | B raw / gzip          | Change |
| ---------------- | --------------------- | --------------------- | ------ |
| Electron main    | 795,061 / 177,873     | 795,061 / 177,873     | 0 / 0  |
| Electron preload | 131,910 / 20,835      | 131,910 / 20,835      | 0 / 0  |
| Renderer index   | 8,416,603 / 1,877,763 | 8,416,603 / 1,877,763 | 0 / 0  |
| Renderer popout  | 4,507,253 / 984,605   | 4,507,253 / 984,605   | 0 / 0  |
| Renderer web     | 4,360,948 / 928,460   | 4,360,948 / 928,460   | 0 / 0  |

Renderer counts are unchanged: index 292 JS / 2 CSS, popout 77 JS / 2 CSS, and web 33 JS /
1 CSS. The main entry SHA-256 is
`425f9aad981977acd42720465a067fc9cd5657c116b9234a210f8e397c26e468`.

Sorted relative-path-plus-file-byte tree hashes are identical in A and B:

| Tree     | SHA-256                                                            |
| -------- | ------------------------------------------------------------------ |
| Main     | `69466b79451ee1539a0fc26062ac8aef55a60fa83d24d8fca2cefb584f400177` |
| Preload  | `ac78d8c93d022df3fab158ae37cfd62ac0ad8d094f79f7a82b0daf1827ddf091` |
| Renderer | `1b93b2ab43337ae7efe972786cbb9d4a0cb8667cc2c98832422fae7ea0f970a1` |

Complete A/B renderer validation found 779 manifest records, three HTML entries, 6,251 static
edges, 213 dynamic edges, and 861 emitted references, with zero missing or escaping paths, zero
missing manifest edges, and zero static cycles.

## Validation

- Focused mobile snapshot/parser/loader/controller suite: 64 passed across five files.
- Broad mobile Source Control and session suite: 1,083 passed across 136 files.
- Focused runtime snapshot/allowlist/Git RPC suite: 42 passed across three files.
- `pnpm --dir mobile typecheck`, `pnpm run typecheck:node`, and `pnpm run typecheck:web`: passed.
- Targeted `oxlint --deny-warnings` and `oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new bypass.
- Fresh `pnpm run build:electron-vite` and `pnpm run check:electron-bundle-budgets`: passed.
- Complete renderer manifest/path/static-cycle validation and `git diff --check`: passed.
- Source inspection found an acyclic consumer chain:
  `use-mobile-source-control-loaders.ts` → `mobile-source-control-status-read.ts` →
  `mobile-git-repository-snapshot.ts` → `mobile-git-status-rpc.ts` →
  `mobile-git-status.ts` → shared Git status types. Diff review points into the same
  Source Control parser boundary; none of those parser/reader modules imports back into session.

## Limitations and residual risk

- The 2-to-1 saving requires an admissible default projection when the Source Control screen
  remounts. Cold initial mounts and rejected projections pay one best-effort query plus the existing
  fresh status work.
- An old runtime can receive one failed `git.repositorySnapshot` method call on the first connected
  automatic load of each mount before the fresh fallback. No capability bit was added for this
  bounded query-only consumer.
- Counts are deterministic host command/provider-boundary measurements, not packaged latency
  samples on every supported OS, WSL distribution, SSH host, or provider.
- No live device, relay, or packaged SSH smoke was run. Existing runtime target, provider
  incarnation, mobile route, parser, and cancellation tests cover those unchanged boundaries
  deterministically.
- This tranche adds no runtime subscription transport and no desktop or web snapshot consumer.
