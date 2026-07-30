# Phase 2 Source Control automatic-upstream repository-snapshot consumer — 2026-07-30

## Decision

Retain snapshot-first loading for Source Control's automatic visible-tab upstream read. When
active polling has already published current status and configured-upstream evidence, switching
to Source Control can now consume the runtime-owned projection instead of repeating physical
upstream work.

Checkpoint: `c04cb9fadcf6a1bddcf794b0361f30377dc1051b`.

Only the automatic visible-tab effect changed. Explicit refreshes, mutations, reconciliation,
active polling, Workspace Cleanup, review creation safety reads, and deletion preflights remain
fresh. The tranche adds no cache, subscription, timer, TTL, Git command, provider-specific review
behavior, or mobile consumer.

## Production sequence and boundary

The measured sequence is:

1. Existing Source Control polling calls `refreshGitStatusForWorktree`, which performs status and
   upstream work and publishes the ordinary identity for interactive/activity refreshes or the
   distinct `reuseLineStats: true` identity for a safety refresh. The owner may retain either.
2. Source Control is hidden or unmounted while another right-sidebar tab is visible.
3. Switching back to Source Control mounts its automatic upstream consumer.
4. The consumer independently queries both identities through
   `getRuntimeGitRepositorySnapshot`, tolerates either read failing, and selects the newest
   admissible projection by status revision.
5. When neither result is admissible, the existing `fetchUpstreamStatus` path runs fresh with
   store application disabled; the hook applies its result only while the captured render context
   remains current.

The desktop client keeps native versus exact-WSL path ownership and resolves SSH reads through the
current provider for the captured connection ID. Runtime-owned worktrees use the exact runtime
worktree selector and can issue at most two read-only `git.repositorySnapshot` RPCs.

## Admission and liveness

- Top-level revision and generation time must be structurally valid. Status, repository identity,
  and upstream projections must be fresh in their current generation.
- Status and repository freshness must have identical nonempty identity, generation, and non-null
  revision. Upstream must share the status generation but is not incorrectly required to share
  status identity.
- Status retention must be untruncated and repository branch identity must equal the current
  Source Control branch, including detached/no-branch identity.
- Upstream counts must be non-negative safe integers. A configured upstream requires a nonempty
  name and declared optional-field types. No-upstream requires zero counts, no name or
  patch-equivalence field, and only an optional `hasConfiguredPushTarget: true`. Diverged
  ahead-plus-behind evidence without patch-equivalence is rejected.
- Missing, old-runtime, disconnected, rejected, failed, stale, truncated, malformed, ambiguous,
  generation-mismatched, identity-mismatched, or branch-mismatched projections immediately keep
  the fresh fallback.
- The hook's exact key covers worktree ID, filesystem path, branch, connection ID, SSH provider
  epoch and connection generation, runtime target, and every push-target field while preserving
  absent versus explicit `remoteCreated: false`.
- Render-current visibility/context checks suppress late results before the next passive effect.
  Changed contexts abort and replace in-flight work; identical StrictMode effect re-entry
  coalesces; unmount aborts after the StrictMode remount window. Folder workspaces never enter this
  path.

## Deterministic A/B work counts

The focused loader test models the exact post-poll tab switch.

| Boundary                                   | A — fresh automatic read | B — owner projection |
| ------------------------------------------ | -----------------------: | -------------------: |
| Native/exact-WSL physical status work      |                        1 |                    1 |
| Configured-upstream computation            |                        2 |                    1 |
| Separate native/exact-WSL upstream work    |                        1 |                    0 |
| Repository-owner memory reads              |                        0 |                    2 |
| SSH provider/mux `git.status` work         |                        1 |                    1 |
| SSH provider/mux `git.upstreamStatus` work |                        1 |                    0 |
| Desktop runtime RPCs                       |                        0 |                    0 |

The unchanged polling producer accounts for one status and one embedded configured-upstream
computation in both arms. A then repeats configured-upstream work through the separate automatic
upstream call; B replaces that call with two memory-only owner reads.

Runtime transport is reported separately because it trades one logical RPC for eliminating
physical upstream work:

| Runtime boundary             |   A |   B |
| ---------------------------- | --: | --: |
| `git.status` RPC             |   1 |   1 |
| `git.upstreamStatus` RPC     |   1 |   0 |
| `git.repositorySnapshot` RPC |   0 |   2 |
| Total Git RPCs               |   2 |   3 |
| Physical upstream work       |   1 |   0 |

An old runtime, disconnected runtime, or two inadmissible runtime projections performs up to two
snapshot attempts and then the existing one fresh `git.upstreamStatus` RPC. No status work is
removed or added.

## Production A/B

The exact starting checkpoint archive is the accepted final build of the immediately preceding
Space Manager tranche:

- A: `/tmp/orca-phase2-workspace-space-snapshot-authoritative-b.f4Hmrd/out`
- B: `/tmp/orca-phase2-source-control-upstream-snapshot-final-b.zEhNcU/out`

Both were built with `pnpm run build:electron-vite`. B is the final post-review source. The final
build and `pnpm run check:electron-bundle-budgets` passed with only the two known
`::highlight(markdown-preview-search-*)` CSS optimizer warnings.

| Entry            | A raw / gzip          | B raw / gzip          | Change   |
| ---------------- | --------------------- | --------------------- | -------- |
| Electron main    | 795,061 / 177,873     | 795,061 / 177,873     | 0 / 0    |
| Electron preload | 131,910 / 20,835      | 131,910 / 20,835      | 0 / 0    |
| Renderer index   | 8,416,670 / 1,877,594 | 8,416,672 / 1,877,604 | +2 / +10 |
| Renderer popout  | 4,507,253 / 984,558   | 4,507,253 / 984,558   | 0 / 0    |
| Renderer web     | 4,360,948 / 928,465   | 4,360,948 / 928,464   | 0 / -1   |

