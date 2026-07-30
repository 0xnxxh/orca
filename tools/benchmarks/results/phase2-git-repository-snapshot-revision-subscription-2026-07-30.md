# Phase 2 Git repository snapshot revision subscription — 2026-07-30

## Decision

Retain the host-to-renderer generation/revision subscription and migrate automatic desktop
Checks invalidation from renderer Git-status/upstream store references to the host-owned
`GitRepositorySnapshot` seam. The active poller remains the producer, and a ready event only
causes Checks to query the immutable projection; it does not run Git or an SSH RPC itself.

Checkpoint: `6fbeb2abda6e987f459e452942aedbcec937ecb7`.

This adds no timer, TTL, settled-result cache, Git command, SSH RPC method, relay method, runtime
transport, or renderer store owner. Existing status/upstream APIs remain fresh after settlement.

## Subscription boundary

Each subscription is exact for:

- native versus exact WSL distro or the current `SshGitProvider` instance;
- registered worktree/folder backing path and local shared-link paths;
- status options including `includeIgnored`, negative-cache bypass, and `reuseLineStats`;
- configured upstream versus every explicit `GitPushTarget` field, including absent
  `remoteCreated` versus explicit `false`; and
- the subscribing `WebContents`.

IPC events contain only the caller-generated subscription ID, state, generation, revision, and SSH
provider incarnation. Repository paths and snapshots are never broadcast. Explicit unsubscribe,
sender destruction/reload, context or visibility change, connection loss, provider replacement,
and handler disposal all detach the exact owner listener.

Checks derives its local identity from the resolved project runtime, so changing a project-level
Windows-host/WSL override or WSL distro changes the context and rebinds the subscription.

SSH registry replacement increments `incarnation`, detaches the old provider before rebinding, and
starts the replacement provider at generation/revision zero. A binding token suppresses late
events from the old provider. Active runtime environments return `null` from the desktop
subscription client and keep the existing runtime/SSH visibility interval and fresh RPC route.

The owner emits `invalidated` at existing mutation fences and `ready` only when the requested
status plus configured or explicit upstream projection is admissible. Retention-truncated status
and ambiguous ahead-plus-behind upstream state do not wake Checks. A retained explicit upstream
can complete a later status revision only when HEAD and branch identity are unchanged.
An ambiguous newer embedded configured-upstream projection cannot fall through to an older
complete projection.

Checks subscribes to the ordinary and `reuseLineStats: true` polling identities. Its revision gate:

1. advances invalidation/provider-incarnation fences without launching work;
2. coalesces duplicate same-revision delivery;
3. records ready events arriving during a Checks read;
4. queries the owner again after a fresh fallback without running Git; and
5. schedules a trailing read only when the newest ready revision is newer than the projection the
   completed read observed.

Monotonic read tokens fence late completion from a previous context. Subscription handles are
retained as each registration settles, so context cleanup is exact even if its sibling registration
remains pending. A renderer send failure closes the main-process subscription and cannot rebind a
replacement SSH provider or reject the status/upstream producer.

This removes `gitStatusByWorktree` and `remoteStatusesByWorktree` from the automatic Checks
snapshot effect dependencies. Those store values remain only as the existing bounded Publish
fallback, while manual Refresh, retry, runtime routing, and cold/inadmissible fallback behavior are
unchanged.

## Deterministic operation counts

The retained owner test overlaps two identical status callers and two identical explicit-upstream
callers, then has the ready listener query the projection.

| Boundary                                                              |   A |   B |
| --------------------------------------------------------------------- | --: | --: |
| Physical local/WSL status reads                                       |   1 |   1 |
| Physical local/WSL explicit-upstream reads                            |   1 |   1 |
| SSH `git.status` RPCs under the retained settled-overlap path         |   1 |   1 |
| SSH `git.upstreamStatus` RPCs under the retained settled-overlap path |   1 |   1 |
| Physical work launched by one ready event                             |   0 |   0 |
| Automatic Checks store-trigger dependencies                           |   2 |   0 |
| Exact owner projection queries after a fresh fallback                 |   0 |   1 |

The extra B query is memory-only. It observes the publication revision so the ready event produced
by the same fallback does not launch duplicate status/upstream work. Existing ten-caller status
and upstream owner suites continue to prove 10-to-1 physical sharing and unchanged exact commands
and RPC payloads.

For fan-out, 100 same-identity owner subscribers receive 100 callbacks backed by one frozen owner
event object. After 100 unsubscriptions the owner retains zero listeners. Checks normally owns two
preload listeners, one per exact polling identity; both are removed on cleanup. Main allocates one
small incarnation wrapper per targeted subscription because different SSH incarnations cannot
share that object.

## Production A/B

Fresh builds were archived outside the worktree:

- A: `/tmp/orca-phase2-snapshot-revision-subscription-a.h4Db8W/out`
- retained B: `/tmp/orca-phase2-snapshot-revision-subscription-reviewed.sd8qpB/out`

