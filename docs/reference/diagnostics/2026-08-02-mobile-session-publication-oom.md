# Renderer OOM on a multi-client runtime host (2026-08-02)

> Diagnostic evidence committed alongside the regression test so the defect can be audited. Remove before merge once the fix lands.

## Summary

An always-on Windows runtime host with four paired clients OOM'd its renderer four times in two days on `v1.4.163` and `v1.4.164-rc.3`.

The cause is not a memory leak. `buildMobileSessionTabSnapshots` rebuilds mobile-session content for **every** worktree on every publication, and consults its per-worktree cache **after** that work is done. The cache therefore suppresses fanout and one object allocation, but saves none of the computation. Publication is triggered by a sync key that includes `agentStatusByPaneKey` and `agentStatusEpoch`, so every agent status tick rebuilds the world.

## Measured defect

`src/renderer/src/runtime/sync-runtime-graph-publication-cost.test.ts` counts per-worktree work by reading a slice the build loop touches once per worktree.

| Scenario (300 worktrees) | Work units | Expected |
| --- | ---: | ---: |
| Republish, nothing changed | 601 | < 30 |
| Republish, one worktree changed | 602 | < 30 |

A single-worktree change rebuilds all 300. Each rebuilt worktree allocates three `Map`s, a group projection, and a full tab array.

## Field evidence

Affected profile held 381 worktrees (123 local + 258 from one paired runtime host).

| Metric | Wedged renderer | After removing the 258-worktree partition |
| --- | ---: | ---: |
| Working set | 4,444 MB | 234 MB |
| CPU | 106% of one core, sustained | 5% |
| Growth | +35 MB / 6 s | flat |
| Memory-heartbeat interval (nominal 60 s) | 2,450 s | 60 s |

Used-heap samples before the crash oscillated in a band — `3795 → 3720 → 3846 → 3786 → 3764 → 3858 MB` against a 4,192 MB limit — rather than climbing monotonically. That is allocation outrunning GC, not retention. The long major-GC pauses on a ~4 GB heap are the user-visible lag.

Removing the partition is a workaround, not a fix: it lowers worktree count rather than removing the per-publication cost.

## Why existing fixes did not cover this

`#11832 fix(runtime): bound persisted graph hydration` removed a quadratic whole-session rescan in the main process and is present in `v1.4.164-rc.3`. The host still OOM'd afterwards, because this path is renderer-side and independently O(all worktrees) per publication.

## Contributing factor: unbounded host session partitions

`workspaceSessionsByHostId` (added in `#5071`, 2026-06-13) accumulates per-worktree session state for every worktree a paired host reports, with no reclamation:

| Date | Store size | Paired-host worktrees |
| --- | ---: | ---: |
| 07-10 | 70 KB | 0 |
| 07-31 | 1,705 KB | 123 |
| 08-02 | 2,296 KB | 258 |

Growth rose from ~78 KB/day to ~295 KB/day once the host was paired. This inflates `N` for the loop above but is not itself the OOM mechanism. Note that a client with no `worktreeMeta`, no `lastVisitedAtByWorktreeId`, and no locally-registered repos for a remote host has no sound local signal for condemning these entries — reclamation needs a maintained liveness record, not an inferred one.

## Proposed fix

Invalidate before computing, rather than computing then comparing. Track per-worktree input references and skip worktrees whose inputs are unchanged before building any intermediate structures.

The authoritative input set is already enumerated by `RuntimeMobileSessionSyncKey`. Care is required for the pane- and tab-keyed slices (`agentStatusByPaneKey`, `runtimePaneTitlesByTabId`, `terminalLayoutsByTabId`, `nativeChatLaunchDraftByTabId`): a changed key must resolve to its owning worktree, and any input that cannot be resolved per worktree must conservatively force a full rebuild. Skipping a worktree whose input was missed publishes stale tabs to paired clients, so the dirty set must be complete or fall back.

Expected effect: a typical agent tick rebuilds one worktree instead of `N`, making publication cost scale with activity rather than with total worktree count.
