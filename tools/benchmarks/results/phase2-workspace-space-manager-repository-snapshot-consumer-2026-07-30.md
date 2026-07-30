# Phase 2 Workspace Space Manager repository-snapshot consumer — 2026-07-30

## Decision

Retain snapshot-first loading for the automatic missing-status fan-out in
`WorkspaceSpaceManagerPanel`. A preceding Workspace Cleanup scan already publishes fresh status
and configured-upstream evidence to the host repository owner without populating renderer
`gitStatusByWorktree`; opening Space Manager can now consume that memory-only evidence instead of
repeating physical Git work.

Checkpoint: `92ac61850d95d3af0ee8d96f578d4803ec00c1b4`.

The change adds no cache, subscription, timer, TTL, Git command, or owner. It does not alter
Workspace Cleanup reads, active polling, explicit refresh, mutation or Source Control safety
reads, folder-workspace/main-worktree exclusions, or deletion preflights.

## Production chain and boundary

The measured production sequence is:

1. `WorkspaceCleanupDialog` automatically calls `scanWorkspaceCleanup`.
2. `readWorkspaceCleanupGitEvidence` executes native/exact-WSL `getStatus` or the current
   `SshGitProvider.getStatus`. Status computes configured-upstream evidence and publishes the
   normal status identity to the existing host repository owner.
3. Cleanup evidence returns only to the cleanup dialog. It does not call renderer `setGitStatus`,
   so `gitStatusByWorktree` remains missing.
4. `openSpacePage` mounts `WorkspaceSpaceManagerPanel`. Its existing six-worker candidate fan-out
   now queries the normal and `reuseLineStats: true` owner identities independently.
5. The newest admissible projection is selected by non-null status projection revision and applied
   through the existing `setGitStatus`, `updateWorktreeGitIdentity`, and `setUpstreamStatus`
   dependencies. When neither identity is admissible, the unchanged
   `refreshGitStatusForWorktree` fallback runs.

Local snapshot transport preserves the exact filesystem selector, native versus WSL resolution,
and current SSH connection/provider incarnation in the existing owner. Runtime-owned worktrees use
the provider-neutral `git.repositorySnapshot` transport with the exact runtime worktree selector;
normal and line-stat-reuse identities can issue at most two background snapshot RPCs.

## Admission and liveness

- Status, repository identity, conflicts, and configured upstream must all be fresh in their
  current generation. Repository and conflict identity, generation, and revision must exactly
  match status; upstream must share the generation but is not incorrectly required to share the
  status identity.
- Status revision is a non-null safe integer, retention is untruncated, and the repository branch
  exactly matches the analyzed Space row. Status entries, ignored paths, counts, optional fields,
  conflict state, repository identity, and top-level snapshot metadata are structurally checked.
- Upstream counts must be non-negative safe integers. A configured upstream requires a nonempty
  name and declared optional-field types. No-upstream requires exact zero counts, no name or
  patch-equivalence field, and only an optional `hasConfiguredPushTarget: true`. Diverged
  ahead-plus-behind evidence without patch-equivalence is rejected.
- The two identity reads settle independently, so one failure cannot discard a valid sibling.
  Missing, old-runtime, disconnected, failed, stale, truncated, branch-mismatched,
  identity-mismatched, generation-mismatched, malformed, ambiguous, or otherwise inadmissible
  projections preserve the fresh fallback.
- The hook coalesces identical StrictMode effects. Render-current row path/repo/branch, connection,
  runtime target, mounted state, and still-missing store guards fence late results before the next
  passive effect. Context replacement aborts the superseded load; unmount aborts after the
  StrictMode remount window. The panel's cached repo map is also an explicit scheduling dependency,
  so a connection-only SSH provider replacement requeues the same eligible missing row with the
  new connection identity.
- Snapshot admission and the first fresh-fallback commit both require the exact live context and a
  still-missing renderer status entry. Once the fresh fallback owns that first commit, a separate
  exact-context predicate lets the same refresh finish its identity and upstream writes without
  mistaking its own status entry for external replacement; external preemption before commit and
  later context cancellation still stop application.

