# Phase 2 mobile diff-review repository-snapshot consumer — 2026-07-30

## Decision

Retain the initial-load-only mobile diff-review snapshot query. After mobile Source Control has
published the default status identity, opening diff review can reuse that runtime-owner projection
without launching a second status command. Missing or inadmissible projections immediately retain
the existing fresh `git.status` behavior.

Checkpoint: `b47c6c60d5a1a163c612a85301426f920ade8cf5`.

This change adds no cache, subscription, timer, or TTL. It allows the existing read-only
`git.repositorySnapshot` runtime transport for mobile and uses it only for the first automatic
diff-review load.

## Boundary and admission

- The query sends only `{ worktree: "id:<worktree-id>" }`, selecting the same default status
  identity that mobile Source Control publishes. It does not query a second status identity or an
  upstream identity.
- The runtime continues to resolve the exact worktree, native versus exact WSL execution identity,
  current SSH connection/provider incarnation, shared-link paths, and repository owner.
- Admission requires structurally valid status, repository-identity, and conflict projections.
  Each must be fresh in its current generation, carry a finite revision and nonempty identity, and
  all three identities must match. Status retention must be untruncated, and every entry plus the
  head, branch, and conflict operation must pass the existing mobile status parsing boundary.
- Snapshot upstream data is ignored. Diff review reconstructs only entries, head, branch, and
  conflict operation.
- Missing, unsupported old-runtime, disconnected, failed, malformed, stale, truncated, or
  identity-mismatched results fall through to the unchanged fresh `git.status` request. Existing
  unavailable and error copy is preserved.
- The controller keys its one-time snapshot opportunity by client, host, and worktree. Initial
  disconnected states do not consume it, identical React effects remain coalesced, and only the
  first connected load can use it. Later disconnect/reconnect transitions in the same context use
  the fresh path, while the existing generation gate suppresses late results after client or
  context replacement.
- Mutation reloads, retry actions, explicit refreshes, reconciliation, PR creation/prefill safety
  reads, Source Control, and every non-initial loader call remain fresh.
- Folder-workspace routing and exclusions, provider-neutral review behavior, Git 2.25 behavior,
  and relay/runtime ownership are unchanged.

## Deterministic physical measurement

`src/main/runtime/orca-runtime-git-repository-snapshot.test.ts` models a settled mobile Source
Control status followed by opening diff review.

| Boundary                                             | A — fresh review status | B — snapshot review |
| ---------------------------------------------------- | ----------------------: | ------------------: |
| Native or exact-WSL physical status loads            |                       2 |                   1 |
| Runtime-owned SSH `git.status` provider/mux requests |                       2 |                   1 |
| B snapshot-query Git/provider status work            |                       — |                   0 |

A performs one Source Control status and one fresh diff-review status. B performs the same Source
Control status followed by one memory-only repository-owner query. This is a command/provider
boundary measurement rather than a live latency sample.

Focused consumer command:

```sh
pnpm --dir mobile exec vitest run \
  src/session/mobile-diff-review-repository-snapshot.test.ts \
  src/session/mobile-diff-review-loaders.test.ts \
  src/session/use-mobile-diff-review-controller.test.ts
```

Result: 22 tests passed across three files.

Focused runtime command:

```sh
pnpm exec vitest run \
  src/main/runtime/orca-runtime-git-repository-snapshot.test.ts \
  src/main/runtime/mobile-rpc-allowlist.test.ts \
  src/main/runtime/rpc/methods/git.test.ts
```

Result: 42 tests passed across three files.

## Production A/B

Fresh production outputs:

- A: `/tmp/orca-phase2-runtime-checks-snapshot-b-final.wDfAXH/out`
- B: `/tmp/orca-phase2-mobile-diff-review-snapshot-b-final.jZQlRn/out`

A is the archived production build of the exact checkpoint. B was produced from the unchanged
Electron-bundled source with `pnpm run build:electron-vite`;
`pnpm run check:electron-bundle-budgets` passed. The later reconnect correction changed only
mobile, test, and report files, so the accepted Electron A/B remains applicable and was not rebuilt.

