# Phase 2 runtime Checks repository-snapshot revision stream — 2026-07-30

## Decision

Retain the bounded runtime-routed SSH Checks revision stream. After both exact repository
identities are subscribed and a ready event produces an admissible current-context snapshot,
Checks stops its three-second visible-window snapshot loop. The active status poller remains the
only producer; the stream transports generation/revision invalidation and never launches Git.

Checkpoint: `f5f5880674d1e1583aa8b79bb035c1f8abe1f164`.

The existing loop remains the immediate fail-open path for cold, unsupported, partially
registered, replayed, disconnected, ended, invalidated, malformed, truncated, ambiguous, stale,
or context-mismatched streams and snapshots. Explicit refresh, mutation/reconciliation, retries,
hosted-review creation, Workspace Cleanup, deletion and other safety reads are unchanged.

## Production boundary

The retained path is:

```text
ChecksPanel
→ useChecksPanelRepositorySnapshotRevision
→ ChecksPanelRuntimeRepositorySnapshotRevisions
→ subscribeRuntimeGitRepositorySnapshotRevision
→ runtimeEnvironments.subscribe
→ git.repositorySnapshotRevisions.subscribe
→ RuntimeGitCommands.subscribeRuntimeGitRepositorySnapshotRevision
  ├─ native / exact WSL → subscribeGitRepositorySnapshot
  └─ SSH → current SshGitProvider.subscribeRepositorySnapshot
```

The two registrations independently bind the normal and `reuseLineStats: true` identities and
preserve every explicit push-target field, including absent versus explicit
`remoteCreated: false`. Native and exact WSL use the existing local owner identity and
shared-link paths. SSH binds the current provider generation; replacement detaches the old
listener, emits `invalidated`, rebinds the replacement, and fences late old-provider events.

The renderer request pins the exact runtime environment, pairing revision, and runtime worktree
selector. The Checks context key also contains the worktree ID/path, branch, push target,
connection ID, runtime pairing revision, and existing review/execution identity. Visibility
reactivation receives a new stream activation key, so an earlier admission cannot suppress the
fallback after remount.

Both streams must report `subscribed` for the same provider incarnation. A `ready` event
schedules the existing snapshot read only when it belongs to that paired incarnation; polling
is suppressed only if that read is admitted while its revision-gate token and paired
incarnation remain current. An invalidated event advances only its exact stream identity,
immediately fails open, and clears pending or admitted readiness. A ready event at incarnation
5 therefore cannot suppress polling while its sibling remains at incarnation 4; after the
sibling reaches 5, a later paired ready event and admissible read can suppress polling. Replay
resets both registrations, and both identities must replay and re-register before a later ready
event can establish readiness.

Unsupported or `method_not_found` runtimes make only the two initial long-lived registration
attempts for one mounted exact context. They do not probe again on the three-second cadence.
Error, end, close, disconnect, pairing replacement, provider replacement, context change,
visibility loss, or unmount restores the fallback and detaches renderer, runtime registry, and
repository-owner subscriptions. Main registers cleanup before asynchronous owner setup so
disconnect and shutdown also clean a late-settling subscription.

The method is present in the desktop/runtime registry and deliberately absent from the mobile
RPC allowlist and mobile source RPC literals. Folder workspaces and direct-desktop Checks never
start this runtime stream. No Git command changed, so Git 2.25 behavior and macOS/Linux/Windows
command compatibility are unchanged; the boundary is provider-neutral.

## Deterministic operation counts

The fake-timer measurement runs the actual fallback interval, snapshot-read callback, two stream
registrations, and readiness transition. One active producer publication is instrumented before
each arm.

### One visible idle minute after readiness

| Boundary                                 | A — three-second loop | B — ready stream |
| ---------------------------------------- | --------------------: | ---------------: |
| Normal-hit `git.repositorySnapshot` RPCs |                    20 |                0 |
| Normal-hit repository-owner memory reads |                    20 |                0 |
| Reuse-hit `git.repositorySnapshot` RPCs  |                    40 |                0 |
| Reuse-hit repository-owner memory reads  |                    40 |                0 |
| Physical status producer work            |                     1 |                1 |
| Physical upstream producer work          |                     1 |                1 |

The reuse arm performs two independent snapshot queries per loop tick because the normal
identity is rejected before `reuseLineStats` succeeds. The stream does not move producer work:
status and upstream remain one physical publication in both arms.

### Establishment and event work

| Boundary                                    | Normal hit | Reuse hit |
| ------------------------------------------- | ---------: | --------: |
| Initial long-lived stream registrations     |          2 |         2 |
| Event-triggered snapshot RPCs / owner reads |      1 / 1 |     2 / 2 |
| Snapshot RPCs during the following minute   |          0 |         0 |

Cold, unsupported, partial, replayed, invalidated, or inadmissible paths keep the old
three-second 20/40-query minute. The registrations and reads are logical runtime traffic only;
owner queries launch zero native/WSL Git processes and zero SSH mux Git calls. The active
producer still accounts for the unchanged one status and one upstream operation on native,
exact WSL, and SSH.

## Production A/B

The exact accepted Source Control final archive is A. A fresh immutable final-source build is B:

- A: `/tmp/orca-phase2-source-control-upstream-snapshot-final-b.zEhNcU/out`
- B: `/tmp/orca-phase2-runtime-checks-revision-stream-reviewed-final-b.QCHbOO/out`

Both were produced with `pnpm run build:electron-vite`. The final B build emitted only the two
pre-existing `::highlight(markdown-preview-search-*)` CSS optimizer warnings.

