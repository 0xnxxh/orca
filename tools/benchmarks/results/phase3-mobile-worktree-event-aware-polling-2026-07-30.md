# Phase 3 mobile worktree event-aware polling

## Decision

Retain an event-aware worktree safety timer. A worktree snapshot admitted after the modal and
in-flight guards now resets only the next three-second worktree poll when triggered by a foreground
return, `worktreesChanged`, or client-event replay. A suppressed refresh keeps the existing safety
deadline. The independent repo-metadata interval remains fixed, preserving convergence for desktop
Settings edits that do not reach the runtime event stream.

The existing foreground gate, background behavior, immediate mount refresh, reconnect recovery,
manual refreshes, modal guard, request in-flight guard, RPC method, payload, and response admission
are unchanged.

## Deterministic A/B request count

The focused fake-timer fixture issues `worktreesChanged` at 2.9 seconds, immediately after the mount
snapshot and immediately before the old fixed poll.

| First three seconds                | Fixed interval | Event-aware timer |
| ---------------------------------- | -------------: | ----------------: |
| Mount worktree snapshot            |              1 |                 1 |
| Event worktree snapshot at 2.9s    |              1 |                 1 |
| Safety snapshot at 3.0s            |              1 |                 0 |
| Total worktree snapshot requests   |              3 |                 2 |
| Repo-metadata safety calls at 3.0s |              1 |                 1 |

The next worktree safety snapshot occurs at 5.9 seconds. This removes the back-to-back request
without weakening the maximum three-second interval after the most recent requested refresh.
Continuous worktree events continue requesting current snapshots themselves while postponing only
the redundant safety request.

## Rejected precursor

A host-side full-result coalescing arm reduced ten concurrent logical `worktree.ps` calls to one
builder call, but it was not retained. Request limit is not a sufficient freshness identity: after
a worktree/platform invalidation, a newer poll must overtake an older pending scan. The arm joined
the new request to stale work and timed out the existing platform-generation regression.

The lower resolved-worktree scan already shares in-flight topology work by generation. Full catalog
reuse must wait for a freshness revision spanning topology, PTY, session, agent, unread, and metadata
inputs.

## Validation

- Focused host-refresh suite: 1 file, 7 tests passed.
- Full mobile suite: 370 files, 2,716 passed, 2 skipped.
- Platform-generation overtaking regression: 1 passed.
- Mobile typecheck, lint, format check, max-lines ratchet, and `git diff --check` passed.

## Limitations

- The deterministic count proves scheduling and call boundaries, not live relay latency or server CPU.
- Steady idle foreground behavior remains one `worktree.ps` request every three seconds.
- This does not add replay or relax polling; those require the complete catalog freshness boundary.
