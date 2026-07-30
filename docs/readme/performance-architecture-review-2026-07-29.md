# Orca Performance Architecture Review

- **Date:** 2026-07-29
- **Revision reviewed:** `ef55429f3d` (`origin/main` at the start of the review)
- **Scope:** Electron main/preload/renderer, shared/runtime/CLI, desktop host
  services, mobile, build outputs, and the performance diagnostics and benchmark
  suite

## Executive conclusion

Orca's next large performance gains will not come from adding another memo or
virtualizing another list. The codebase already does those things well. The
highest-leverage work is to reduce duplicated ownership and make runtime
capabilities genuinely lazy.

The two strongest opportunities are:

1. **Build a minimal startup kernel and app shell.** The production main entry is
   an eager 8.15 MB JavaScript file, while the primary renderer entry statically
   reaches 11.10 MB across 304 JavaScript chunks. Terminal, onboarding, provider,
   plugin, account, and integration graphs are reachable before their surfaces
   are used.
2. **Give each host one authoritative repository-intelligence service.** Git
   status, upstream state, worktree identity, checks eligibility, and related
   projections are still fetched through partially independent pipelines.
   Coalescing within a single function does not prevent separate consumers from
   launching overlapping local, WSL, SSH, or runtime work.

Four follow-ups are worthwhile after those foundations:

- partition the renderer store by lifecycle and update frequency;
- cold-park inactive mobile terminal WebViews;
- make the mobile workspace catalog a revisioned, replayable stream;
- partition durable persistence when real profiles, not synthetic restored tabs,
  show serialization or shutdown stalls.

The first three recommendations reinforce one another. Domain stores create the
renderer's lazy boundaries; a capability kernel creates the main-process
boundaries; repository intelligence removes the largest remaining repeated
subprocess/network pipeline.

## Ranked opportunities

| Rank      | Opportunity                                            | Primary win                              | Confidence                                    | Effort       |
| --------- | ------------------------------------------------------ | ---------------------------------------- | --------------------------------------------- | ------------ |
| P0        | Minimal startup kernel and renderer app shell          | cold start, first paint, memory          | High                                          | Large        |
| P0        | Host-owned repository intelligence                     | Git CPU, SSH latency, consistency        | High                                          | Large        |
| P1        | Lifecycle-partitioned renderer stores                  | startup graph, memory, update isolation  | High for startup; Medium for steady-state CPU | Large        |
| P1        | Mobile terminal hot set and cold parking               | mobile memory/GPU/process pressure       | High                                          | Medium–Large |
| P2        | Revisioned mobile workspace stream                     | foreground network/CPU, remote latency   | High                                          | Medium–Large |
| P2        | Partitioned durable persistence                        | large-profile save/shutdown tail latency | Medium                                        | Large        |
| Quick win | Repair false dynamic boundaries and add bundle budgets | startup/package weight                   | High                                          | Small–Medium |

“Confidence” describes the evidence that the cost exists, not a promise of a
specific speedup. Only an A/B implementation can establish savings.

## Measured baseline

### Codebase and build

The architectural sweep covered 5,913 non-test TypeScript/TSX files. Approximate
production line counts were 361k in `src/main`, 585k in the renderer, 81k shared,
9k preload, 14k CLI, and 110k mobile. Generated code and tests were excluded
from those figures.

`pnpm run build:electron-vite` produced:

| Surface              | Static startup graph |  Raw bytes | Gzip bytes |
| -------------------- | -------------------: | ---------: | ---------: |
| Electron main entry  |    one primary entry |  8,149,600 |  1,701,691 |
| Electron preload     |            one entry |    130,769 |     20,658 |
| Main renderer window |       304 JS + 3 CSS | 11,104,115 |  2,472,847 |
| Dashboard popout     |        81 JS + 3 CSS |  5,893,311 |  1,296,803 |
| Web entry            |        33 JS + 1 CSS |  4,361,095 |    928,572 |

The renderer figures are transitive **static** imports from the Vite manifest;
they exclude dynamic imports and large workers such as the 11.35 MB TypeScript
worker.

Largest chunks in the main renderer startup graph:

