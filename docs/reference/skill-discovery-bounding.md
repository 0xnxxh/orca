# Bounded skill and capability discovery

Design record for the change that stopped skill discovery from re-walking the
filesystem on every window focus, pane mount, and connected client.

## Incident

During a beachball incident the machine showed sustained multi-core load and
heavy filesystem-metadata contention, alongside repeated broad `find` searches
for `SKILL.md` under the user's home directory.

## What the investigation actually found

Two separate things were happening, and only one of them is Orca's code.

**Orca does not shell out to `find` on macOS or Linux.** The native scanner is a
JS `readdir` recursion (`src/main/skills/discovery.ts`). The only `find` Orca
emits for skills is inside the WSL bash script
(`src/main/skills/skill-discovery-wsl.ts`), which is Windows-only and already
`-maxdepth`-bounded. Ripgrep is used for Quick Open and file search, never for
skills. There is no `glob`/`fast-glob`/`fdir` usage in `src/`. The `find /Users/...`
processes seen during the incident were spawned by the coding-agent CLIs running
inside Orca panes, not by Orca — see "Residual: agent-launched `find`" below.

**Orca's own contribution was amplification, not breadth.** The root set was
already explicit and bounded. What was unbounded was how often, how concurrently,
and how redundantly those roots were walked:

1. **Every `window` focus forced a full disk re-scan.**
   `src/renderer/src/hooks/useInstalledAgentSkills.ts` listened for `focus` and
   called `refresh(true)`. `force` bypasses the renderer's discovery cache
   entirely, so each focus produced a fresh IPC/RPC scan. Around 30 components
   use this hook, and focus fires on every app/window switch.

2. **The process that owns the disk had no cache and no dedup.**
   `skills:discover` (`src/main/ipc/skills.ts`) and the `skills.discover` RPC
   (`src/main/runtime/rpc/methods/skills.ts`) both called
   `discoverSkillsOnTarget` directly. Two concurrent identical requests did the
   full walk twice.

3. **Each scan re-walked roots that had already been walked.**
   `buildSkillDiscoverySources` returns 12 fixed home roots plus 2 roots per
   local repo plus the target `cwd`. Native-chat panes scan per pane `cwd`, so
   each pane produced a *different* target key while sharing the same 12 home
   roots. N panes meant N walks of the same home directories.

4. **Fan-out inside a scan was unbounded, and each skill was walked twice.**
   `discoverSkills` ran `Promise.all` over every root, then `Promise.all` over
   every discovered `SKILL.md`. Each of those ran `readSkillSummary` *and*
   `countFiles`, a second full recursive walk of the package directory with no
   depth bound and no `node_modules` prune.

Multiply: `windows x clients x panes x roots x packages`. One host serving a
desktop window, a mobile client, and a handful of native-chat panes turns a
single alt-tab into thousands of `readdir`/`realpath`/`stat` calls — a burst of
pure metadata work, which is exactly what contends on a filesystem lock and
beachballs the UI. On WSL the same burst also multiplies `wsl.exe` boots and one
`find` subprocess per discovered skill.

## Non-goals

- **The root set does not change.** Personal, plugin, workspace and built-in
  skills are discovered from exactly the roots they were before. No skill that
  was visible becomes invisible.
- **No new scanning strategy.** No home-wide scan is introduced, and no existing
  bound is loosened to compensate for caching.
- **Freshness inventory is untouched.** `inventorySkillFreshness` already runs
  bounded (128 repo roots, 16 384 plugin entries, concurrency 4) and is not on
  the focus path.

## Design

### One coalescing primitive

`src/main/skills/skill-scan-coalescer.ts` provides in-flight deduplication plus
a short TTL result cache behind a bounded LRU:

```ts
coalesceSkillScan(key, { ttlMs, refresh }, run)
```

- Concurrent callers with the same key share one `run()`.
- A completed result is reusable for `ttlMs`; `ttlMs: 0` means dedup only.
- `refresh: true` drops the entry and any TTL reuse, then runs for real.
- The LRU is bounded so a long-lived host cannot accumulate entries.

Rejections are never cached, and the in-flight entry is cleared on settle, so a
failed scan never pins a bad result.

An in-flight scan is only joinable for 30 s. A skill root on a stalled network
mount can leave a `readdir` that never settles; joining it forever would let one
wedged mount permanently wedge discovery for every later caller — strictly worse
than before this cache existed, where each caller at least retried. Past that age
a new caller starts its own scan and replaces the pending entry, so at most one
survives per key.

### Three call sites

| Site | Key | TTL | Why |
| --- | --- | --- | --- |
| `discoverSkillsOnTarget` | resolved target + repo-path digest | 0 | Collapses simultaneous identical requests from several clients into one scan. No staleness, because nothing is retained. |
| `discoverSkills` per root | absolute root path | 10 s | The fix for the pane fan-out: the 12 home roots are walked once and shared by every target that includes them, however many panes/worktrees are open. |
| `discoverSkillsInWsl` whole result | distro + cwd | 10 s | On WSL the unit of cost is the `wsl.exe` boot and its `find` subprocesses, so the result is the right thing to reuse. |

Keys are exact path strings — never lowercased, never normalized — so Windows
case variants and macOS case-insensitive volumes cannot alias two different
targets into one cache entry.

### Refresh semantics

