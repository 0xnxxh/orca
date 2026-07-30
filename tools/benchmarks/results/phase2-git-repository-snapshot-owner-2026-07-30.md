# Phase 2 Git repository snapshot owner — 2026-07-30

## Decision

Retain the first live host-scoped, versioned Git repository snapshot owner. Native, exact-distro
WSL, and each `SshGitProvider` incarnation now route both status and upstream reads through this
owner while current APIs continue returning fresh post-settlement work. No TTL result reuse, Git
command, SSH RPC method, payload, renderer subscription, or new RPC was added.

Checkpoint: `b680c59da6d28767af9ae3cd5592ca8b6038db0d`.

## Live ownership

`GitRepositorySnapshotOwner` now owns the existing cancellation-safe status leases, upstream
in-flight sharing, mutation generations, and bounded snapshot publication. The native/WSL process
uses one host-keyed owner; each SSH provider constructs its own owner, and the key also includes
its connection id. A replacement provider therefore begins with no retained snapshot even when it
reuses the same connection id.

Status identities include:

- native versus the exact WSL distro or the per-instance SSH provider;
- worktree path;
- `includeIgnored`;
- `reuseLineStats`;
- effective-upstream negative-cache bypass;
- resolved local status limit; and
- ordered shared-link paths.

Upstream identities include the same execution host and worktree scope, configured-upstream versus
explicit-target mode, and every `GitPushTarget` field: `remoteName`, `branchName`, `remoteUrl`, and
absent versus explicit `remoteCreated: false`.

## Snapshot projection

Each immutable projection contains:

- monotonic process-owner revision and generation timestamp;
- repository head and branch identity;
- immutable status entries, ignored paths, limit state, status length, line-stat state, and
  retention-truncation state;
- configured or explicit-target upstream status, including patch-equivalence fields;
- conflict operation;
- worktree graph version placeholder `0`; and
- per-projection `missing`, `fresh`, `stale`, `failed`, or `placeholder` state with publication
  generation, current generation, revision, and exact projection identity.

A status result's embedded configured upstream can populate the combined snapshot without another
command. A later explicit upstream read updates only its exact target projection. For configured
upstream, the newest direct or status-embedded projection wins, so a fresh post-invalidation status
cannot be shadowed by a stale direct read.

The existing pre/post mutation wrappers increment the owner generation and clear only joinability.
Already-issued caller promises may settle, but their captured record identity and generation must
still match before they can publish. Reads begun before or during a mutation therefore cannot
repopulate the current snapshot after either fence.

## Retention bounds

The owner retains at most:

- 64 repository/worktree scopes;
- four status variants and four upstream variants per scope;
- 1,000 status entries and 1,000 ignored paths per status projection; and
- 64 Ki code units across retained status and ignored paths.

Current status callers still receive their complete original result. If snapshot retention trims a
limit-disabled or unusually large result, `retentionTruncated` is true. Repository and projection
maps use deterministic insertion eviction; publication also requires the exact retained record
object, so a late completion from an evicted identity cannot publish into a newly created record
with the same path.

## A/B physical counts

Opt-in deterministic benchmarks issue ten concurrent identical calls against the mocked physical
Git and mux boundaries.

| Boundary                                 | A — checkpoint | B — snapshot owner |
| ---------------------------------------- | -------------: | -----------------: |
| Local status, unsignalled callers        |              1 |                  1 |
| Local status, distinct-signalled callers |              1 |                  1 |
| Local configured-upstream Git calls      |              4 |                  4 |
| SSH status, unsignalled callers          |              1 |                  1 |
| SSH status, distinct-signalled callers   |              1 |                  1 |
| SSH upstream RPCs                        |              1 |                  1 |

The exact local status command remains:

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

SSH methods and default payloads remain exactly:

```json
[
  {
    "method": "git.status",
    "payload": { "worktreePath": "/home/user/repo" }
  },
  {
    "method": "git.upstreamStatus",
    "payload": { "worktreePath": "/home/user/repo" }
  }
]
```