## Deterministic physical measurement

`workspace-space-git-status-snapshot.test.ts` models the exact Cleanup-then-Space sequence for
native, exact WSL, and current SSH-provider routing. Host owner, SSH provider/mux, desktop
snapshot, and runtime command tests verify the unchanged execution boundaries.

| Boundary                                           | A — fresh fan-out | B — owner projection |
| -------------------------------------------------- | ----------------: | -------------------: |
| Native/exact-WSL physical status work              |                 2 |                    1 |
| SSH provider/mux `git.status` work                 |                 2 |                    1 |
| Configured-upstream computation embedded in status |                 2 |                    1 |
| Separate `upstreamStatus` work                     |                 0 |                    0 |
| Repository-owner memory reads                      |                 0 |                    2 |
| Desktop runtime RPCs                               |                 0 |                    0 |

The A arm is one fresh Cleanup status plus one fresh Space status. The B arm keeps the Cleanup
status and replaces the Space status with two memory reads; the normal identity is admissible in
the concrete chain while the independently queried reuse identity is absent. Snapshot queries
launch zero Git subprocesses and zero SSH mux requests.

Runtime transport is reported separately because Workspace Cleanup's desktop-host owner does not
imply that an active runtime owner is warm:

| Runtime path                                     | Snapshot RPCs | Fresh status RPCs |
| ------------------------------------------------ | ------------: | ----------------: |
| Both reads attempted, either identity admissible |             2 |                 0 |
| Old runtime (`method_not_found`)                 |             2 |                 1 |
| Missing/inadmissible runtime owner projections   |             2 |                 1 |
| Disconnected before query                        |       up to 2 |                 1 |

## Production A/B

Fresh production archives:

- A: `/tmp/orca-phase2-workspace-space-snapshot-a.QsLwmB/out`
- B: `/tmp/orca-phase2-workspace-space-snapshot-authoritative-b.f4Hmrd/out`

Both were built with `pnpm run build:electron-vite`; B is the final post-correction source. The B
build and `pnpm run check:electron-bundle-budgets` passed with only the two known
`::highlight(markdown-preview-search-*)` CSS optimizer warnings.

| Entry            | A raw / gzip          | B raw / gzip          | Change     |
| ---------------- | --------------------- | --------------------- | ---------- |
| Electron main    | 795,061 / 177,873     | 795,061 / 177,873     | 0 / 0      |
| Electron preload | 131,910 / 20,835      | 131,910 / 20,835      | 0 / 0      |
| Renderer index   | 8,416,603 / 1,877,763 | 8,416,670 / 1,877,594 | +67 / -169 |
| Renderer popout  | 4,507,253 / 984,605   | 4,507,253 / 984,558   | 0 / -47    |
| Renderer web     | 4,360,948 / 928,460   | 4,360,948 / 928,465   | 0 / +5     |

Entry file counts are unchanged: renderer index 292 JS / 2 CSS, popout 77 JS / 2 CSS, and web
33 JS / 1 CSS. Electron main SHA-256 is unchanged at
`425f9aad981977acd42720465a067fc9cd5657c116b9234a210f8e397c26e468`; preload entry SHA-256 is
unchanged at `2bdcea2978045dcc5ac328c8cc4a32ab2c49da83fcd82ebaa2c8f69f9532c0fc`.

Sorted relative-path-plus-file-byte tree hashes:

| Tree     | A SHA-256                                                          | B SHA-256                                                          |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Main     | `69466b79451ee1539a0fc26062ac8aef55a60fa83d24d8fca2cefb584f400177` | `69466b79451ee1539a0fc26062ac8aef55a60fa83d24d8fca2cefb584f400177` |
| Preload  | `ac78d8c93d022df3fab158ae37cfd62ac0ad8d094f79f7a82b0daf1827ddf091` | `ac78d8c93d022df3fab158ae37cfd62ac0ad8d094f79f7a82b0daf1827ddf091` |
| Renderer | `1b93b2ab43337ae7efe972786cbb9d4a0cb8667cc2c98832422fae7ea0f970a1` | `c95d7db46ddb836d1bc12c8c063c376fbae4ac3f94d5b415939422b077f8e24e` |

