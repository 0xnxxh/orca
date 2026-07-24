# Deleting one workspace kills sibling terminal/agent sessions (`cwdOwned` fallback)

Tracking: [#10252](https://github.com/stablyai/orca/issues/10252)

## Problem

Deleting one workspace (right-click → delete) can terminate terminal/agent
sessions that belong to **other** workspaces — siblings that share the same
checkout path, and even worktrees of a *different* repo rooted under that path.
Both `pi` and Claude Code agent sessions are affected. All co-located sessions
die at the same instant with no recovery; the underlying agent processes are
killed.

This is most destructive when a repo's checkout path is a broad directory (e.g.
a home directory registered as a folder repo) that hosts multiple independent
workspaces.

## Root cause

Destructive workspace removal calls `killAllProcessesForWorktree()`
(`src/main/runtime/worktree-teardown.ts`), which runs three sweeps to find PTYs
belonging to the deleted worktree:

| Sweep | Ownership test | Cross-worktree safe? |
| --- | --- | --- |
| `runtime.stopTerminalsForWorktree` | `leaf.worktreeId === worktree.id` (exact) | ✅ exact id |
| `sweepRegistryForWorktree` | `entry.worktreeId === worktreeId` (exact) | ✅ exact id |
| `sweepProviderByPrefix` | `id.startsWith(`${worktreeId}@@`)` **or** `session.worktreeId === worktreeId` **or** `cwdOwned` | ⚠️ `cwdOwned` over-matches |

Only the provider sweep's **path-based `cwdOwned` fallback** over-matches:

```ts
// src/main/runtime/worktree-teardown.ts (~255)
const cwdOwned =
  worktreePath !== undefined &&
  session.worktreeId === undefined &&            // only untagged sessions
  typeof session.cwd === 'string' &&
  session.cwd.length > 0 &&
  isPathInsideOrEqual(worktreePath, session.cwd) // ← kills ANY session under the path
return session.id.startsWith(prefix) || session.worktreeId === worktreeId || cwdOwned
```

The `worktreePath` fed into this check comes from
`splitWorktreeIdForFilesystem(worktreeId)`, which **strips the
`::workspace:<uuid>` suffix** for folder-workspace instances:

```ts
// src/shared/worktree-id.ts
worktreePath: parsed.worktreePath.replace(FOLDER_WORKSPACE_INSTANCE_SUFFIX, '')
```

So when a folder-workspace instance
`repo::/Users/me::workspace:<deleted-uuid>` is deleted, `worktreePath`
collapses to the **shared checkout directory** `/Users/me` used by *every*
workspace instance rooted there (and every nested worktree of any repo under it).
`isPathInsideOrEqual('/Users/me', session.cwd)` then matches essentially every
session on the machine for that user. Any such session whose `worktreeId` is
`undefined` is swept and killed.

### Why the fallback exists, and why the `worktreeId === undefined` guard is not enough

The `cwdOwned` branch is intentional: some legacy/older daemon or local rows
carry a real `cwd` but no `worktreeId` tag, and for a **normal git worktree**
(unique path) matching by path is a sound ownership proxy. See the existing
test `stops cwd-owned PTYs even when their ids have no worktree prefix`.

Sessions legitimately reach `worktreeId === undefined`:

- **Local PTYs** spawned without an explicit `worktreeId` — `LocalPtyProvider.listProcesses()` only sets `worktreeId` when `ptyWorktreeId.get(id)` is truthy (`local-pty-provider.ts:1329`, tag set only when `args.worktreeId` was passed at spawn, `:869`).
- **Legacy / bare-UUID daemon sessions** whose id does not parse to a `${repoId}::${path}` shape, so `parsePtySessionId()` returns `{ worktreeId: null }` and `DaemonPtyAdapter.listProcesses()` omits the field.

The guard is correct for unique worktree paths but wrong for folder-workspace
instances, where the path **cannot** identify a single instance because the
suffix strip erases the only per-instance discriminator (the `<uuid>`).

### Why the other kill paths are safe

`runtime.stopTerminalsForWorktree` resolves the selector to a concrete
`worktree.id` and matches leaves/ptys by exact id (`orca-runtime.ts` ~23197);
`sweepRegistryForWorktree` matches registry rows by exact `worktreeId`
(`worktree-teardown.ts:304`). Neither uses paths. Confirmed by reading both
implementations — the collateral originates solely in `cwdOwned`.