| Chunk role                       | Raw bytes |
| -------------------------------- | --------: |
| Root Zustand store               | 1,950,409 |
| `App`                            | 1,582,599 |
| terminal user-input graph        | 1,347,224 |
| onboarding inline-terminal graph | 1,321,452 |
| JSX runtime group                |   663,192 |
| client group                     |   465,648 |
| shared library group             |   343,714 |
| worktree card group              |   294,115 |

The names are build chunk labels, not a claim that every byte belongs to the
named source module. The important fact is that each entire chunk is in the
static entry graph.

### Startup benchmark

A three-iteration empty-state production run reported these medians:

| Phase                              | Median |
| ---------------------------------- | -----: |
| spawn → Electron app ready         | 456 ms |
| app ready → services initialized   |  43 ms |
| window created → `did-finish-load` | 159 ms |
| spawn → `did-finish-load`          | 768 ms |
| spawn → workspace ready            | 911 ms |

The first run after the build was materially colder:

| Phase                            | First run |
| -------------------------------- | --------: |
| spawn → Electron app ready       |  2,387 ms |
| app ready → services initialized |    238 ms |
| spawn → `did-finish-load`        |  2,886 ms |
| spawn → workspace ready          |  3,024 ms |

The harness does not isolate Electron boot from main-bundle parse, module link,
and top-level evaluation. It therefore supports “startup is a target,” but not
“the bundle costs exactly N milliseconds.” The proposed rollout requires an A/B
split build and finer milestones.

### Phase 0 startup clock attribution

`ORCA_STARTUP_DIAGNOSTICS=1` now emits these additional one-shot boundaries:

| Event                                    | Meaning                                                                           | Clock                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `[bootstrap] bundle-enter`               | Earliest executable generated main-entry boundary                                 | Main-process `performance.now()` in `t`                    |
| `[bootstrap] bundle-evaluation-complete` | Generated main entry and its synchronous dependencies finished evaluation         | Main-process `performance.now()` in `t`                    |
| `[startup] renderer-first-react-commit`  | Main-window root layout effect ran after its first React commit                   | Main-process receipt in `t`; renderer clock in `rendererT` |
| `[startup] renderer-shell-painted`       | A second animation-frame callback ran, so a paint opportunity followed the commit | Main-process receipt in `t`; renderer clock in `rendererT` |

The bootstrap and `[startup]` `t` values share the Electron main process's
monotonic clock. `rendererT` values share only the main-window renderer clock,
so they are used for commit-to-paint duration but not subtracted from main
timestamps. Popout and web roots do not emit these renderer milestones.

JavaScript cannot separately time parsing or linking before its first
executable statement. `spawnToBundleEnterMs` uses the parent harness's
complete-line receipt and still includes Electron boot, bundle parse/link, and
stderr delivery; it is an upper-bound attribution, not a parse-only timer.
`synchronousBundleAndDependencyEvaluationMs` uses the main-process clock from
bundle entry to the generated evaluation-complete footer. The remaining
explicit phases separate evaluation-complete to app-ready, app-ready to
services initialized, services initialized to first React commit, and first
commit to the post-commit shell paint opportunity.

Validation on the review worktree's fresh production build:

| Boundary or phase                                            | One-run isolated macOS fixture |
| ------------------------------------------------------------ | -----------------------------: |
| `bundle-enter` main clock                                    |                      257.24 ms |
| `bundle-evaluation-complete` main clock                      |                      454.72 ms |
| `app-ready` main clock                                       |                       529.7 ms |
| `services-initialized` main clock                            |                       815.8 ms |
| `renderer-first-react-commit` main receipt                   |                     1,101.0 ms |
| `renderer-shell-painted` main receipt                        |                     1,151.1 ms |
| spawn → bundle-enter line receipt                            |                     1,814.6 ms |
| synchronous bundle/dependency evaluation                     |                      197.48 ms |
| app-ready → services initialized                             |                       286.1 ms |
| services initialized → first React commit receipt            |                       285.2 ms |
| first commit → post-commit paint opportunity, renderer clock |                          55 ms |

