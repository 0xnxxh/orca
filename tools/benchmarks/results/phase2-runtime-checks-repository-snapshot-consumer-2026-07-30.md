# Phase 2 runtime Checks repository-snapshot consumer — 2026-07-30

## Decision

Retain a query-only runtime RPC projection for automatic Checks. A runtime that owns the selected
worktree can now return its existing native, exact-WSL, or current SSH-provider repository snapshot
without launching Git work. Manual refresh remains on the fresh status/upstream path, and every
missing, unsupported, disconnected, failed, stale, truncated, branch-mismatched,
identity-mismatched, ambiguous-upstream, or otherwise inadmissible projection retains that path.

Checkpoint: `6ca987862f1a5ae506a1d7e75c15b926d4ea5e2a`.

This is not a cache, subscription, timer, or TTL. The runtime RPC is shared transport
infrastructure, with no mobile consumer in this tranche. The runtime resolves the exact worktree
selector and current connection/provider incarnation, then queries the repository owner with the
existing status identity and optional explicit push target.

## Boundary and fallbacks

- `git.repositorySnapshot` validates the existing status options plus all explicit push-target
  fields, including absent versus `remoteCreated: false`.
- Remote-runtime dispatch classifies `git.repositorySnapshot` beside status/upstream as background
  work, so it remains under the background concurrency cap and cannot consume foreground runtime
  capacity.
- Local runtime targets preserve native versus exact WSL distro and repository shared-link paths.
  SSH targets query the current `SshGitProvider` for the resolved connection.
- Automatic Checks queries the ordinary identity and, when needed, the existing
  `reuseLineStats: true` identity. Existing snapshot admission still requires current-generation
  fresh status/upstream, non-truncated retention, the selected branch, exact sibling identity, and
  an unambiguous upstream projection.
- Runtime query errors, including an old runtime's `method_not_found`, are swallowed only at this
  best-effort read boundary. The unchanged fresh runtime status/upstream fallback then runs.
- The existing request-context and liveness gates suppress late commits after panel context
  replacement. Manual Refresh and post-mutation reconciliation do not use the new query.

## Deterministic physical measurement

`src/main/runtime/orca-runtime-git-repository-snapshot.test.ts` models a settled active runtime
poll followed by automatic Checks for both local/exact-WSL and SSH routing.

| Boundary                                      | A — fresh Checks | B — snapshot query |
| --------------------------------------------- | ---------------: | -----------------: |
| Native/WSL physical status loads              |                2 |                  1 |
| Native/WSL physical explicit-upstream loads   |                2 |                  1 |
| Runtime-owned SSH `git.status` provider calls |                2 |                  1 |
| Runtime-owned SSH upstream provider calls     |                2 |                  1 |

The measured B arm performs one read-only snapshot RPC after the active poll because its first
identity is admissible. Automatic Checks can attempt both the normal and `reuseLineStats: true`
identities, so the rejected-snapshot path can issue two read-only snapshot RPCs. Runtime-side
snapshot queries add zero Git subprocesses and zero SSH mux requests; if neither projection is
admissible, the existing fresh fallback deliberately preserves the A work and behavior.

Focused command:

```sh
pnpm exec vitest run \
  src/main/runtime/orca-runtime-git.test.ts \
  src/main/runtime/orca-runtime-git-repository-snapshot.test.ts \
  src/main/runtime/rpc/methods/git.test.ts \
  src/renderer/src/components/right-sidebar/checks-panel-repository-snapshot-client.test.ts \
  src/renderer/src/components/right-sidebar/ChecksPanel.repository-snapshot-boundary.test.ts \
  src/renderer/src/components/right-sidebar/checks-panel-git-status-snapshot.test.ts
```

Result: 99 tests passed across six files. Adding the focused runtime call-queue suite produced 106
passing tests across seven files.

## Production A/B

Fresh production outputs:

- A: `/tmp/orca-phase2-runtime-checks-snapshot-a.mYdZeP/out`
- B: `/tmp/orca-phase2-runtime-checks-snapshot-b-final.wDfAXH/out`

Both were produced with `pnpm run build:electron-vite`; the final-source B rebuild and bundle
budget check passed, with only the two known `::highlight(markdown-preview-search-*)` CSS
optimizer warnings.