`SkillDiscoveryTarget` gains an optional `refresh?: boolean`. It is a new
optional field on a schema both IPC and RPC already parse, so it is wire-safe:
an old host ignores it and behaves exactly as today (always a fresh scan).

Renderer mapping:

- **Focus** now calls `refresh(false)`. Focus is a heuristic "maybe something
  changed" signal, so serving a result up to the renderer's own freshness window
  old is correct — and it is what removes the storm at its source. The renderer
  discovery cache gains that freshness window (previously entries never
  expired), so a non-forced focus refresh still re-reads disk once the window
  lapses. The window is 15 s, matching the focus-rescan cooldown
  `useSkillFreshness` already applies to the other disk-reading scan.
- **Remote runtimes**: `discoverSkillsForRuntimeTarget` drops the caller's target
  for a remote call because every field in it describes the *client's* host.
  `refresh` is the exception and is forwarded — it describes the request, and
  without it an explicit re-check on an SSH/remote runtime would read that host's
  shared scan instead of its disk.
- **Explicit change signals stay authoritative.** The install-completed event,
  the Settings recheck button, and terminal-exit refreshes still call
  `refresh(true)`, which now also sets `refresh: true` on the wire and bypasses
  every host-side cache. Skill installs are still detected immediately.
- The host additionally clears its caches when a skill update run finishes, so a
  host-side mutation is visible to clients that never sent `refresh`.

### Bounded work inside a scan

- Per-skill metadata work runs through `runSkillCandidateTasks` (concurrency 4),
  the same bound the freshness inventory already uses, instead of an unbounded
  `Promise.all` over every discovered `SKILL.md`.
- `countFiles` gains a depth bound and prunes `node_modules`, matching
  `skill-plugin-cache-scan.ts`. `fileCount` is a display-only number; excluding
  vendored dependencies from it is also more honest about package size.

### Diagnostics

Each *real* (uncached) scan emits one line:

```
[skills] scan target=native-host roots=15 present=3 cached=13 skills=12 ms=41 walked=home-claude,home-agents
```

Root **ids** (`home-claude`, `repo-agents-<hash>`) are logged, never absolute
paths, so the searched roots are provable without putting a user's directory
names or repo names in a log. Cache hits log nothing, so the steady state is
silent and a storm is visible as a burst of scan lines.

## Measured result

Repro: 8 workspace panes x 4 concurrent clients = 32 simultaneous scans, against a
home with 5 provider roots x 6 packages, each package carrying 40 reference files
and a 30-package `node_modules`. Same fixture, same assertions, run against the
tree before and after this change (macOS, `node:fs/promises` calls counted).

| | readdir | stat | realpath | open | total | wall clock |
| --- | --- | --- | --- | --- | --- | --- |
| Before | 65 664 | 1 568 | 66 656 | 992 | 134 880 | 1080 ms |
| After | 1 343 | 194 | 1 381 | 38 | 2 956 | 45 ms |

Both runs return the same 31 skills. That is 45x less filesystem-metadata work
and 24x less wall-clock for an identical result.

**Subprocesses.** On macOS and Linux, discovery spawns none — before or after.
On Windows/WSL each scan boots `wsl.exe` twice and its script runs one `find` per
root plus one per discovered skill; the WSL result cache collapses repeat scans of
the same distro and workspace inside the window, so the same 32-scan burst over 8
workspaces drops from 64 `wsl.exe` boots to 16. That figure is arithmetic from the
code path, not measured on a Windows host.

## Compatibility

- **Cross-platform**: no new path assumptions. Cache keys are opaque strings
  built with `path.join`; depth bounds count `path.sep` segments. The WSL path
  keeps posix arithmetic.
- **SSH / remote runtimes**: the fix lives in `discoverSkillsOnTarget`, below
  both the IPC and the RPC entry points, so a remote host gets the same
  coalescing for every connected client. This is where the multi-client
  amplification was worst.
- **Folder workspaces**: roots are derived from the target `cwd` and the stored
  repo list, neither of which assumes a git worktree.
- **Wire compatibility**: `refresh` is a new optional field
  (`docs/reference/remote-wire-compatibility.md`). New client + old host: field
  is stripped, host scans every time — today's behavior. Old client + new host:
  the client never sends `refresh`, so after installing a skill it can see a
  result up to 10 s stale; the host's own post-update-run invalidation and the
  short TTL bound that window.

## Residual: agent-launched `find`

The `find /Users/... -name SKILL.md` processes are the agent CLIs' own
behavior. Orca cannot stop a terminal agent from running `find`, and this change
does not try to. What it does remove is Orca's share of the same contention, so
the two are no longer stacked. Giving agents a bounded `orca skills installed`
query so they can read Orca's catalog instead of scanning is a reasonable
follow-up, but it is a new agent-facing surface rather than a fix to this
regression, so it is deliberately out of scope here.

## Tradeoff

Discovery latency is unchanged on a cold scan and lower on a warm one. The cost
is bounded staleness, and the two windows compose: a focus-triggered read can be
served from a renderer entry up to 15 s old that was itself filled from a host
root scan up to 10 s old, so worst case is ~25 s behind disk. Every explicit
"something changed" path — install completed, Settings **Refresh**, native-chat
**Retry**, terminal exit — bypasses both and reads disk.
