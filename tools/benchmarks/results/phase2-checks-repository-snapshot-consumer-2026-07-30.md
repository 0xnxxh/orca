# Phase 2 Checks repository-snapshot consumer — 2026-07-30

## Decision

Retain a read-only desktop projection query and migrate automatic Checks eligibility reads to the
host-owned `GitRepositorySnapshot` seam. When active polling has already published a complete
current-generation status and upstream projection, Checks now uses that immutable projection
instead of repeating status and upstream work. Manual Checks Refresh and every incomplete,
stale, failed, truncated, branch-mismatched, or runtime-routed case keep the existing fresh path.

Checkpoint: `98134f6f7b8921f0964d99395a2fa91b91ea806e`.

This is intentionally not a TTL cache. Existing status and upstream APIs still run fresh after
settlement, and the new IPC query never runs Git or an SSH RPC.

## Consumer boundary

The active polling path remains the producer. Its existing native, exact-WSL-distro, and
per-`SshGitProvider` owners publish status and upstream projections through
`GitRepositorySnapshotOwner`; existing pre/post mutation fences continue to mark those projections
stale and suppress late publication into the current generation.

Automatic Checks now:

1. queries the exact desktop owner identity;
2. admits only `fresh` status and upstream projections;
3. rejects retention-truncated status, a missing upstream projection, and a branch mismatch; and
4. falls back to the unchanged fresh status/upstream path when admission fails.

The query checks both existing polling status identities: the ordinary identity and the safety
poll identity with `reuseLineStats: true`. These remain separate owner identities; the second
lookup is read-only and does not merge them. Identity also retains worktree path, native versus
exact WSL distro, shared-link paths, `includeIgnored`, negative-cache bypass, and every explicit
push-target field. The Checks context key now preserves absent `remoteCreated` versus explicit
`false`, as well as absent versus present `remoteUrl`.

SSH lookup is routed to the current provider instance for `connectionId`, so replacement and
reconnect incarnations cannot share projections. Local folder-workspace IDs are reduced to their
registered backing folder path before IPC. Active runtime-environment ownership returns `null`
from the desktop client and uses the existing runtime Git path; runtime/mobile snapshot transport
is not added in this slice.

Manual Checks Refresh remains on the existing fresh APIs. No Git command, SSH RPC method or
payload, retry timer, visibility interval, slow-task scheduler, signal, mutation wrapper, relay
routing, or provider-specific review behavior changed.

## Deterministic physical-owner measurement

The focused owner and SSH-provider tests model the same settled overlap: active polling completes
status plus upstream publication, then automatic Checks requests the same identity in that refresh
horizon.

| Boundary                                   | A — fresh Checks | B — snapshot query |
| ------------------------------------------ | ---------------: | -----------------: |
| Local/WSL physical status loads            |                2 |                  1 |
| Local/WSL physical explicit-upstream loads |                2 |                  1 |
| SSH `git.status` RPCs                      |                2 |                  1 |
| SSH `git.upstreamStatus` RPCs              |                2 |                  1 |

The B query itself adds two read-only owner lookups in the worst case—ordinary and
`reuseLineStats` identities—but zero subprocesses and zero mux requests. If neither snapshot is
admissible, the original fresh load count and behavior are preserved.

The physical status command remains:

```text
git -c core.quotePath=false status --porcelain=v2 --branch --untracked-files=all
```

The configured-upstream chain remains:

```text
git symbolic-ref --quiet --short HEAD
git rev-parse --abbrev-ref HEAD@{u}
git rev-list --left-right --count HEAD...origin/main
git log --oneline --cherry-mark --right-only HEAD...origin/main --
```

The SSH methods and payload omission rules remain:

```json
[
  {
    "method": "git.status",
    "payload": { "worktreePath": "/home/user/repo" }
  },
  {
    "method": "git.upstreamStatus",
    "payload": {
      "worktreePath": "/home/user/repo",
      "pushTarget": {
        "remoteName": "fork",
        "branchName": "feature",
        "remoteUrl": "ssh://git.example/repo",
        "remoteCreated": false
      }
    }
  }
]
```

Absent options and absent `pushTarget` remain omitted. Existing command and provider suites
continue to cover configured upstreams, explicit publish targets, ahead/behind and patch
equivalence, no-upstream behavior, Git 2.25 compatibility, WSL path handling, SSH/system-SSH, and
relay routing.

## Production A/B

Fresh production builds were archived outside the worktree:

- A: `/tmp/orca-phase2-checks-snapshot-a.hBrWy8/out`
- B: `/tmp/orca-phase2-checks-snapshot-b-reviewed.bNuaXj/out`