The renderer manifest changed from 779 to 780 records, 6,251 to 6,256 static edges, and 861 to
862 emitted references; both have three HTML entries and 213 dynamic edges. Complete validation
found zero missing manifest edges, missing or escaping emitted paths, and static cycles in both
arms. The renderer output changed from 788 to 789 files. Manifest SHA-256 changed from
`876547b7ceb1a1b4283cc294048c09de81219c5466172e8db044bcf5fadc9c4e` to
`8fb604cb48622a39208d773287bcd7227224916363431531836e146519c30302`.

## Validation

Focused renderer command:

```sh
pnpm exec vitest run --config config/vitest.config.ts \
  src/renderer/src/components/status-bar/workspace-space-git-status-snapshot.test.ts \
  src/renderer/src/components/status-bar/use-workspace-space-git-status-refresh.test.tsx \
  src/renderer/src/components/status-bar/workspace-space-presentation.test.ts \
  src/renderer/src/components/right-sidebar/checks-panel-repository-snapshot-client.test.ts
```

Result: 59 tests passed across four files after the fresh-fallback ownership and connection
replacement regressions. The acceptance-correction snapshot, hook, and `git-status-refresh`
command passed 46 tests across
three files.

Broad relevant command included the focused consumer tests plus desktop snapshot transport, status
refresh, delete flow and dirty probe, Workspace Cleanup evidence, Workspace Space analysis, host
repository owner, SSH provider, runtime snapshot command, and runtime call queue suites. Result:
251 tests passed across 13 files.

- Broad status-bar, right-sidebar, desktop snapshot, and runtime RPC client suites: 1,871 passed
  across 223 files.
- `pnpm run typecheck:node` and `pnpm run typecheck:web`: passed.
- Targeted `oxlint --deny-warnings` and `oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypass. The panel shrank from 2,086 to 2,008 lines; parsing and scheduling live in narrow domain
  modules.
- Final post-correction `pnpm run build:electron-vite` and
  `pnpm run check:electron-bundle-budgets`: passed.
- Complete A/B renderer manifest/path/reference/static-cycle validation and `git diff --check`:
  passed.

The source import graph is acyclic:

```text
WorkspaceSpaceManagerPanel
→ use-workspace-space-git-status-refresh
→ workspace-space-git-status-snapshot
  ├─→ workspace-space-git-snapshot-upstream
  ├─→ runtime-git-repository-snapshot-client
  │   ├─→ desktop-git-repository-snapshot-client
  │   └─→ runtime-rpc-client + runtime-worktree-selector
  └─→ git-status-refresh → runtime-git-client
```

The generic runtime snapshot client imports no status-bar or Checks code. The existing
Checks-specific boundary now delegates to it, and no downstream module imports back into
Workspace Space.

## Limitations and residual risk

- Savings require a still-missing renderer status entry and an admissible owner projection from a
  preceding host read. A cold open or rejected projection adds two cheap memory queries before the
  existing fresh work.
- An ordinary remount with `gitStatusByWorktree` already populated remains the existing zero-work
  path and does not issue snapshot queries.
- Counts are deterministic command/provider-boundary measurements, not packaged latency samples
  on every supported OS, WSL distribution, SSH host, or provider.
- No live packaged SSH or runtime smoke was run. Existing exact-WSL, SSH provider-incarnation,
  runtime selector, owner-generation, folder-workspace, and cancellation tests cover the unchanged
  boundaries deterministically.
- Workspace Cleanup remains fresh. Manual refresh, active polling, mutations, Source Control,
  reconciliation, and authoritative local/SSH deletion preflights do not consume this automatic
  snapshot path.