| Artifact               | A raw / gzip      | B raw / gzip      | Delta           | A SHA-256                                                          | B SHA-256                                                          |
| ---------------------- | ----------------- | ----------------- | --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Electron main entry    | 789,869 / 176,858 | 795,061 / 177,868 | +5,192 / +1,010 | `7f4984a54c65cf5b749a87ed7ec7f2074c5b844992215ad25e8c17d179045660` | `e536ed0c16ca8071e74fb1bfdf9253ea8c75b2e1cf9cb40987f6f78085de5f7e` |
| Electron preload entry | 130,891 / 20,658  | 131,910 / 20,835  | +1,019 / +177   | `afa8494e803f0e57cabdb5d2ff636f30fc8021069a7694d57d2ecdcdd6837a8a` | `2bdcea2978045dcc5ac328c8cc4a32ab2c49da83fcd82ebaa2c8f69f9532c0fc` |
| Renderer manifest      | 403,000 / 48,288  | 403,037 / 48,306  | +37 / +18       | `9f57d550a1c9f6c75bf2d3db4f5ff53e53c4c52eceb8b10e9b86d8659a48d7fe` | `b615db1461347955088d93a91186d2b07997b761eb2e9a21c50433261914f731` |

Electron main remains 30,048 raw bytes below its unchanged 825,109 budget. Preload remains 90 raw
bytes below its unchanged 132,000 budget.

| Renderer entry | A raw / gzip          | B raw / gzip          | Delta  | A JS/CSS | B JS/CSS |
| -------------- | --------------------- | --------------------- | ------ | -------- | -------- |
| Index          | 8,416,540 / 1,877,824 | 8,416,540 / 1,877,828 | 0 / +4 | 292 / 2  | 292 / 2  |
| Popout         | 4,507,253 / 984,615   | 4,507,253 / 984,615   | 0 / 0  | 77 / 2   | 77 / 2   |
| Web            | 4,360,652 / 928,352   | 4,360,652 / 928,351   | 0 / -1 | 33 / 1   | 33 / 1   |

| Tree     | A files / SHA-256                                                        | B files / SHA-256                                                        |
| -------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Main     | 184 / `fb9d10e85030515e08c78e1226fa574c3c3828a68b2639b4a0cf0773b185fd11` | 184 / `d30fbdb2eedf419d28f4aeda85f1df22877329621c12c951b2c4412d155328c8` |
| Preload  | 1 / `750483cc40dc0e5f9612ea63f2e09d587ef77230ceda36144ee1a380c0274908`   | 1 / `c220e1f7cda9e772c28b894048aae889c81bd7167811f10df9a3cd601cf250ef`   |
| Renderer | 787 / `3e37f385175e2b51309723d5b5bf50742d9256bb11399f1b3913122e87850acb` | 787 / `422a591173e891ae1de38a9014ece3ef2342131b2e5636466baf4a608fab2a02` |

Complete A and B manifest validation found 778 records, three HTML entries, 213 dynamic edges,
860 emitted references, no missing or escaping targets, no cross-entry imports, and no static
cycles. A has 6,247 static edges and B has 6,248 because the Checks chunk now imports its concrete
revision hook.

## Independent review

Independent acceptance added regression coverage and corrected:

- ambiguous embedded configured-upstream admission through an older projection;
- a late read from a previous context consuming the current context's revision;
- sender delivery failure escaping into a producer or leaking an SSH rebind;
- a successful subscription handle being hidden from cleanup by a pending sibling; and
- project-level Windows/WSL runtime changes not rebinding the exact host identity.

The core IPC registrar test was also updated to exercise the new store-bound registrar.

## Validation

- Focused owner, IPC, preload, provider registry, desktop routing, status projection, revision gate,
  and hook tests: 75 passed.
- Broad host status/cache, native/WSL, SSH provider/dispatch, filesystem, IPC, and preload suite:
  376 passed, one skipped.
- Broad renderer snapshot, polling, refresh scheduler, folder-workspace, runtime routing, and Checks
  suite: 121 passed.
- Core IPC registrar suite: two passed.
- `pnpm run typecheck:node`: passed.
- `pnpm run typecheck:web`: passed.
- Targeted `pnpm exec oxlint --deny-warnings`: passed.
- Targeted `pnpm exec oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new bypass.
- Fresh A and retained B `pnpm run build:electron-vite`: passed.
- `pnpm run check:electron-bundle-budgets`: passed against retained B.
- Complete renderer manifest/path/static-cycle validation: passed for A and B.
- `git diff --check`: passed.
- Added/changed max-lines-disable scan: zero.

The production build emitted the two pre-existing CSS optimizer warnings for the standard
`::highlight(markdown-preview-search-*)` selectors; no new build warning was introduced.

## Limitations and next seam

- Subscription savings require active polling to publish an admissible status/upstream projection.
  Cold, failed, stale, truncated, branch-mismatched, runtime-routed, and manual-refresh paths retain
  the fresh fallback.
- Invalidation alone deliberately does not wake Checks. The matching ready event follows the
  active poller's complete status/upstream publication, preventing a status-only wakeup from
  launching duplicate upstream work.
- Measurements are deterministic mocked owner/RPC operation counts, not live Git latency across
  every supported host.
- Runtime/mobile snapshot transport and renderer snapshot payload subscriptions remain later work.
  The next seam is migrating another desktop status consumer to the revision/query boundary, then
  introducing a bounded provider-neutral transport only when a runtime consumer is selected.
- No packaged smoke was run on Windows, WSL, Linux, or a live SSH host. Existing path, identity,
  provider replacement, mutation fence, command, and routing suites cover the unchanged behavior.