True status options and explicit targets retain their existing fields; false or absent status
options and absent `pushTarget` remain omitted. Baseline artifacts are
`/tmp/git-snapshot-status-a.json`, `/tmp/git-snapshot-upstream-a.json`,
`/tmp/git-snapshot-ssh-status-a.json`, and `/tmp/git-snapshot-ssh-upstream-a.json`; retained
artifacts use the corresponding `-b.json` names.

## Publication hot-path retention audit

The deterministic publication benchmark compares sequential, already-settled
`GitStatusReadLeaseOwner` reads with `GitRepositorySnapshotOwner.readStatus` reads returning the
same representative result. It therefore isolates owner admission, immutable bounded copying,
freezing, and publication without measuring Git subprocess or parsing time. The retained harness
is `tools/benchmarks/git-repository-snapshot-owner-publication-bench.ts` and runs with:

```text
node --expose-gc --import tsx tools/benchmarks/git-repository-snapshot-owner-publication-bench.ts
```

On Node 24.18.0, Darwin arm64, Apple M4 Max, each arm received 2,000 / 400 / 50 warmup reads for
empty / 100-entry / 1,000-entry payloads. Timing then used 11 alternating rounds of 10,000 / 2,000
/ 250 reads per arm; allocation used seven rounds of 5,000 / 500 / 100 reads per arm with V8 heap
sampling at 128-byte intervals and an explicit GC before each profile. The table is the median of
the per-process medians from four independent process runs:

| Status entries | Lease CPU µs/read | Snapshot CPU µs/read | Incremental CPU µs/read | Incremental wall µs/read | Incremental sampled allocation/read |
| -------------: | ----------------: | -------------------: | ----------------------: | -----------------------: | ----------------------------------: |
|              0 |             0.455 |                1.198 |                  +0.743 |                   +0.683 |                        +1,612 bytes |
|            100 |             0.473 |                4.027 |                  +3.554 |                   +3.501 |                       +15,971 bytes |
|          1,000 |             0.510 |               29.464 |                 +28.954 |                  +28.485 |                      +151,086 bytes |

Incremental CPU ranges across the four processes were 0.710–0.804, 3.505–3.586, and
28.116–29.652 µs/read respectively. V8 sampling measures transient allocation rather than retained
heap; the exact immutable work is zero / 100 / 1,000 entry copies and six / 106 / 1,006
`Object.freeze` calls. The owner replaces the prior retained projection after each settled read,
so these temporary copies do not escape the existing one-projection-per-identity bound.

Every size returned the exact original `GitStatusResult` reference. JSON content and caller-owned
freeze state remained unchanged, while the snapshot, its status collection, and every retained
entry copy were separately frozen. This directly verifies that publication does not mutate or
substitute the current caller result.

No implementation optimization was retained. The 0.7 µs empty-result delta is too small to
justify conditional empty-array paths, and copying plus deep freezing are the mechanisms that keep
caller mutation out of retained snapshots. Deferring those operations until `getSnapshot` would
weaken the owner's uniformly immutable publication contract, while lazily loading query/freshness
code would make the synchronous exported live seam unavailable. The 10,250 raw / 2,043 gzip main
cost is fully main-owned; the former specialized upstream owner is removed, and preload plus
renderer remain byte-identical. At 29 µs for the 1,000-entry bound, publication is proportionate to
the process/RPC Git work and parsing it follows, without introducing a TTL cache or another
physical read.

## Production A/B

Fresh production builds were archived outside the worktree:

- A: `/tmp/orca-phase2-git-repository-snapshot-a.yuLlk5/out`
- B: `/tmp/orca-phase2-git-repository-snapshot-b-final.75XkBW/out`

| Artifact               | A raw / gzip      | B raw / gzip      | Change           | A SHA-256                                                          | B SHA-256                                                          |
| ---------------------- | ----------------- | ----------------- | ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Electron main entry    | 779,267 / 174,769 | 789,517 / 176,812 | +10,250 / +2,043 | `64526204d377f8ca634de5940d77b3f2eff1421bd7a8e7346b0ffcc189be21da` | `6413904f6420882168b8993c1240614bacde1de92dfb26a55c4db67c84007b8e` |
| Electron preload entry | 130,798 / 20,642  | 130,798 / 20,642  | 0 / 0            | `c388a39cdca9609760e286d95b87ad1e53793720450e507f830ff1f6c5bd259f` | `c388a39cdca9609760e286d95b87ad1e53793720450e507f830ff1f6c5bd259f` |

