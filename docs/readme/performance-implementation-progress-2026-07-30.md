# Performance implementation progress

- **Branch:** `nwparker/big-picture-perf`
- **Draft PR:** [#11539](https://github.com/stablyai/orca/pull/11539)
- **Tranche base:** `d67628e876eb1f4ff3b199572c5be1e2280b185f`
- **Policy:** keep the PR draft; do not merge, rebase, or mark ready without approval

## Delivery status

| Phase | Tranche                                      | Status                              | Evidence                                                                                                                                  |
| ----- | -------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Electron static-entry report and budget gate | Complete                            | Ratcheted raw-size and chunk-count budgets run after the existing PR build                                                                |
| 1     | Linear setup/onboarding lazy boundary        | Complete                            | Main renderer static graph reduced by about 1.29 MB and 10 JavaScript chunks                                                              |
| 1     | SSH/SFTP false-boundary repairs              | Complete                            | Measured main-entry reductions with packaged relative chunks and focused transfer tests                                                   |
| 2     | Host-owned repository snapshots              | Complete through current checkpoint | Repository, source-control, space-manager, mobile source-control, review, and runtime consumers reuse authoritative revisions             |
| 3     | Mobile terminal hot set and cold parking     | Published to draft PR               | Default-off active + two MRU policy with one grace pane, source-provenanced snapshot/replay reveal, cleanup, diagnostics, and regressions |
| 3     | Mobile worktree event-aware safety polling   | Published to draft PR               | Event, foreground, and reconnect refreshes defer only the next redundant worktree poll                                                    |
| 3     | Mobile catalog freshness ownership audit     | Complete; implementation pending    | Mapped topology, metadata, folder, PTY, session, agent, orchestration, SSH/provider, and time-based inputs                                |

## Current mobile hot-set tranche

The worktree is intentionally uncommitted while review finishes. The feature is enabled only when:

```ts
process.env.EXPO_PUBLIC_ORCA_MOBILE_TERMINAL_HOT_SET === '1'
```

Implemented invariants:

- Active terminal plus two MRU WebViews remain warm.
- One cancellable 20-second grace pane allows four transient mounts and three steady mounts.
- Durable terminal, tab, split, mode, unread, and cursor metadata remains authoritative.
- Only the active terminal owns a live subscription.
- Cold reveal uses an authoritative, source-provenanced complete snapshot plus buffered replay.
- Disconnect, malformed or truncated scrollback, stream failure, readiness failure, timeout, and route uncertainty permanently fail open.
- WebView readiness is init-generation tagged and reported as `render-ready`, not compositor paint.
- Eviction clears WebView, subscription, init, layout, ref, gesture, selection, and keyboard state.
- Render-time candidates do not publish stream, cold-reveal, or eviction authority until commit.
- Legitimate terminal to non-terminal to terminal navigation remains admissible.

Correction validation reported by the implementation worker:

- Focused mobile suites: 18 files, 111 tests passed.
- Full mobile suite: 369 files, 2,709 passed, 2 skipped.
- Runtime snapshot/replay suites: 7 files, 25 tests passed.
- Mobile typecheck, lint, format check, max-lines ratchet, and `git diff --check` passed.

Local fallback validation after the orchestration failure:

- Focused correction suites: 6 files, 31 tests passed.
- Full mobile suite: 370 files, 2,714 passed, 2 skipped.
- Runtime snapshot/replay suites: 7 files, 25 tests passed.
- Mobile and Node typechecks, mobile lint and format check, targeted Node lint and format check,
  max-lines ratchet, and `git diff --check` passed.

## Review state

The first independent review found and reproduced five issues:

1. Disconnect uncertainty did not remain failed open after reconnect.
2. Stale WebView readiness could complete or report success after a newer init or fail-open.
3. Malformed truncation metadata could be admitted.
4. Render-time ref mutation could publish authority from an aborted render.
5. `first-paint` diagnostics overclaimed a pre-compositor readiness boundary.

All five have corrections and focused regressions. The subsequent independent read-only review
identified and verified corrections for five additional edge cases:

1. Completed WebView generations were not invalidated on load start or unmount.
2. Same-subscription reinitialization could publish a stale viewport measurement.
3. Overlay reload waited for the asynchronous load-start callback before invalidating readiness.
4. Legitimate non-terminal tab visits permanently triggered `missing-active-handle`.
5. Source-less empty fallback payloads could masquerade as authoritative snapshots.

The final independent review found no remaining correctness, security, or maintainability issues.
Orca orchestration remains unavailable after updating to `1.4.163-rc.0` because its packaged skill
loader fails with:

```text
Cannot find module '../../main/codex-cli/command'
Require stack:
- /Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/cli/handlers/skills.js
```

Per user direction, work continued locally with this ledger and a tracked read-only sub-agent.

## Remaining gates

- Durable physical iOS and Android evidence for memory deltas and cold-reveal p95 before enabling the feature by default.
- Physical-device process-loss, foreground, selection, keyboard, SSH/relay, and folder-workspace confirmation.
- Validate and publish the event-aware mobile worktree polling checkpoint while keeping PR #11539 draft.
- Add complete catalog freshness ownership before introducing replay or relaxing idle polling.

## Next tranche exploration

The next roadmap target is the revisioned mobile workspace catalog. The current foreground path
performs one full `worktree.ps` request every three seconds per client, plus event, foreground, and
reconnect refreshes.

A full-result in-flight coalescing arm reduced ten concurrent logical requests to one builder call,
but it was rejected and restored. A worktree/platform invalidation must allow a newer poll to
overtake an older pending scan; sharing only by request limit joined the fresh request to stale work
and timed out the existing generation regression. The lower resolved-worktree scan already shares
in-flight work by generation.

The next retained seam must therefore carry an exact catalog freshness generation across topology,
PTY, session, agent, unread, and metadata inputs before any full-result reuse or polling relaxation.

The first retained catalog-side reduction keeps the three-second safety policy but makes its
worktree timer event-aware. A worktree refresh triggered at 2.9 seconds now postpones the next
safety snapshot until 5.9 seconds instead of issuing a duplicate at 3.0 seconds. Repo metadata
retains its independent fixed interval and unchanged 60-second callee throttle. Modal-blocked or
in-flight-suppressed refreshes do not postpone the existing safety deadline.

Checkpoint validation:

- Focused host-refresh suite: 1 file, 7 tests passed.
- Full mobile suite: 370 files, 2,716 passed, 2 skipped.
- Platform-generation overtaking regression: 1 passed.
- Mobile typecheck, lint, format check, max-lines ratchet, and `git diff --check` passed.

## Catalog freshness ownership audit

The full catalog projection is not currently governed by one revision. Resolved worktree topology
has generation-keyed in-flight sharing and cache admission, but the returned rows also read repo and
worktree metadata, folder workspaces, fresh PTY-controller inventory, live leaves and retained PTYs,
workspace sessions, agent hooks and OSC snapshots, orchestration labels, SSH/provider state, and
time-based agent expiry.

Several of those authorities mutate without `worktreesChanged`, and some desktop IPC paths notify
only the renderer. Therefore neither request ordering nor the existing topology generation can
justify a pre-build `unchanged` response, whole-result reuse, replay, or a slower foreground poll.
An optional `afterRevision` field would be wire-compatible with older hosts, but it remains deferred
until its freshness meaning is complete.

The next implementation boundary is one runtime-scoped catalog-input epoch:

1. Bump it at every catalog authority, including scheduled time-based expiry.
2. Capture the epoch and resolved-topology generation before a build and verify both after awaits.
3. Use request-sequence compare-and-swap so an older completion cannot publish after a newer one.
4. Keep full independent builds across epochs; never join fresh requests to stale work.
5. Only then capability-gate conditional snapshots and later add replay/gap recovery.

The detailed input and compatibility map is recorded in
`tools/benchmarks/results/phase3-mobile-worktree-catalog-freshness-audit-2026-07-30.md`.