| Entry            | A raw / gzip          | B raw / gzip          | Change      |
| ---------------- | --------------------- | --------------------- | ----------- |
| Electron main    | 795,061 / 177,868     | 795,061 / 177,874     | 0 / +6      |
| Electron preload | 131,910 / 20,835      | 131,910 / 20,835      | 0 / 0       |
| Renderer index   | 8,416,603 / 1,877,761 | 8,416,603 / 1,877,763 | 0 / +2      |
| Renderer popout  | 4,507,253 / 984,605   | 4,507,253 / 984,605   | 0 / 0       |
| Renderer web     | 4,360,652 / 928,323   | 4,360,948 / 928,460   | +296 / +137 |

Renderer entry file counts are unchanged: index 292 JS / 2 CSS, popout 77 JS / 2 CSS, and web
33 JS / 1 CSS. The main-entry SHA-256 changed from
`e536ed0c16ca8071e74fb1bfdf9253ea8c75b2e1cf9cb40987f6f78085de5f7e` to
`d36891a94908b77e78c79eaa3482e7e0806218b360d1455a9e994e22503a6a4b`.

Sorted relative-path-plus-file-byte tree hashes:

| Tree     | A SHA-256                                                          | B SHA-256                                                          |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Main     | `7d7ef59ed34c71754bab5007bd84d0946562e4ce79aeb507b8fae35b28a2f3ee` | `0738316d56267649c6ea8967aa814a2b874cb2137fb42d02646deff804e39bdd` |
| Preload  | `ac78d8c93d022df3fab158ae37cfd62ac0ad8d094f79f7a82b0daf1827ddf091` | `ac78d8c93d022df3fab158ae37cfd62ac0ad8d094f79f7a82b0daf1827ddf091` |
| Renderer | `88a283ea45b11eba107e2f3a1fb772ef92b524a84b486991b6bdce3c8e27c7c3` | `1b93b2ab43337ae7efe972786cbb9d4a0cb8667cc2c98832422fae7ea0f970a1` |

`pnpm run check:electron-bundle-budgets` passed. Complete A and B renderer validation found 779
manifest records, three HTML entries, 6,251 static edges, 213 dynamic edges, and 861 emitted
references, with zero missing or escaping paths and zero static cycles.

## Validation

- Focused runtime command/RPC/renderer admission suite plus runtime call queue: 106 passed.
- Broad host repository owner, status, SSH provider/dispatch, runtime command, and runtime RPC
  suite: 663 passed, one skipped. One renderer test was intentionally rerun with the renderer
  config after the mixed-config invocation could not resolve its `@` alias.
- Broad renderer runtime client, desktop snapshot, runtime RPC, Checks, snapshot revision, and
  folder-workspace suite: 110 passed.
- Web preload fallback suite: 91 passed.
- `pnpm run typecheck:node`, `pnpm run typecheck:web`, and
  `pnpm --dir mobile typecheck`: passed.
- The fresh shared-code invalidation exposed the web fallback Git API's pre-existing incomplete
  structural implementation from the desktop snapshot subscription tranche. Explicit inert
  `repositorySnapshot` and `subscribeRepositorySnapshot` fallbacks now preserve the full API
  contract without RPC, callbacks, listeners, timers, or a web/mobile snapshot consumer.
- Targeted `oxlint --deny-warnings` and `oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypass.
- Fresh `pnpm run build:electron-vite` and `pnpm run check:electron-bundle-budgets`: passed.
- Complete A/B renderer manifest/path/static-cycle validation and `git diff --check`: passed.

## Limitations and residual risk

- The savings require an admissible projection from active polling. Cold opens and every rejected
  projection pay the existing fresh status/upstream work.
- Counts are deterministic command/provider-boundary measurements, not live latency samples on
  every supported OS, WSL distribution, SSH host, or provider.
- Old runtimes can incur two failed best-effort method calls—normal and `reuseLineStats: true`—
  before the fresh fallback. No capability bit was added because this tranche is deliberately
  method-compatible and query-only.
- Mobile does not consume the new method, and automatic Checks does not subscribe to runtime
  snapshot revisions.