| Entry            | A raw / gzip          | B raw / gzip          | Change |
| ---------------- | --------------------- | --------------------- | ------ |
| Electron main    | 795,061 / 177,873     | 795,061 / 177,871     | 0 / -2 |
| Electron preload | 131,910 / 20,835      | 131,910 / 20,835      | 0 / 0  |
| Renderer index   | 8,416,672 / 1,877,604 | 8,416,672 / 1,877,605 | 0 / +1 |
| Renderer popout  | 4,507,253 / 984,558   | 4,507,253 / 984,558   | 0 / 0  |
| Renderer web     | 4,360,948 / 928,464   | 4,360,948 / 928,462   | 0 / -2 |

Entry file counts are unchanged: index 292 JavaScript / 2 CSS, popout 77 / 2, and web 33 / 1.

| Artifact          | A SHA-256                                                          | B SHA-256                                                          |
| ----------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Main entry        | `425f9aad981977acd42720465a067fc9cd5657c116b9234a210f8e397c26e468` | `2e70f6d92a07fc8c80d487d4033af9dd906578a5a3983ce0a28f4bb02bb815b1` |
| Preload entry     | `2bdcea2978045dcc5ac328c8cc4a32ab2c49da83fcd82ebaa2c8f69f9532c0fc` | `2bdcea2978045dcc5ac328c8cc4a32ab2c49da83fcd82ebaa2c8f69f9532c0fc` |
| Renderer manifest | `5a609614317265a5fd2f6c08b8e8078d6ea31faa30c7a6cef62957e6b38728ec` | `d0b721769edfb149e6b4c85ff1e91752182923bb44a387fd3af713fddc27f9ca` |

Sorted relative-path, NUL separator, and file-byte tree hashes:

| Tree     | Files | A SHA-256                                                          | B SHA-256                                                          |
| -------- | ----: | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Main     |   184 | `e4fa5f0068a262f8f9855680c3be46f2110f376ec39c7b68d4c408688ffa7b6f` | `3960ac27f42d8a2e2d297dcfef70a34e2d98496cbf2857bd9b018bcf6ef6c37f` |
| Preload  |     1 | `c220e1f7cda9e772c28b894048aae889c81bd7167811f10df9a3cd601cf250ef` | `c220e1f7cda9e772c28b894048aae889c81bd7167811f10df9a3cd601cf250ef` |
| Renderer |   789 | `ae7691cf88de15893dafa27e5bc08ffcddcbe6ae8f19f8599f8a4d2cc8aa314a` | `4405391e689e5e19a46a41328145c35da4786542915a5b36a2b7dcaa2b1804ec` |

Complete A/B renderer validation found 780 manifest records, three HTML entries, 6,259 static
edges, 213 dynamic edges, 862 emitted references, and 407 HTML references in each arm. Both have
zero missing manifest keys, missing or escaping emitted paths, missing HTML references, and
static cycles.

## Validation

- Focused runtime Git/RPC/mobile-scope/client/hook/gate/Checks measurement and admission suite:
  63 passed across seven files before the final liveness review; the final broader command below
  includes every added regression.
- Broad runtime Git/RPC/SSH registry/owner, renderer hook/gate/Checks fake-timer, polling,
  refresh-scheduler, and folder suite: 220 passed across 16 files.
- `pnpm run typecheck:node`: passed.
- `pnpm run typecheck:web`: passed.
- Targeted `pnpm exec oxlint --deny-warnings`: passed.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- Fresh final-source `pnpm run build:electron-vite`: passed.
- `pnpm run check:electron-bundle-budgets`: passed.
- Complete A/B manifest/path/reference/static-cycle validation: passed.
- `git diff --check`: passed.

The final independent review added render-current visibility activation, runtime pairing
revision fences, and exact paired-provider-incarnation readiness. Direct class and hook
regressions reproduce the 4/4 registration, 5/4 invalidation mismatch, and later valid 5/5
ordering. A source-boundary regression proves that no invalidation can interleave between the
final synchronous `isReadCurrent` check and returning the admitted snapshot: that segment has no
`await`, and preload subscription delivery invokes the response callback synchronously. No
speculative production commit check, max-lines disable, or ratchet change was added.

## Import graph and ownership

```text
ChecksPanel
→ use-checks-panel-repository-snapshot-revision
→ checks-panel-runtime-repository-snapshot-revisions
→ runtime-git-repository-snapshot-revision-client
→ shared runtime stream contract

Main RPC stream
→ OrcaRuntimeService
→ RuntimeGitCommands
→ native/exact-WSL repository owner OR current SSH provider owner
```

The renderer runtime boundary imports no Checks implementation. Main transport imports the
runtime service and shared request/event contract; the runtime Git owner does not import the RPC
registry. This introduces no reverse edge or Source Control/mobile dependency.

## Limitations and residual risk

- Savings require an admissible active-producer projection. Cold and every fail-open case keep
  the existing polling cost and behavior.
- Counts are deterministic boundary measurements, not live latency samples on every supported
  OS, WSL distro, SSH host, runtime version, or Git provider.
- No packaged launch smoke was run on macOS, Linux, Windows, WSL, or a live SSH host. Existing
  routing, owner identity, provider replacement, pairing, cleanup, and fallback tests cover those
  boundaries deterministically.
- This tranche changes only automatic runtime-routed SSH Checks polling. It does not alter the
  producer scheduler, three-second fallback floor, 60-second safety horizon, explicit/mutation
  freshness, direct desktop subscriptions, folder workspaces, or mobile scope.