All 21 numeric derived phases were non-negative. The portable evidence is in
[`phase0-startup-attribution-2026-07-29.md`](../../tools/benchmarks/results/phase0-startup-attribution-2026-07-29.md).
Against the pre-instrumentation `out/` snapshot, the measured static startup
surfaces changed by +697 raw/+286 gzip bytes for main, +29/+3 for preload, and
+1,464/+425 for the main renderer (+2,190 raw/+714 gzip total). No budget was
raised.

The production build, bundle-budget check, focused 16-test suite, Node and web
typechecks, targeted oxlint/oxfmt, max-lines ratchet, and `git diff --check`
passed. The live run was one cold macOS iteration from an unpackaged production
Electron build; it is causal evidence, not a representative latency baseline.
Main IPC receipt includes message latency, and double animation-frame
scheduling establishes a post-commit paint opportunity rather than compositor
proof.

### Restored-state scaling

Synthetic restored-local-tab profiles did **not** establish persistence as a
startup bottleneck:

| Restored tabs | State file | JSON parse | store load | `did-finish-load` |
| ------------: | ---------: | ---------: | ---------: | ----------------: |
|           200 |     104 KB |       0 ms |       5 ms |            758 ms |
|         1,000 |     516 KB |       1 ms |       8 ms |            759 ms |

These are three-run medians and warm-cache dominated. They show that tab count
alone is not enough to justify an urgent persistence rewrite.

### Zustand selector fan-out

`pnpm bench:zustand-selector-fanout` measured 2,500 subscribers across 2,000
unrelated writes:

- 5,000,000 selector executions;
- 29.65 ms median total;
- 0.0148 ms per write;
- zero render invalidations.

Store partitioning should therefore be justified first by dependency isolation,
ownership, and real high-frequency workloads—not by the synthetic selector
loop alone.

## Architecture map

| Layer         | Current ownership                                                | Main performance implication                                                                    |
| ------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Electron main | one composition root constructs most services                    | broad eager module graph before first window                                                    |
| Preload       | narrow IPC bridge                                                | comparatively small; not a priority                                                             |
| Renderer      | one `App` plus one ~40-slice Zustand root                        | all entries inherit broad state; desktop entries also inherit terminal/integration dependencies |
| Runtime/CLI   | `OrcaRuntimeService` and RPC methods expose host operations      | good remote abstraction, but several data domains still lack one snapshot owner                 |
| Terminal      | daemon/main headless authority plus renderer/mobile presentation | desktop is mature; mobile retains every xterm WebView                                           |
| Persistence   | one durable state document plus targeted sidecars                | good write safety, but whole-document serialization remains                                     |
| Mobile        | RPC snapshots plus event streams and safety polls                | reliable convergence, but polling compensates for non-replayable events                         |

## P0 — Minimal startup kernel and renderer app shell

### Evidence