| Entry            | A raw / gzip          | B raw / gzip          | Change |
| ---------------- | --------------------- | --------------------- | ------ |
| Electron main    | 795,061 / 177,874     | 795,061 / 177,873     | 0 / -1 |
| Electron preload | 131,910 / 20,835      | 131,910 / 20,835      | 0 / 0  |
| Renderer index   | 8,416,603 / 1,877,763 | 8,416,603 / 1,877,763 | 0 / 0  |
| Renderer popout  | 4,507,253 / 984,605   | 4,507,253 / 984,605   | 0 / 0  |
| Renderer web     | 4,360,948 / 928,460   | 4,360,948 / 928,460   | 0 / 0  |

Renderer entry counts are unchanged: index 292 JS / 2 CSS, popout 77 JS / 2 CSS, and web
33 JS / 1 CSS. The Electron-main entry SHA-256 changes from
`d36891a94908b77e78c79eaa3482e7e0806218b360d1455a9e994e22503a6a4b` to
`425f9aad981977acd42720465a067fc9cd5657c116b9234a210f8e397c26e468`; preload and
renderer-manifest entry files are byte-identical.

Sorted relative-path-plus-file-byte tree hashes:

| Tree     | A SHA-256                                                          | B SHA-256                                                          |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Main     | `0738316d56267649c6ea8967aa814a2b874cb2137fb42d02646deff804e39bdd` | `69466b79451ee1539a0fc26062ac8aef55a60fa83d24d8fca2cefb584f400177` |
| Preload  | `ac78d8c93d022df3fab158ae37cfd62ac0ad8d094f79f7a82b0daf1827ddf091` | `ac78d8c93d022df3fab158ae37cfd62ac0ad8d094f79f7a82b0daf1827ddf091` |
| Renderer | `1b93b2ab43337ae7efe972786cbb9d4a0cb8667cc2c98832422fae7ea0f970a1` | `1b93b2ab43337ae7efe972786cbb9d4a0cb8667cc2c98832422fae7ea0f970a1` |

The renderer tree is byte-identical because the consumer lives in the separate mobile application.
The only Electron source change is the mobile RPC allowlist entry. Complete B manifest validation
found 779 records, three HTML entries, 6,251 static edges, 213 dynamic edges, and 861 emitted
references, with zero missing or escaping paths and zero static cycles.

## Validation

- Broad mobile diff-review and related Source Control route/prefill suite: 66 passed across 11
  files.
- Focused runtime snapshot, mobile allowlist, and Git RPC suite: 42 passed across three files.
- Source inspection found no import cycle. The runtime chain is
  `mobile-diff-review-loaders.ts` → `mobile-diff-review-repository-snapshot.ts` →
  `mobile-diff-review-rpc.ts`; the loader also imports the RPC parser directly, forming a DAG.
  The RPC parser's remaining edges are type-only imports to `mobile-branch-compare.ts` and
  `mobile-git-status.ts`, which point only to shared Git types and never back to the session
  modules.
- `pnpm --dir mobile typecheck`, `pnpm run typecheck:node`, and `pnpm run typecheck:web`: passed.
- Targeted `oxlint --deny-warnings` and `oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new bypass.
- Fresh `pnpm run build:electron-vite` and `pnpm run check:electron-bundle-budgets`: passed with
  only the two known `::highlight(markdown-preview-search-*)` CSS optimizer warnings.
- Complete renderer manifest/path/static-cycle validation and `git diff --check`: passed.

## Limitations and residual risk

- The 2-to-1 saving requires a settled, admissible default projection from mobile Source Control.
  Cold opens and every rejected projection deliberately pay one best-effort query plus the
  existing fresh status work.
- An old runtime can receive one failed `git.repositorySnapshot` method call before the fresh
  fallback. No capability bit was added for this bounded query-only migration.
- Counts are deterministic host command/provider-boundary measurements, not packaged latency
  samples across every OS, WSL distribution, SSH host, or provider.
- No live device, relay, or packaged SSH smoke was run. Existing runtime target, provider
  incarnation, mobile route, and parser tests cover those unchanged boundaries deterministically.
- This mobile tranche adds no runtime subscription transport and adds no desktop or web snapshot
  consumer.