Entry file counts are unchanged: renderer index 292 JS / 2 CSS, popout 77 JS / 2 CSS, and web
33 JS / 1 CSS. Electron main and preload entries are byte-identical:

- main SHA-256:
  `425f9aad981977acd42720465a067fc9cd5657c116b9234a210f8e397c26e468`
- preload SHA-256:
  `2bdcea2978045dcc5ac328c8cc4a32ab2c49da83fcd82ebaa2c8f69f9532c0fc`

Sorted relative-path, NUL separator, and file-byte tree hashes:

| Tree     | A SHA-256                                                          | B SHA-256                                                          |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Main     | `e4fa5f0068a262f8f9855680c3be46f2110f376ec39c7b68d4c408688ffa7b6f` | `e4fa5f0068a262f8f9855680c3be46f2110f376ec39c7b68d4c408688ffa7b6f` |
| Preload  | `c220e1f7cda9e772c28b894048aae889c81bd7167811f10df9a3cd601cf250ef` | `c220e1f7cda9e772c28b894048aae889c81bd7167811f10df9a3cd601cf250ef` |
| Renderer | `e3ef80345b7050164bff21c21c255b3ebf547b3f7fc4b341a56f9120f70d1fb0` | `ae7691cf88de15893dafa27e5bc08ffcddcbe6ae8f19f8599f8a4d2cc8aa314a` |

Renderer manifest SHA-256 changes from
`8fb604cb48622a39208d773287bcd7227224916363431531836e146519c30302` to
`5a609614317265a5fd2f6c08b8e8078d6ea31faa30c7a6cef62957e6b38728ec`.
Both archives contain 184 main files, one preload file, and 789 renderer files. Manifest
validation found 780 records, three HTML entries, 213 dynamic edges, 862 emitted references, and
407 HTML references in each arm; static edges change from 6,256 to 6,259. Both arms have zero
missing import keys, missing or escaping emitted paths, missing or escaping HTML references, and
static cycles.

## Validation

Focused consumer, validator, hook, boundary, polling, refresh, and Space compatibility command:

```sh
pnpm exec vitest run --config config/vitest.config.ts \
  src/renderer/src/runtime/git-repository-snapshot-upstream.test.ts \
  src/renderer/src/components/right-sidebar/source-control-automatic-upstream-snapshot.test.ts \
  src/renderer/src/components/right-sidebar/use-source-control-automatic-upstream-snapshot.test.tsx \
  src/renderer/src/components/right-sidebar/SourceControl.automatic-upstream-snapshot-boundary.test.ts \
  src/renderer/src/components/status-bar/workspace-space-git-status-snapshot.test.ts \
  src/renderer/src/components/status-bar/use-workspace-space-git-status-refresh.test.tsx \
  src/renderer/src/components/right-sidebar/useGitStatusPolling.test.ts \
  src/renderer/src/components/right-sidebar/useGitStatusPolling.rerender.test.ts \
  src/renderer/src/components/right-sidebar/git-status-refresh.test.ts \
  src/renderer/src/components/right-sidebar/git-status-refresh-scheduler.test.ts
```

Result: 123 tests passed across ten files.

Broad renderer command covered every right-sidebar and status-bar suite plus desktop snapshot and
runtime Git clients:

```sh
pnpm exec vitest run --config config/vitest.config.ts \
  src/renderer/src/components/right-sidebar \
  src/renderer/src/components/status-bar \
  src/renderer/src/runtime/desktop-git-repository-snapshot-client.test.ts \
  src/renderer/src/runtime/runtime-git-client.test.ts \
  src/renderer/src/runtime/runtime-git-client-merge.test.ts
```

Result: 1,913 tests passed across 227 files.

- `pnpm run typecheck:web` and `pnpm run typecheck:node`: passed.
- Targeted `pnpm exec oxlint --deny-warnings` and `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypass. `SourceControl.tsx` shrank by six lines; new production modules are 163, 154, and 55
  lines.
- `pnpm run build:electron-vite` and `pnpm run check:electron-bundle-budgets`: passed.
- Complete A/B renderer manifest/path/reference/static-cycle validation: passed.
- `git diff --check`: passed.

The source import graph is acyclic:

```text
SourceControl
→ use-source-control-automatic-upstream-snapshot
→ source-control-automatic-upstream-snapshot
  ├─→ runtime-git-repository-snapshot-client
  │   ├─→ desktop-git-repository-snapshot-client
  │   └─→ runtime-rpc-client + runtime-worktree-selector
  └─→ git-repository-snapshot-upstream

WorkspaceSpaceManagerPanel
→ use-workspace-space-git-status-refresh
→ workspace-space-git-status-snapshot
→ git-repository-snapshot-upstream
```

The renderer runtime boundary imports no Source Control, status-bar, or Workspace Space module;
neither consumer imports back into its caller.

## Limitations and residual risk

- Savings require polling to have published an admissible projection before the automatic
  visible-tab load. A cold open or rejected projection adds two cheap memory/RPC queries before
  the existing fresh upstream read.
- Runtime ownership saves physical upstream work but increases the successful logical RPC count
  from two to three. Desktop native, exact WSL, and SSH paths add only memory reads.
- Counts are deterministic command/provider-boundary tests, not packaged latency samples on every
  supported OS, WSL distribution, SSH host, or provider.
- No live packaged SSH or runtime smoke was run. Existing provider-incarnation, runtime selector,
  folder-workspace, cancellation, Git 2.25, and provider-neutral suites cover the unchanged
  boundaries deterministically.
- This tranche does not alter status work, poll cadence, explicit refresh, mutation or
  reconciliation freshness, review creation, Workspace Cleanup, or deletion safety.