| Artifact               | A raw / gzip      | B raw / gzip      | Change     | A SHA-256                                                          | B SHA-256                                                          |
| ---------------------- | ----------------- | ----------------- | ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Electron main entry    | 789,517 / 176,812 | 789,869 / 176,858 | +352 / +46 | `6413904f6420882168b8993c1240614bacde1de92dfb26a55c4db67c84007b8e` | `7f4984a54c65cf5b749a87ed7ec7f2074c5b844992215ad25e8c17d179045660` |
| Electron preload entry | 130,798 / 20,642  | 130,891 / 20,658  | +93 / +16  | `c388a39cdca9609760e286d95b87ad1e53793720450e507f830ff1f6c5bd259f` | `afa8494e803f0e57cabdb5d2ff636f30fc8021069a7694d57d2ecdcdd6837a8a` |
| Renderer manifest      | 403,000 / 48,291  | 403,000 / 48,288  | 0 / -3     | `92ad617f8c8aee6d4c4a23622f524266cbe9c93b3fe65544d1acb833dc3f0d67` | `9f57d550a1c9f6c75bf2d3db4f5ff53e53c4c52eceb8b10e9b86d8659a48d7fe` |

The Electron-main raw budget remains 825,109 bytes; B retains 35,240 bytes of headroom. File
counts remain 184 main, one preload, and 787 renderer artifacts.

| Renderer entry | A raw / gzip          | B raw / gzip          | Change | A JS/CSS | B JS/CSS |
| -------------- | --------------------- | --------------------- | ------ | -------- | -------- |
| Index          | 8,416,540 / 1,877,823 | 8,416,540 / 1,877,824 | 0 / +1 | 292 / 2  | 292 / 2  |
| Popout         | 4,507,253 / 984,615   | 4,507,253 / 984,615   | 0 / 0  | 77 / 2   | 77 / 2   |
| Web            | 4,360,652 / 928,355   | 4,360,652 / 928,352   | 0 / -3 | 33 / 1   | 33 / 1   |

Deterministic tree hashes use sorted relative paths plus file bytes:

| Tree     | A SHA-256                                                          | B SHA-256                                                          |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Main     | `70eee832a22181051dd0a807ac8192f2d2863b0f6706c21199b98245abb11d82` | `8d24293dafe6879300ff618f62582ebc68483a1af85f09c943dcdf63009f2696` |
| Preload  | `2d85a03ecdb77d9762630a9fe2783b4da2042e09e470a43250b697f24008f209` | `f211a353bdfcb09de909134f1c2d91c920819f20b3f8b26baca5e72ba9f6e05b` |
| Renderer | `0b5610733f4e17999a72ea356965276cd728320400af97fdd8c83c42a50a0e71` | `2d792b983f3d45c8d3a2e270599705518f45c2b4a936925256bbea04505b0d52` |

Complete A and B manifest validation found 778 records, three HTML entries, 6,247 static edges,
213 dynamic edges, and 860 emitted references, with zero missing or escaping targets, zero
cross-entry imports, and zero cycles.

An initial rejected renderer arm placed the desktop query in broad `runtime-git-client.ts`. Its
archive is `/tmp/orca-phase2-checks-snapshot-b.IaVlMF/out`; it added 643 raw bytes to each of
index, popout, and web. Moving the query to the concrete
`desktop-git-repository-snapshot-client.ts` boundary eliminates that eager raw-byte tax while
keeping the same main/preload cost and call-count win.

## Validation

- Focused owner/provider/filesystem/runtime/Checks suite:
  `pnpm exec vitest run ...` — 276 passed, one skipped after the independent review added an
  ambiguous embedded-upstream fallback regression.
- Broad host owner, status/cache, native/WSL, SSH provider/dispatch, and filesystem suite:
  `pnpm exec vitest run ...` — 364 passed, one skipped.
- Broad renderer runtime, status refresh/polling, push-target cache, Checks, and folder-workspace
  suite: `pnpm exec vitest run --config config/vitest.config.ts ...` — 128 passed.
- Independent combined host/renderer review suite: 481 passed, one skipped.
- `pnpm run typecheck:node`: passed.
- `pnpm run typecheck:web`: passed.
- Targeted `pnpm exec oxlint --deny-warnings`: passed.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new bypass.
- Fresh A and B `pnpm run build:electron-vite`: passed.
- `pnpm run check:electron-bundle-budgets`: passed against fresh B.
- Complete renderer manifest/path and static-cycle validation: passed for A and B.
- `git diff --check`: passed.
- Added/changed max-lines-disable scan: zero.

## Limitations and next seam

- Savings occur when polling has published an admissible projection before automatic Checks
  demand. A cold Checks open, stale projection, mutation fence, branch transition, truncated
  status, ambiguous upstream, or failed read deliberately pays the existing fresh work.
- The counts are deterministic mocked physical-owner and mux-boundary measurements, not live
  subprocess latency measurements across every supported host.
- The read-only IPC is desktop-only. Active runtime environments intentionally fall back to their
  existing fresh RPC route; runtime/mobile projection transport remains later work.
- This slice does not subscribe Checks to snapshot revisions. The next coherent seam is a bounded
  host-to-renderer revision subscription that invalidates consumers without adding another polling
  loop, followed by migration of remaining renderer status consumers.
- No packaged smoke was run on Windows, WSL, Linux, or a live SSH host. Existing routing,
  identity, folder-workspace, provider, mutation-fence, and Git-command suites cover the unchanged
  boundaries.