The unchanged Electron-main raw budget is 825,109 bytes; B retains 35,592 bytes of headroom. File
counts remain 184 main, one preload, and 787 renderer artifacts.

| Tree     | A SHA-256                                                          | B SHA-256                                                          |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Main     | `7f6b86e1b736f43d8d259b4ff90f53dd78b0de7ab516dd0f54edf931034bfe2e` | `619e5977034ec79f679489666a826205500de88f51af39c3a3ccf99fbb68874c` |
| Preload  | `06584e5cc8835554c7e0897efe5c578a9f66c3049033b2a3b79b1ca9a88462be` | `06584e5cc8835554c7e0897efe5c578a9f66c3049033b2a3b79b1ca9a88462be` |
| Renderer | `5f6156236d93a03256beb23df69ef705a78dd54a1290c58cc4330fbe8cc34e74` | `5f6156236d93a03256beb23df69ef705a78dd54a1290c58cc4330fbe8cc34e74` |

Preload and every renderer artifact are byte-identical. The renderer manifest is byte-identical
with SHA-256 `92ad617f8c8aee6d4c4a23622f524266cbe9c93b3fe65544d1acb833dc3f0d67`.
Complete A and B validation found 778 manifest records, three HTML entries, 6,247 static edges, 213
dynamic edges, and 860 emitted references, with zero missing or escaping targets, zero cross-entry
imports, and zero cycles.

Renderer entry measurements remain 8,416,540 raw / 1,877,823 gzip for index, 4,507,253 /
984,615 for popout, and 4,360,652 / 928,355 for web. JS/CSS counts remain 292/2, 77/2, and 33/1.

## Validation

- Current-behavior baseline suite: 211 passed.
- Final focused owner/status/upstream/provider suite: 228 passed.
- Physical-count candidate suite: 215 passed.
- Publication benchmark: four independent process runs; caller identity/immutability checks passed
  for empty, 100-entry, and 1,000-entry results.
- Post-audit focused lease/snapshot-owner suite: 14 passed.
- Broad owner, status/cache, native/WSL, upstream, remote, SSH provider/dispatch/session,
  filesystem mutation, and runtime-routing suite: 536 passed, 1 skipped.
- `pnpm run typecheck:node`: passed.
- Targeted `oxlint --deny-warnings`: passed.
- Targeted `oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new bypass.
- Fresh A and B `pnpm run build:electron-vite`: passed.
- Fresh post-audit production build reproduced B exactly: main 789,517 raw / 176,812 gzip with
  SHA-256 `6413904f6420882168b8993c1240614bacde1de92dfb26a55c4db67c84007b8e`, preload
  130,798 / 20,642 with SHA-256
  `c388a39cdca9609760e286d95b87ad1e53793720450e507f830ff1f6c5bd259f`, and renderer
  manifest SHA-256 `92ad617f8c8aee6d4c4a23622f524266cbe9c93b3fe65544d1acb833dc3f0d67`.
- `pnpm run check:electron-bundle-budgets`: passed against fresh B.
- Complete renderer manifest/path and entry-cycle validation: passed for A and B.
- `git diff --check`: passed.

## Next seam and limitations

The next slice can migrate Checks and active polling to the exported snapshot seam, then add
revision subscriptions and runtime/mobile projection transport. This tranche intentionally leaves
those consumers and all RPC surfaces unchanged.

- Revisions and generations are process-local and reset with the host owner.
- Local mutation invalidation remains intentionally coarse across the native/WSL owner; it may
  mark unrelated retained projections stale, but it cannot merge identities or return cached data
  through current APIs.
- Snapshot status retention may be a bounded prefix when the current caller explicitly disables
  the Git status limit; current callers still receive the complete fresh result.
- Counts use mocked physical boundaries and do not measure live subprocess, WSL, or SSH latency.
- No packaged cross-platform or live SSH smoke was run.
