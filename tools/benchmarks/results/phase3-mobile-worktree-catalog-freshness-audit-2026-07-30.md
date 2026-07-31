# Phase 3 mobile worktree catalog freshness audit

## Decision

Do not add `afterRevision`, whole-result reuse, replay, or a slower worktree poll until one
runtime-scoped freshness epoch covers every input to `worktree.ps`.

The existing resolved-worktree generation is safe for topology scans: newer invalidated work can
overtake older pending scans, stale completions cannot populate the cache, and each result retains
the platform map from its own generation. It is not a complete catalog revision.

## Catalog inputs

The projection combines:

- resolved worktree topology, lineage, visibility, host identity, and per-repo platform;
- repo records, GitHub PR cache, worktree metadata, unread, pinning, ordering, links, and labels;
- folder workspaces and project groups;
- fresh PTY-controller inventory, live leaves, retained PTYs, titles, previews, output times, and
  liveness;
- per-host terminal/browser sessions and the active workspace;
- OSC-retained and hook-owned agent rows plus orchestration labels and lineage;
- the current time, because non-done agent activity expires after 30 minutes;
- sorting and truncation derived from those fields.

## Existing ownership and gaps

Resolved topology has a monotonic generation, generation-keyed in-flight work, a one-second result
cache, and generation-guarded per-repo scan caches. The platform-generation regression proves a
fresh invalidated poll can overtake an older pending scan without joining stale work.

No corresponding complete generation exists for PTY semantic state, workspace sessions, agent
hooks, orchestration state, metadata/unread, GitHub cache, folder workspaces, or time-based expiry.
Representative desktop project, repo, worktree-metadata, structural watcher, and remote-worktree
paths update Store or renderer IPC without a matching runtime catalog event.

This means:

- request sequence alone cannot detect an input mutation with no later request;
- a post-build revision can describe an observation but not a transactional freshness boundary;
- a pre-build `unchanged` result can miss PTY, session, metadata, agent, folder, SSH, or expiry
  changes;
- whole-result coalescing can still join a fresh invalidated request to stale work.

## Compatibility contract

An eventual optional `afterRevision` parameter is additive. Older hosts will strip the unknown
field and return the current full response. New clients must treat missing revision data or any full
response as authoritative and retain the current safety poll.

New hosts must advertise a static `worktree.catalog-revision.v1` capability before returning
conditional responses. Revisions must be opaque and runtime-scoped so a host restart cannot collide
with a prior runtime. Old mobile and CLI callers must continue receiving the full legacy shape.

## Required implementation boundary

1. Introduce one catalog-input epoch owned by the runtime.
2. Bump it from Store metadata/folder authorities, PTY lifecycle and visible-state changes,
   session/graph updates, hook and orchestration updates, SSH/provider invalidation, and scheduled
   time-based expiry.
3. Capture the epoch and resolved-topology generation before building; publish only if both remain
   current after all awaits.
4. Use a request issue sequence for publication compare-and-swap so an older completion cannot
   replace a newer accepted snapshot.
5. Do not share complete builds across different epochs.
6. Add capability-gated full-build conditional responses first. Only later use the epoch to skip a
   build, replay retained changes, or lengthen steady polling.

## Preserved safety policy

- Foreground, reconnect, and event refreshes remain.
- Idle foreground polling remains every three seconds.
- Repo metadata retains its independent convergence interval.
- SSH/relay and folder-workspace behavior remains unchanged.
- Out-of-band Git, PTY-controller, and SSH changes retain periodic verification.
