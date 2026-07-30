# Phase 2 Delete Worktree dirty-warning snapshot consumer — 2026-07-30

## Decision

Retain the bounded migration of the Delete Worktree dialog's warning-only Git status probe to the
desktop host-owned repository snapshot. A complete current-generation status for the exact
selected worktree route now avoids a second settled physical status read; every inadmissible
snapshot keeps the existing fresh `getRuntimeGitStatus` path.

Checkpoint: `f70570278293d555a062da8d27bc15a5cf5f6f9e`.

Each snapshot is admitted only when status, repository identity, and conflicts are all `fresh`,
the three status-derived projection identities agree, and retention is not truncated. Upstream is
neither required nor copied into the warning result, so a missing or stale upstream projection
cannot block or contaminate the warning.

## Routing and safety

The dialog still excludes main worktrees and folder workspaces, skips worktrees with renderer
status already cached, and probes every uncached target independently. It continues to derive
settings with `getSettingsForWorktreeRuntimeOwner` and the selected worktree id, then passes the
selected SSH connection id. This preserves native versus exact project-selected WSL routing, SSH
provider/incarnation lookup, paired-runtime and project-runtime fallback, multi-target and lineage
behavior, and focused-host independence.

`getDesktopGitRepositorySnapshot` remains desktop-only. Runtime-owned worktrees return no desktop
snapshot and use the existing runtime RPC. The read-only query checks the ordinary and
`reuseLineStats: true` safety-poll identities without merging them. Both reads settle even when the
first is valid or one fails, and the greater monotonic status projection revision wins when both
are admissible. This avoids shared newer upstream records equalizing the snapshots' top-level
revisions. Snapshot API errors, missing/failed/stale/truncated or identity-mismatched snapshots,
and fresh fallback failures remain best-effort. Effect cleanup gates both fallback start and final
store commit, so dialog close or target/context replacement cannot commit a late result.

The destructive path is unchanged. Main-side removal still performs its authoritative dirty/lock
preflight before watcher or PTY teardown; snapshot data only improves the confirmation warning.

## Deterministic A/B physical counts

The focused owner/provider tests model an active status poll settling before the dialog opens.
Arm A repeats the existing fresh status read for the dialog; arm B performs one poll and then a
read-only snapshot lookup.

| Boundary                                 | A — fresh dialog probe | B — owner snapshot | Change |
| ---------------------------------------- | ---------------------: | -----------------: | -----: |
| Native physical status loads             |                      2 |                  1 |   -50% |
| Exact WSL distro physical status loads   |                      2 |                  1 |   -50% |
| Current SSH provider `git.status` RPCs   |                      2 |                  1 |   -50% |
| Additional Git/upstream work from lookup |                      0 |                  0 |      0 |

The renderer admission suite independently verifies the same 2-to-1 overlap, stale sibling
rejection, missing/stale upstream independence, normal-only and reuse-only admission, newest
selection in both directions, equal top-level revisions caused by a shared newer upstream, null
status revision fallback, one-query failure isolation, every fallback class, runtime routing,
error swallowing, and late-result suppression.

Reproduce the count tests:

```text
pnpm exec vitest run --config config/vitest.config.ts \
  src/main/git/git-repository-snapshot-owner.test.ts \
  src/main/providers/ssh-git-provider.test.ts \
  src/renderer/src/components/sidebar/delete-worktree-dirty-status-probe.test.ts
```

## Production A/B

Production builds are archived outside the worktree:

- A: `/tmp/orca-phase2-delete-dialog-snapshot-a.WRXagk/out`
- B: `/tmp/orca-phase2-delete-dialog-snapshot-b-status-revision-final.tN4shc/out`

The clean A baseline was preserved, and corrected B was freshly rebuilt with:

```text
pnpm run build:electron-vite
node config/scripts/electron-bundle-entry-report.mjs
```

| Entry               | A raw / gzip          | B raw / gzip          | Change raw / gzip |
| ------------------- | --------------------- | --------------------- | ----------------: |
| Electron main       | 795,061 / 177,868     | 795,061 / 177,868     |             0 / 0 |
| Electron preload    | 131,910 / 20,835      | 131,910 / 20,835      |             0 / 0 |
| Renderer index      | 8,416,540 / 1,877,828 | 8,416,603 / 1,877,761 |         +63 / -67 |
| Renderer popout     | 4,507,253 / 984,615   | 4,507,253 / 984,605   |           0 / -10 |
| Renderer web        | 4,360,652 / 928,351   | 4,360,652 / 928,323   |           0 / -28 |
| Delete dialog chunk | 28,555 / 6,276        | 30,825 / 6,895        |     +2,270 / +619 |

JavaScript/CSS counts remain 292/2 for index, 77/2 for popout, and 33/1 for web. Main and preload
trees remain byte-identical. The renderer gains one concrete dialog-owned module while existing
shared chunk placement leaves the full index entry nearly flat.

| Artifact               | A SHA-256                                                          | B SHA-256                                                          |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Electron main entry    | `e536ed0c16ca8071e74fb1bfdf9253ea8c75b2e1cf9cb40987f6f78085de5f7e` | `e536ed0c16ca8071e74fb1bfdf9253ea8c75b2e1cf9cb40987f6f78085de5f7e` |
| Electron preload entry | `2bdcea2978045dcc5ac328c8cc4a32ab2c49da83fcd82ebaa2c8f69f9532c0fc` | `2bdcea2978045dcc5ac328c8cc4a32ab2c49da83fcd82ebaa2c8f69f9532c0fc` |
| Renderer manifest      | `b615db1461347955088d93a91186d2b07997b761eb2e9a21c50433261914f731` | `c3162257a83fa948abdc57b9d759c3925110612ba8a7c5ba4c05e849e180f715` |

Complete manifest/path validation found 778 A and 779 B records, three HTML entries in each arm,
6,248 A and 6,251 B static edges, 213 dynamic edges in each arm, and 860 A / 861 B emitted
references. Both arms have zero missing or escaping targets, cross-entry imports, or static cycles.

## Validation

- Final focused status-projection revision probe suite: 30 passed.
- Broad relevant owner/status/native/WSL/SSH/filesystem/removal/dialog/client suite: 611 passed,
  two skipped.
- `pnpm run typecheck:node`: passed.
- `pnpm run typecheck:web`: passed.
- Targeted `pnpm exec oxlint --deny-warnings`: passed.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- Preserved clean A and fresh corrected B `pnpm run build:electron-vite`: passed.
- `pnpm run check:electron-bundle-budgets`: passed.
- Complete A/B renderer manifest/path and static-cycle validation: passed.
- `git diff --check`: passed.
- Added max-lines disable scan: zero newly added disables.

## Residual risk

- The win applies only when active polling has already published the same complete, current owner
  identity. Cold, stale, failed, truncated, unsupported, mismatched, or runtime-routed reads
  deliberately pay the fresh path.
- Measurements use deterministic mocked physical-owner and SSH mux boundaries, not live
  subprocess or network latency.
- No packaged Windows/WSL, Linux, or live SSH smoke was run. Existing exact-distro, provider
  replacement, request-routing, runtime-owner, folder-workspace, and removal-preflight suites
  cover the unchanged boundaries.
- No subscription, timer, TTL, cache, runtime/mobile snapshot transport, or Git command changed.
