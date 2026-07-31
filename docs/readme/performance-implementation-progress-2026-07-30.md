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
| 3     | Mobile terminal hot set and cold parking     | Validated; draft checkpoint pending | Default-off active + two MRU policy with one grace pane, source-provenanced snapshot/replay reveal, cleanup, diagnostics, and regressions |

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
- Commit, push, and update draft PR #11539 while keeping it draft.
- Select the next measured roadmap tranche after this checkpoint is safely published.