The main entry statically imports persistence, AI Vault cache persistence,
terminal providers, telemetry, runtime/RPC, updater, accounts, browser,
automation, plugins, and many other capabilities from one composition root.
See [`src/main/index.ts`](../../src/main/index.ts#L1). It constructs the account,
runtime, automation, plugin, browser, rate-limit, and integration services
before the `services-initialized` milestone in the `app.whenReady()` path
([`src/main/index.ts`](../../src/main/index.ts#L1866)).

The build config has separate entries for workers, the terminal daemon, plugin
host, and watchdogs, which is good, but the primary main entry remains 8.15 MB
([`electron.vite.config.ts`](../../electron.vite.config.ts#L191)).

The renderer root imports `App` directly
([`src/renderer/src/main.tsx`](../../src/renderer/src/main.tsx#L5)), and `App`
retains several terminal modules while only the main `Terminal` component is
lazy ([`src/renderer/src/App.tsx`](../../src/renderer/src/App.tsx#L53),
[`src/renderer/src/App.tsx`](../../src/renderer/src/App.tsx#L337)). The store is
also an eager root dependency of the main, popout, and web entries.

This explains otherwise surprising build results:

- a 1.35 MB terminal-labelled chunk is static for both the main window and
  popout;
- a 1.32 MB onboarding inline-terminal chunk is static for the main window;
- the web entry pays 1.95 MB for the same desktop store;
- the popout pays 5.89 MB before rendering a much narrower surface.

Some apparent main-process dynamic boundaries are also defeated by static
imports. For example, `ssh-connection.ts` dynamically imports SFTP/deploy
modules, while other provider and relay modules import the same implementations
statically. Rollup must keep those modules reachable in eager capability graphs.

### Target architecture

Create explicit startup stages with enforced dependency rules:

1. **Process bootstrap:** process flags, crash guards, profile path, single
   instance, and startup diagnostics only.
2. **Window kernel:** durable settings required for theme/window behavior,
   minimal i18n, IPC router, runtime identity, and a window-ready gate.
3. **Session restore:** only the workspace/session projections required to draw
   the initial shell and reconnect visible terminals.
4. **Post-first-paint services:** telemetry, updater, tray enrichments, account
   reconciliation, hook repair, plugin discovery, caches, and background heals.
5. **On-demand capability modules:** SSH/SFTP, AI Vault scanners, browser
   automation, emulator, speech, hosted-review providers, plugin workers, and
   settings-only flows.

For the renderer, give each HTML entry its own bootstrap state:

- a small durable shell/settings/workspace projection;
- dynamic terminal activation for terminal surfaces;
- dynamic onboarding/setup code only when shown;
- a popout-specific dashboard store adapter;
- a web-specific runtime/session adapter.

Lazy React components are not sufficient if a root store, selector, event
registry, or shared component statically imports the same capability.
Dependency-boundary tests should fail when a shell module imports a
terminal-only, onboarding-only, provider-only, or settings-only module.

### Implementation sequence

1. Add build output budgets and save a machine-readable static-entry report.
2. Instrument `bundle-enter`, kernel ready, store ready, first React commit,
   shell painted, visible terminal requested, and visible terminal revealed.
3. Extract capability registration from `src/main/index.ts` behind async
   factories without changing IPC contracts.
4. Split renderer state as described in the P1 section.
5. Move one low-risk capability at a time, starting with settings/onboarding
   and inactive provider integrations.
6. Only then defer terminal modules, preserving restored-terminal correctness
   and measuring reveal latency separately.

### Success gates

Provisional goals for the first architectural tranche:

- main eager entry below 3 MB raw;
- main-window static renderer graph below 5 MB raw and materially fewer than
  304 requests;
- popout and web entries no longer import the desktop terminal/store graph;
- 25–40% improvement in a repeatable cold-start protocol on representative
  macOS and Windows hardware;
- no regression in warm workspace ready, terminal restore, first terminal
  reveal, crash recovery, or serve-mode startup.

The byte and percentage thresholds are starting SLOs, not estimates of savings.

### Risks and compatibility

- Keep local, WSL, SSH, relay, and serve-mode registration deterministic even
  when modules load late.
- A late IPC module must return a bounded “initializing” result or await one
  shared initialization promise; it must not expose partially constructed
  services.
- Windows startup and native-module resolution need packaged-app tests because
  dynamic chunk paths differ inside ASAR.
- Folder workspaces must not initialize Git-only capabilities merely to draw
  the shell.

## P0 — Host-owned repository intelligence

### Evidence

The active renderer status path is already thoughtfully event-driven. It uses
file, terminal, and push signals, a 3-second activity floor, a 60-second safety
interval, visibility gates, slow-task backoff, and one scheduler
([`useGitStatusPolling.ts`](../../src/renderer/src/components/right-sidebar/useGitStatusPolling.ts#L23),
[`useGitStatusPolling.ts`](../../src/renderer/src/components/right-sidebar/useGitStatusPolling.ts#L103)).

The Checks panel nevertheless owns another status snapshot. Global status-map
changes intentionally act only as invalidation signals, after which Checks
calls `getRuntimeGitStatus()` and may separately call
`getRuntimeGitUpstreamStatus()`
([`ChecksPanel.tsx`](../../src/renderer/src/components/right-sidebar/ChecksPanel.tsx#L1498),
[`ChecksPanel.tsx`](../../src/renderer/src/components/right-sidebar/ChecksPanel.tsx#L1513)).

Main-process status deduplication has a cancellation-shaped gap. `getStatus()`
joins identical concurrent requests only when no `AbortSignal` is present; a
signalled request goes straight to `runGetStatus()`
([`src/main/git/status.ts`](../../src/main/git/status.ts#L214)). The active poll
passes a signal, while some private snapshot consumers do not. They therefore
cannot share one underlying read. The IPC handler creates per-renderer
cancellation controllers and forwards those signals to local or SSH providers
([`src/main/ipc/filesystem.ts`](../../src/main/ipc/filesystem.ts#L1091)).

There are strong caches for individual operations—line stats, submodule paths,
upstream-name resolution, negative upstream results, and worktree scans. The
remaining problem is ownership above those caches. Source Control, Files,
Checks, review creation, cleanup, branch identity, and runtime/mobile clients
need projections of the same repository state but can still initiate different
pipelines.

This is most expensive on SSH/WSL/runtime hosts, where one logical refresh can
mean multiple RPC round trips plus several Git subprocesses.

### Target architecture

Create a repository-intelligence service in the process that owns Git execution
for each host. Maintain a versioned snapshot per repository/worktree:

```ts
type RepositorySnapshot = {
  revision: number
  generatedAt: number
  repositoryIdentity: { head: string | null; branch: string | null }
  status: { entries: GitStatusEntry[]; didHitLimit: boolean; lineStatsState: string }
  upstream: GitUpstreamStatus | null
  conflicts: GitConflictOperation | null
  worktreeGraphVersion: number
  freshness: Record<RepositoryProjection, Freshness>
}
```

Key the owner by execution host, repository identity, worktree path, and
relevant Git options—not path alone. Host scope must distinguish native, each
WSL distro, each SSH provider/session, and each runtime/relay connection.

Consumers subscribe to projections. Invalidation sources enqueue refresh
reasons:

- `.git` and worktree metadata watchers;
- terminal command completion/change signals;
- Orca mutations such as commit, checkout, merge, push, and cleanup;
- provider/reconnect events;
- slow safety reconciliation.

A consumer cancellation should release its **lease**, not cancel a shared
underlying Git read still needed by other consumers. Mutations should retain
the existing pre/post invalidation fences and increment a generation so
pre-mutation results cannot repopulate the snapshot.

### Rollout

1. Wrap the current status/upstream functions behind the service without
   changing subprocess commands.
2. Migrate Checks and the active polling hook to snapshot projections.
3. Migrate Source Control, creation eligibility, cleanup, and hosted-review
   consumers.
4. Publish revisioned snapshots through runtime RPC for mobile/web.
5. Add optional worktree-graph and conflict projections after status ownership
   is stable.

### Success gates

- One physical status pipeline per host/worktree/generation under concurrent
  Source Control + Checks + polling requests.
- No duplicate upstream probe for consumers of the same snapshot.
- Cancellation of one renderer or panel does not cancel work leased elsewhere.
- Subprocess and RPC counts fall materially in a large-repo/slow-SSH benchmark.
- Mutation read-after-write tests remain exact.
- Preferred and fallback commands run in the Git 2.25 compatibility matrix.

### Risks and compatibility

- Do not let a TTL substitute for explicit mutation invalidation.
- Do not share capability state across WSL distros, SSH hosts, or runtime
  incarnations.
- A folder workspace needs a cheap non-Git snapshot and no Git probes.
- Provider-neutral review fields belong in the snapshot; GitHub-specific
  details do not.

## P1 — Lifecycle-partitioned renderer stores

### Evidence

The root Zustand store eagerly creates roughly 40 slices, including workspaces,
terminals, UI, settings, GitHub, hosted review, Linear, Jira, editor, usage,
browser, SSH, runtime, agent status, dictation, cleanup, and generation state
([`src/renderer/src/store/index.ts`](../../src/renderer/src/store/index.ts#L52)).

Store slices cross capability boundaries:

- the terminal slice imports parked-watcher, shutdown-buffer, and runtime
  terminal-stream modules
  ([`src/renderer/src/store/slices/terminals.ts`](../../src/renderer/src/store/slices/terminals.ts#L74));
- the worktree slice imports parked-terminal cleanup
  ([`src/renderer/src/store/slices/worktrees.ts`](../../src/renderer/src/store/slices/worktrees.ts#L42)).

That graph is inherited by all three renderer entries. This is a stronger
reason to partition than selector CPU: the synthetic selector benchmark found
only 0.0148 ms per unrelated write for 2,500 subscribers.

### Target domains

Use a small shell coordinator over independently importable stores:

1. **Durable shell:** appearance, keybindings, active route, window state.
2. **Workspace catalog:** repos, projects, worktrees, runtime ownership.
3. **Session:** tabs, editor/browser descriptors, active surface.
4. **Terminal runtime:** layouts, PTY bindings, stream metadata, parking.
5. **Agent live state:** status, unread/completion state, high-frequency clocks.
6. **Repository state:** projections from the repository-intelligence service.
7. **Integrations:** provider caches and feature-specific mutations.

The shell may know stable identifiers and narrow interfaces. It must not import
implementation modules from terminal, onboarding, editor workers, browser, or
provider domains.

Avoid a flag day. Introduce domain facades, mirror a slice into its new store,
move readers, then make the old slice a compatibility adapter until no imports
remain. Preserve reference gates and the existing listener census.

### Success gates

- Main, popout, and web entries import only stores they render.
- A terminal output/status update does not execute selectors in settings,
  provider caches, or workspace catalog.
- Session persistence and runtime graph publication subscribe to explicit
  domain projections.
- Existing no-op reference behavior and crash-diagnostic collection-size
  reporting remain covered.

## P1 — Mobile terminal hot set and cold parking

### Evidence

The mobile session maps every terminal record to `TerminalPaneView`
([`mobile/app/h/[hostId]/session/[worktreeId].tsx`](../../mobile/app/h/%5BhostId%5D/session/%5BworktreeId%5D.tsx#L4726)).
Each pane contains a `TerminalWebView`. Inactive panes deliberately remain
mounted and are hidden with `opacity: 0` to preserve xterm state
([`mobile/src/session/TerminalPaneView.tsx`](../../mobile/src/session/TerminalPaneView.tsx#L61)).

Mobile already subscribes only to the active terminal and batches WebView
writes at roughly 20 Hz. The remaining scaling cost is retained WebView/xterm
instances, layout state, JavaScript heaps, textures, and native WebView
resources for every terminal in the session.

Desktop has already demonstrated the safer model: bounded hot retention,
headless authority, byte watching, cold parking, and replay on reveal.

### Target architecture

- Keep the active terminal and, initially, the two most recently used terminals
  warm.
- Retain terminal identity, unread state, modes, and replay cursor without a
  WebView.
- On park, release the WebView after a grace period and record the last applied
  stream sequence.
- On reveal, create one WebView, request an authoritative snapshot plus replay
  after that sequence, apply theme/scale, fit, then subscribe live.
- If continuity cannot be proven, request a full snapshot rather than exposing
  a partially replayed terminal.

### Success gates

- Native/JS/GPU memory is approximately bounded as terminal count grows.
- Ten- and fifty-terminal fixtures keep no more than the configured hot set.
- Warm switch remains visually immediate; cold reveal gets an explicit p95
  budget on iOS and Android.
- Split panes, selection, OSC/query replies, SSH/runtime terminals, background
  reconnect, and Take Back remain correct.

## P2 — Revisioned, replayable mobile workspace catalog

### Evidence

Mobile subscribes to `runtime.clientEvents.subscribe` but also performs a full
`worktree.ps` refresh every three seconds while foregrounded
([`mobile/src/worktree/host-worktree-refresh.ts`](../../mobile/src/worktree/host-worktree-refresh.ts#L5)).
The comments document the reason: events are not queued while disconnected,
and some desktop repo edits have not reached the runtime stream
([`mobile/src/worktree/host-worktree-refresh.ts`](../../mobile/src/worktree/host-worktree-refresh.ts#L42)).

For 200 repos and 5,000 worktrees, the existing no-op equality gate is already
effective: five polls spent about 5.84 ms building sections and 3.96 ms
comparing equality, versus 27.95 ms in the older unconditional rebuild path.
The remaining opportunity is to avoid the request and snapshot work, especially
over relay/SSH paths.

### Target architecture

Publish a host catalog with a monotonically increasing revision:

- `catalog.get({ afterRevision })` returns no change, a delta, or a snapshot;
- `catalog.subscribe({ fromRevision })` replays retained deltas, then emits
  live events;
- reconnect detects gaps and requests one snapshot;
- repo metadata and worktree topology share a transaction boundary or declare
  independent revisions.

Once replay/gap recovery is proven, move the full foreground poll from three
seconds to a much slower safety interval. Keep foreground refresh and
reconnection reconciliation.

This stream can later carry repository-intelligence revisions without copying
full Git status into every catalog event.

## P2 — Partitioned durable persistence

### Evidence

Persistence is already substantially optimized:

- writes are async, debounced, and serialized;
- mutation bursts have a bounded max wait;
- byte-identical state skips disk writes;
- secrets are normalized so randomized encryption does not defeat the hash;
- durable rename/fsync and backups protect against corruption;
- active-view and GitHub cache paths are narrower;
- renderer session payload construction is patch/reference gated.

The remaining whole-document work happens before async I/O:
`buildStateToSave()` synchronously clones the durable state, encrypts secret
slots, `JSON.stringify`s the full document, performs substitutions, and hashes
it on the main thread
([`src/main/persistence.ts`](../../src/main/persistence.ts#L3624)). Shutdown uses a
synchronous durable write
([`src/main/persistence.ts`](../../src/main/persistence.ts#L3732)).

The synthetic 1,000-tab profile was only 516 KB and loaded cheaply, so this is
not a P0/P1 finding on current evidence.

### Trigger and target design

Before implementation, capture real large-profile metrics:

- serialized bytes by top-level domain;
- stringify/hash duration;
- async fsync/rename duration;
- shutdown flush duration;
- save frequency and no-op rate;
- renderer session-payload build duration.

Escalate when p95 main-thread serialization exceeds a visible-jank budget or
shutdown flush becomes a reliability problem. Then partition by ownership:

- settings/profile;
- workspace topology;
- session/tab layout;
- automation/history;
- provider caches;
- per-host runtime state.

Use versioned envelopes and an atomic manifest or small journal so a partial
generation can be recovered. Preserve secret handling, backup rotation, and
cross-platform rename/fsync behavior.

## Quick wins that support the architecture

### Enforce static-entry budgets in CI

Parse `out/renderer/.vite/manifest.json` after production builds and report
static raw/gzip bytes, chunk count, and top contributors for each HTML entry.
Also budget `out/main/index.js` and preload. Fail only on ratcheted regression
limits at first; tighten after the capability split.

### Repair false dynamic boundaries

Generate a build-time list of modules that are both statically and dynamically
imported. Start with the SFTP and SSH relay modules currently reached both ways:

- `ssh-filesystem-provider-sftp.ts`;
- `sftp-upload.ts`;
- `ssh-relay-deploy-helpers.ts`.

Move shared types/constants into small leaf modules, and make eager call sites
load implementations through a capability factory. Verify packaged ASAR paths
on all desktop platforms.

### Add parse/evaluation attribution

Current startup milestones begin after the main bundle is already executing.
Add build banner timings and capability-factory timings so Electron boot,
bundle parse/link, top-level evaluation, service construction, and async
initialization can be compared separately. A trace mode should remain
diagnostic-only because require tracing changes startup behavior.

## Existing strengths — do not redo these

The review found many areas where the obvious recommendation is already
implemented:

- **Desktop terminals:** daemon ownership, main headless history, hidden-tab
  cold parking, hot retention, parked byte watchers, WebGL disposal, reveal and
  resource benchmarks.
- **Large UI collections:** worktree sidebar, source-control files, diffs,
  reviews, search, AI Vault, and other heavy lists use virtualization where it
  matters.
- **Git refresh mechanics:** event/file/push signals, visibility gates,
  safety polling, slow-task backoff, huge-repo limits, worktree scan
  coalescing, and several narrow caches.
- **File watching:** Parcel watcher isolation prevents native watcher faults
  from taking down the main process and includes SSH/WSL-specific behavior.
- **Plugin runtime:** discovery is separated from worker activation; workers
  are bounded and idle-reaped.
- **AI Vault:** scans share one cache owner, incremental parse state and
  persisted parse caches exist, and OpenCode SQLite work is isolated in a
  worker entry.
- **Browser panes:** inactive worktree guests are parked unless
  automation-visible; diagnostics account for guest/parked state.
- **Mobile terminal delivery:** active-only subscription and batched WebView
  writes already address stream CPU.
- **Mobile workspace rendering:** equality-gated publication avoids the former
  unconditional rebuild cost.
- **Persistence:** async durable writes, no-op hashing, sidecars, patch-based
  session updates, and shutdown safety are all meaningful improvements.
- **Diagnostics:** startup, main-thread jank, idle CPU, terminal scale/parking,
  memory, workspace switch, and selector-fanout harnesses provide unusually
  good foundations for performance work.

Generic recommendations such as “virtualize the sidebar,” “unmount every
inactive desktop terminal,” “poll Git less,” or “move plugin workers out of the
main process” would duplicate existing work and risk regressions.

## Suggested delivery roadmap

### Phase 0 — measurement and guardrails

- Commit static-entry reports and ratcheted budgets.
- Add startup parse/evaluation and first-commit milestones.
- Add subprocess/RPC counters to the large-repo and slow-SSH benchmarks.
- Add mobile WebView count and per-process memory diagnostics.

### Phase 1 — dependency boundaries

- Extract a minimal main kernel and post-paint capability registry.
- Introduce shell/workspace/session renderer stores.
- Remove terminal and onboarding dependencies from non-terminal entries.
- Repair the SFTP/SSH false dynamic boundaries.

### Phase 2 — repository authority

- Add the host-scoped snapshot service.
- Migrate active status and Checks first.
- Migrate remaining desktop consumers, then runtime/mobile projections.
- Preserve mutation fences and add Git 2.25 real-binary coverage.

### Phase 3 — retained-resource scaling

- Ship mobile terminal hot retention behind a flag.
- Measure memory and reveal p95 on both mobile platforms.
- Add revisioned catalog replay, then relax three-second polling.

### Phase 4 — evidence-triggered persistence work

- Profile large real states.
- Partition only the domains that breach serialization or shutdown budgets.

## Coverage and methodology

This was an architectural performance review rather than a line-by-line
correctness audit. It combined:

- repository-wide production-file, synchronous-I/O, interval, worker, watcher,
  and process scans;
- main startup and service-wiring inspection;
- renderer entry, Zustand, React, IPC, and large-list inspection;
- Git status, worktree, upstream, provider, SSH/WSL/runtime flow tracing;
- desktop and mobile terminal lifecycle inspection;
- persistence and session-hydration inspection;
- browser, AI Vault, plugin, automation, resource, and background-service
  inspection;
- preload, shared RPC/runtime, CLI, mobile transport, and build configuration
  review;
- a production build plus startup, restored-state, selector-fanout, and mobile
  workspace-refresh benchmarks;
- review of the existing renderer memory profile and performance harnesses.

Measured facts are labeled with byte counts or benchmark results. Proposed
impacts are qualitative unless an A/B implementation exists. The review did
not use production telemetry, a Windows/Linux build host, a physical mobile
device, or a controlled slow-SSH lab, so rollout gates explicitly require
those environments.

## Benchmark commands

```bash
pnpm run build:electron-vite

node tools/benchmarks/startup-time-bench.mjs \
  --label big-picture-audit \
  --iterations 3 \
  --files 0 \
  --state-profile none \
  --linger-ms 300 \
  --timeout-ms 120000

node tools/benchmarks/startup-time-bench.mjs \
  --label big-picture-restored-200 \
  --iterations 3 \
  --files 0 \
  --state-profile restored-local-tabs \
  --session-tabs 200 \
  --linger-ms 300 \
  --timeout-ms 120000

node tools/benchmarks/startup-time-bench.mjs \
  --label big-picture-restored-1000 \
  --iterations 3 \
  --files 0 \
  --state-profile restored-local-tabs \
  --session-tabs 1000 \
  --linger-ms 300 \
  --timeout-ms 120000

pnpm bench:zustand-selector-fanout
pnpm --dir mobile repro:workspace-picker-lag
```

Generated build output and local benchmark JSON files are ignored by Git. The
material measurements are reproduced in this report so it remains
self-contained.