The daemon's startup reconcile/orphan sweep
(`daemon-pty-adapter.ts` `reconcileOnStartup`, ~882) is also **not** a
collateral vector: it matches by the exact `worktreeId` parsed from the session
id against the valid-worktree set (no path matching), runs at app launch rather
than on delete, and is currently unwired in production ("No production caller
yet"). A sibling instance (different uuid, still valid) survives it.

## Reproduction

Deterministic unit reproduction (added to `worktree-teardown.test.ts`):

- Delete `repo-1::/Users/dev/project::workspace:<uuid-A>`.
- Provider lists an **untagged** session `{ id: 'floating-sibling', cwd: '/Users/dev/project' }` (a sibling instance's live agent) with no `worktreeId`.
- **Before fix:** `provider.shutdown('floating-sibling', …)` is called → collateral kill.
- **After fix:** it is not called.

Manual reproduction: register a folder repo whose checkout path hosts multiple
workspaces; open a long-lived agent in workspace A; create workspace B on the
same path; delete B → A's terminal/agent is also killed.

## Fix

The cwd fallback is a valid ownership proxy only when a worktree's filesystem
path uniquely identifies it. Rather than name a specific id shape, key directly
on that invariant: **trust the fallback only when the filesystem path is the
*whole* worktree path — i.e. when `splitWorktreeIdForFilesystem` stripped
nothing.** A folder-workspace instance strips its `::workspace:<uuid>` suffix to
a shared checkout dir, so stripping shortens the path and the fallback is left
unset. Deletion then relies only on the exact prefix (`${worktreeId}@@`, which
contains the instance uuid) and the authoritative `session.worktreeId ===
worktreeId` match — both precise per instance.

Implementation — resolve the cwd-fallback path inside `sweepProviderByPrefix()`
(where the ownership decision is made), comparing the raw parsed path against
the filesystem path. Because `cwdOwned` already guards on the path being
defined, leaving it `undefined` disables *only* the path fallback and leaves
prefix/`worktreeId` matching (and the runtime/registry sweeps) untouched.
Keeping the resolution here also lets `killAllProcessesForWorktree()` stop
threading a path entirely (one fewer parameter), and the `#10252` caveat sits
next to the `cwdOwned` logic.

```ts
// src/main/runtime/worktree-teardown.ts — inside sweepProviderByPrefix()
// Why (#10252): the cwd fallback only proves ownership when the filesystem path
// is the *whole* worktree path. A folder-workspace instance strips its
// `::workspace:<uuid>` suffix to a checkout dir shared with sibling instances,
// so leave the fallback unset whenever stripping shortened the path.
const fullWorktreePath = splitWorktreeId(worktreeId)?.worktreePath
const cwdFallbackPath =
  splitWorktreeIdForFilesystem(worktreeId)?.worktreePath === fullWorktreePath
    ? fullWorktreePath
    : undefined
```

### Why keying on the strip is sufficient (the root-id case)

The invariant fires only when stripping shortens the path, i.e. for instance ids
(`…::workspace:<uuid>`) — **not** the bare folder-workspace *root* id
`repo::/Users/me`. The root id has no suffix, so stripping is a no-op and the
fallback stays active; for a broad home-dir folder repo its path *is* the shared
directory. This is not a gap only because **deleting the root is blocked
upstream, before the sweep runs**: `worktrees.ts:1420`, `:1941` and
`orca-runtime.ts:20529` all throw *"Cannot delete the project root workspace.
Remove the folder project instead."* Only instances reach
`killAllProcessesForWorktree`, and every instance id carries the suffix — so the
strip-based check covers the entire delete path. Existing regression tests
assert the root-delete guard (`orca-runtime.test.ts:3663`,
`worktrees.test.ts:6910`, `:9048`), so this invariant can't silently regress.

### Accepted tradeoff

For a deleted folder-workspace instance, a truly *untagged* session is no longer
force-killed by this path. That is the correct default: when ownership is
unprovable we must not guess, since the cost of a wrong guess is killing a live
sibling agent. In practice folder-instance terminals are spawned **tagged** with
the instance id (daemon sessions derive `worktreeId` from their minted id), so
they are still torn down via prefix/`worktreeId`; this only affects legacy/edge
untagged PTYs. Note the local registry and generation sweeps do **not**
backstop that residual case (the registry row is likewise untagged, and
generation cleanup fires on renderer reload, not on delete) — leaving such a
session alive is the intended safe direction.

## Alternatives considered

- **Tag every spawned PTY with its `worktreeId` (issue option 2).** Reduces the
  untagged population but does not fix the core "shared path can't disambiguate"
  defect, and broadens blast radius across local/daemon/ssh spawn paths. Worth
  doing as separate hardening; not required for this fix.
- **Require an exact per-instance path.** There is no per-instance filesystem
  path for folder workspaces — the instances *are* the same directory — so this
  reduces to disabling the fallback, which is what we do.

## Out of scope / known residual

A *normal* worktree whose path is a strict ancestor of another repo's worktree
path (nested checkouts) could still cwd-sweep untagged sessions in the nested
worktree. This requires nested cross-repo checkouts **and** untagged sessions —
not the reported scenario, and not introduced by folder workspaces. Tracked
separately if it surfaces.

## Cross-platform / SSH

The predicate is a pure string check on the worktree id suffix, independent of
path separators and host, and `isPathInsideOrEqual` already normalizes Windows
vs POSIX paths.

Note on SSH: the folder-delete path sweeps only the **local** provider
(`worktrees.ts:1424`, `:1946`; `orca-runtime.ts:20536` all pass
`getLocalPtyProvider()`) — SSH folder-instance daemon sessions are reached only
by the runtime sweep, a pre-existing gap that is out of scope here. Because the
sweep is local while a folder instance's stripped path may be a *remote* path
string, the pre-fix `cwdOwned` could even cross-host false-match that string
against local cwds; disabling the path fallback for instances suppresses that
too.

## Test plan

- Unit (`worktree-teardown.test.ts`): folder-workspace delete does **not**
  sweep an untagged sibling session on the shared path (regression); folder
  delete **still** tears down its own prefix- and `worktreeId`-matched sessions
  (no regression); the existing normal-worktree `cwdOwned` test stays green.
- Unit (`worktree-id.test.ts`): existing `splitWorktreeId` /
  `splitWorktreeIdForFilesystem` cases pin the strip invariant the fix keys on
  (raw path preserved vs. `::workspace:<uuid>` suffix stripped).
- `/electron`: exercise the real workspace-removal IPC in a folder repo with a
  sibling instance and confirm the sibling's sessions survive while the deleted
  instance's own sessions are gone.
