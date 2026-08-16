# Readiness Baseline — origin/main

Bookend capture of `main` **before** the release-blocker pipeline's PRs land, so a closing
run at the end of the session can be diffed against it.

| | |
|---|---|
| Base commit | `93ab6e142ee1eb1ac9898e23f2b7515385f81a5b` |
| Commit subject | `refactor(source-control): extract modules to half SourceControl.tsx (#14396)` |
| Worktree | `/home/brennan/orca/workspaces/orca/readiness-baseline` (branch `brennanb2025/readiness-baseline`) |
| Run started | 2026-08-16T17:45:21Z |
| Host | `openclaw`, Linux, 8 cores, ~15 GB RAM (shared) |
| Node | v26.1.0 |

Gate selection is driven by what CI actually enforces: `.github/workflows/pr.yml`
(static analysis + typecheck + sharded tests), `.github/workflows/mobile.yml`, and
`.github/workflows/e2e.yml`.

---

## 1. Verdict

**PASS on everything measured — with one uncovered gate.**

Every readiness gate that completed is green at `93ab6e142e`: 18 gates run, 18 passed, 0
failed. There is **no new breakage** on main, and the briefed "pre-existing main breakage"
no longer reproduces — it was already fixed on main (see §4.1).

**The root unit test suite did not finish** and produced no signal (§2.6). That is the one
hole in this baseline and it is a large one. The lane was stopped mid-run when the pipeline
moved off this box.

`/readiness-checklist` was invocable — the skill is symlinked into
`.claude/skills/readiness-checklist` and its `SKILL.md` was read and followed. It is a
seven-category *code review* checklist rather than a gate runner, so this report pairs it
with the concrete CI gates from `.github/workflows/`: gates in §2, checklist-driven review
of the incoming PR areas in §7.

Four things the coordinator must act on before landing PRs are in §6.

---

## 2. Gate results

### 2.1 Root static analysis — the ten sub-gates of `pnpm run lint`

| # | Gate | Command | Exit | Result |
|---|---|---|---|---|
| 1 | oxlint | `npx oxlint` | 0 | PASS |
| 2 | code-quality native | `npx oxlint --config config/oxlint-code-quality-native-plugins.json src config tests mobile --deny-warnings` | 0 | PASS |
| 3 | code-quality type-aware | `npx oxlint --type-aware --config config/oxlint-code-quality-type-aware.json src config tests --deny-warnings` | 0 | PASS |
| 4 | reliability gates | `node config/scripts/check-reliability-gates.mjs` | 0 | PASS |
| 5 | max-lines ratchet | `node config/scripts/check-max-lines-ratchet.mjs` | 0 | PASS |
| 6 | bundled skill guides | `node config/scripts/generate-bundled-skill-guides.mjs --check` | 0 | PASS |
| 7 | skill bundle manifest | `node config/scripts/generate-skill-bundle-manifest.mjs` | 0 | PASS |
| 8 | localization catalog | `node config/scripts/verify-localization-catalog.mjs` | 0 | PASS |
| 9 | localization extraction | `node config/scripts/verify-localization-extraction.mjs` | 0 | PASS |
| 10 | localization coverage | `node config/scripts/audit-localization-coverage.mjs --check` | 0 | PASS |

oxlint prints nothing when clean, so exit codes are echoed as proof the gate ran:

```
=== GATE: oxlint (bare) ===
EXIT=0
=== GATE: audit:code-quality:native ===
EXIT=0
=== GATE: audit:code-quality:type-aware ===
EXIT=0
```

Gates that do print:

```
=== check-reliability-gates ===
EXIT=0
Reliability gate manifest check passed for 85 gate(s).
=== check-max-lines-ratchet ===
EXIT=0
max-lines ratchet OK — 255 grandfathered suppression(s), no new bypasses.
```

```
=== verify:localization-catalog ===
EXIT=0
Verified 11866 localization key references against en.json.
es.json coverage: 11804/12737 translated, 933 missing.
ja.json coverage: 11804/12737 translated, 933 missing.
ko.json coverage: 11809/12737 translated, 928 missing.
zh.json coverage: 11814/12737 translated, 923 missing.
=== verify:localization-extraction ===
EXIT=0
Extracted 10519 keys; 17 dynamic defaults are report-only, 2218 existing English entries
are not statically referenced, and 42 inline defaults differ.
=== verify:localization-coverage ===
EXIT=0
Localization coverage check passed with 12 allowlisted candidates.
```

Non-English catalogs sit at ~92-93% translated. The coverage gate passes at that level, so
this is the accepted baseline, not a regression — recorded here so the closing run can tell
"still 933 missing" from "grew by N".

### 2.2 Other `pr.yml` static gates

| Gate | Command | Exit | Result |
|---|---|---|---|
| feature wall asset budget | `node config/scripts/check-feature-wall-assets.mjs` | 0 | PASS |
| macOS entitlements | `node config/scripts/verify-macos-entitlements.mjs` | 0 | PASS |
| zustand selector fan-out | `node config/scripts/zustand-selector-fanout-benchmark.mjs --check` | 0 | PASS |

```
=== check:feature-wall-assets ===
EXIT=0
Feature wall assets: 10.92 MB / 11.00 MB
=== verify:macos-entitlements ===
EXIT=0
resources/build/entitlements.mac.plist: OK
resources/build/entitlements.computer-use.mac.plist: OK
=== check:zustand-selector-fanout ===
EXIT=0
Zustand fan-out: 2500 subscribers × 2000 unrelated writes = 5,000,000 selector runs
Median 34.60 ms total, 0.0173 ms/write, 0 render invalidations
```

**Feature wall assets are at 10.92 / 11.00 MB — 99.3% of budget, 0.08 MB of headroom.**
This passes today but is one added asset away from failing. See §6.

### 2.3 Typechecks

CI runs `pnpm typecheck`, which is the three projects below. Per the lane constraint
`tsc -b` was not used; each project was checked with `--noEmit -p`.

| Gate | Command | Exit | Result |
|---|---|---|---|
| typecheck:node | `npx tsc --noEmit -p config/tsconfig.node.json` | 0 | PASS |
| typecheck:cli | `npx tsc --noEmit -p config/tsconfig.tc.cli.json` | 0 | PASS |
| typecheck:web | `npx tsc --noEmit -p config/tsconfig.tc.web.json` | 0 | PASS |

```
=== typecheck:node ===
EXIT=0
=== typecheck:cli ===
EXIT=0
=== typecheck:web ===
EXIT=0
```

### 2.4 Mobile gates (`mobile.yml`)

| Gate | Command (from `mobile/`) | Exit | Result |
|---|---|---|---|
| lint | `npx oxlint` | 0 | PASS |
| format:check | `npx oxfmt --check .` | 0 | PASS |
| typecheck | `./node_modules/.bin/tsc --noEmit` | 0 | PASS |
| test | `npx vitest run --config vitest.config.ts` | 0 | PASS |
| iOS release version | `ruby fastlane/ios_release_version_test.rb` | 127 | **NOT RUN** — no `ruby` on this box |

```
=== mobile format:check (oxfmt) ===
EXIT=0
All matched files use the correct format.
Finished in 414ms on 1215 files using 8 threads.

=== mobile typecheck (rerun) ===
EXIT=0

=== mobile test ===
EXIT=0
 Test Files  448 passed (448)
      Tests  3521 passed | 3 skipped (3524)
   Duration  34.77s
```

Two environment facts behind these numbers are recorded in §5 and §6 — `mobile/node_modules`
was **empty** at the start of this run, and bare `npx tsc` in `mobile/` produces bogus errors.

### 2.5 Test-focus hygiene

No focused tests anywhere, so neither suite is silently skipping coverage:

```
$ grep -rnE "\b(describe|it|test)\.only\(" --include='*.test.ts' --include='*.test.tsx' \
    --include='*.test.mjs' src config tests | wc -l
0
$ grep -rnE "\b(describe|it|test)\.only\(" --include='*.test.ts' --include='*.test.tsx' \
    mobile/src | wc -l
0
```

A stray `.only` on a pipeline branch would shrink the suite while still reporting green, so
this is worth re-checking in the closing run.

### 2.6 Root unit test suite

**STATUS: NOT COMPLETED. NO RESULT.**

The lane was stopped before this suite finished (the pipeline moved off this box). It ran
for roughly 25 minutes without reaching its summary and was terminated incomplete.

**This gate produced no pass/fail signal at all — do not read it as passing.** Vitest buffers
its summary to the end of a non-TTY run, so an unfinished run yields no partial counts, and
`/tmp/rb-logs/root-tests-run1.log` contains no `Test Files` / `Tests` lines. The only content
it emitted was incidental stderr from an SSH-relay fixture:

```
 RUN  v4.1.5 /home/brennan/orca/workspaces/orca/readiness-baseline
[ssh-relay] GC: lock at /home/u/.orca-remote/relay-0.1.0+aaa/.install-lock is stale; treating as recoverable
```

That line is fixture output from a test in progress, not a failure.

**Consequence for the closing run:** there is no root-unit-test baseline to diff against.
The closing run should either run this suite to completion or, more practically on a
constrained box, run it sharded (`--shard=N/16`, matching CI) so partial coverage is at
least recorded with real numbers. Everything else in this report is a real, completed
measurement; this one is a hole.

The suite is large — 5,664 test files match the `config/vitest.config.ts` include globs. CI
splits this across a 16-shard × 2-Node-version matrix; locally it runs unsharded, so it takes
far longer than any CI shard.

Command (CI's exact exclude list from `.github/workflows/pr.yml`, unsharded, workers capped
at 4 to stay inside this box's memory budget):

```
npx vitest run --config config/vitest.config.ts \
  --exclude=src/main/daemon/repro-13767-shell-ready-marker-lost-to-exec.test.ts \
  --exclude=src/main/daemon/shell-ready.test.ts \
  --exclude=src/main/daemon/node-pty-fd-leak.test.ts \
  --exclude=src/main/providers/local-pty-shell-ready-zsh-launch-environment.test.ts \
  --exclude=src/main/providers/local-pty-shell-ready-zsh-startup-file-behavior.test.ts \
  --exclude=src/main/providers/local-pty-shell-ready-zsh-zdotdir-discovery.test.ts \
  --exclude=src/main/providers/local-pty-shell-ready-zsh-zdotdir-normalization.test.ts \
  --exclude='src/main/providers/__tests__/shell-ready-framework-example.test.ts' \
  --exclude=src/main/pty/omp-shell-wrapper.node-pty.test.ts \
  --exclude=src/renderer/src/components/terminal-pane/fish-color-scheme-child-stdin.node-pty.test.ts \
  --exclude=src/shared/posix-command-path-lookup.test.ts \
  --exclude='tests/e2e/cross-version-wire/**' \
  --maxWorkers=4
```

Log: `/tmp/rb-logs/root-tests-run1.log`. Vitest buffers its summary to the end of a non-TTY
run, so no partial pass/fail counts are available mid-run.

<!--ROOT_TESTS-->

---

## 3. Flaky vs deterministic

Every gate in §2.1-§2.4 passed, so there is nothing to re-run to separate flake from a real
failure — a pass is a pass. Re-runs are reserved for the root suite in §2.6 if it reports
any failure.

Two gates were run twice for unrelated reasons, and both were stable:

- **`audit:code-quality:type-aware`** — run once over `src config tests` and once against
  `config/scripts/pr-test-loc-summary.test.mjs` alone, to test the lane brief's claim. Exit 0
  both times (§4.1).
- **`mobile typecheck`** — first run failed, second passed. This was **not** flake: the first
  invocation resolved the wrong TypeScript compiler. Root cause and fix in §6.5.

### Watchdog interference: ruled out

Per the safety directive, `/tmp/runtime-watchdog.log` was checked before recording any
result:

```
[2026-08-16 10:38:18] watchdog started (pid 16693)
[2026-08-16 10:38:48] runtime unreachable (2 checks) — restarting
[2026-08-16 10:38:48] cleared stale :95 lock (dead pid 2198878)
[2026-08-16 10:38:51] restarted Xvfb :95
[2026-08-16 10:38:56] runtime back up on 16770
```

The restart window is 10:38:48-10:38:56 local. This run began at 17:45:21Z = **10:45:21
local**, roughly seven minutes *after* the restart completed. No gate in this report ran
inside that window.

Independently: every gate run here is a plain CLI process (oxlint, oxfmt, tsc, node scripts,
vitest) that never touches the Orca runtime, display `:95`, or the `serve` process. There is
no path by which a watchdog restart could have produced a false red in this report. Had E2E
been run (§5) that would not be true.

---

## 4. Pre-existing vs new

### 4.1 The briefed pre-existing breakage does NOT reproduce — it is already fixed

The lane brief stated that PR #14738 (`393c8764e0`) left
`config/scripts/pr-test-loc-summary.test.mjs` tripping the type-aware audit under
`--deny-warnings`, inherited by every branch, owned by Neil (STA-4484).

**That is stale.** At `93ab6e142e` the type-aware audit is clean, both across the whole
tree and on that file alone:

```
$ npx oxlint --type-aware --config config/oxlint-code-quality-type-aware.json \
    config/scripts/pr-test-loc-summary.test.mjs --deny-warnings
OXLINT_EXIT=0
```

The fix landed in a follow-up that is already an ancestor of the base commit:

```
$ git log --oneline -- config/scripts/pr-test-loc-summary.test.mjs
931cb037c5 fix(ci): satisfy restrict-template-expressions in pr-test-loc-summary test (#14755)
393c8764e0 ci: post test vs non-test LoC on pull requests (#14738)
```

Branches cut from `93ab6e142e` or later do **not** inherit this. A branch that fails the
type-aware audit is failing on its own changes, and should not be excused as pre-existing.

### 4.2 The "test vs non-test LoC" CI job 404 — could not be reproduced locally, treat as still open

Both scripts the job fetches **do** exist at the path the workflow uses:

```
$ ls .github/scripts/
check-root-directory-entries.mjs
pr-test-loc-summary.mjs
pr-test-loc-table.mjs
render-readme-downloads-badge.mjs
```

`.github/workflows/pr-test-loc.yml` pulls them at runtime through the contents API rather
than checking out:

```
gh api "repos/${GITHUB_REPOSITORY}/contents/.github/scripts/${script}?ref=pull/${PR}/head" \
  --jq .content | base64 --decode > "$RUNNER_TEMP/${script}"
```

The 404 is a CI-runtime behavior of that `gh api` call (the `ref=pull/N/head` form), not a
missing file in the tree. It cannot be reproduced from a local worktree with no PR context,
so this half of the brief stands: **still open, still Neil's / STA-4484**, and not a finding
of this lane. It is also non-blocking — the job only posts a PR comment.

### 4.3 Genuinely new breakage found by this run

**None.** No gate failed for a reason attributable to the state of `main`.

### 4.4 Not breakage, but a difference from CI worth recording

`oxfmt --check .` at the repo root reports 21 unformatted files:

```
$ npx oxfmt --check .
EXIT=1
README.md
config/electron-builder.config.cjs
docs/STYLEGUIDE.md
docs/reference/git-compatibility.md
docs/reference/headless-linux-server.md
docs/reference/linux-glibc-compatibility.md
docs/reference/windows-setup-shell.md
docs/reference/worktree-scan-fingerprint.md
skill-guides/orca-emulator-android.md
skill-guides/orca-emulator.md
skill-guides/orca-per-workspace-env.md
tests/e2e/fixtures/terminal-emoji-table.md
tests/e2e/ssh-config-host-picker.PLAN.md
tests/tools/daemon-relocation-spike/README.md
tests/tools/repro-watcher-crash-7547/fixed-child.cjs
tests/tools/repro-watcher-crash-7547/run.cjs
tests/tools/win-update-e2e/README.md
Format issues found in above 21 files.
```

**This is not a failing gate.** No root workflow runs `oxfmt --check`; only `mobile.yml`
does (`pnpm format:check`, which passes). The root `format` script is write-only
(`oxfmt --write .`). The drift is almost entirely Markdown and two `.cjs` files.

It matters for one reason: **anyone who runs `pnpm run format` at the repo root will
reformat all 21 unrelated files into their diff.** Lanes should format by explicit path.

---

## 5. Gates NOT run, and why

| Gate | Why not |
|---|---|
| **Root unit test suite** (`pr.yml` tests matrix) | Started, ran ~25 min, **terminated incomplete** when the lane was stopped. No pass/fail signal. See §2.6. |
| **Playwright E2E** (`e2e.yml`, 10 shards) | Requires a full `build:electron-vite` + Electron app build, then 10 shards of Electron runs. The box is memory constrained (~15 GB shared, ~2-3 GB free while the unit suite ran) and the lane constraint allows one heavy build at a time. Electron binary and display `:95` are available, so a *golden subset* is feasible on request — see §6. |
| **`ruby fastlane/ios_release_version_test.rb`** | `ruby: command not found` (exit 127). Not installable within a read-only lane. |
| **`check:code-quality:changed`**, **`check:react-doctor:changed`** | Both take a PR base SHA and diff against it. On an unmodified `main` the changed set is empty, so they are no-ops and carry no baseline signal. They are PR-context gates, not main-state gates. |
| **`audit:react-doctor`**, **`audit:dead-code`** | Both are `pnpm dlx` (network fetch of `react-doctor@0.9.1` / `knip@5.88.1`). Neither is in `pr.yml`. Skipped to keep the run hermetic. |
| **Package / build jobs** (`pr.yml` `package`, `build:desktop`, native builds) | Heavy multi-minute builds; same memory constraint. |
| **Git compatibility matrix, shell contracts (zsh/fish), Node 18 managed hooks, cross-version wire** | Each needs a runtime this box does not provide (multiple Git versions, fish 4+, Node 18) or a CI-provisioned matrix. |
| **Windows / macOS specific workflows** | Wrong platform. |
| **Node 24 test matrix** | CI runs the suite on Node 24 *and* 26. This box has Node 26 only, so the Node 24 half of the matrix is uncovered. |

---

## 6. What the coordinator must know before landing PRs

### 6.1 The mobile reland must carry a fix, not just a re-apply — P0 if ignored

`b8dc393c18` reverted #14665 **because it introduced a launch-blocking regression**
(PR #14819 body; reland tracked as **STA-4482**). The revert commit message itself gives no
reason, so a lane reading only `git log` would conclude the revert was cosmetic and
re-apply the original commit verbatim. That would reintroduce a launch-blocking regression
into a release candidate.

Before the mobile lane writes code it needs the actual failure mode from #14665 / STA-4482.
Detail in §7, Area 3.

### 6.2 The lane brief's "pre-existing main breakage" is half stale — do not let branches hide behind it

The type-aware audit failure attributed to #14738 was fixed by `931cb037c5` (#14755), which
is already an ancestor of the base commit. It is **green at `93ab6e142e`** (§4.1). If a
pipeline branch fails `audit:code-quality:type-aware`, that failure is its own and must not
be waved through as inherited.

The other half — the "test vs non-test LoC" job 404 — is not locally reproducible and does
stay open with Neil / STA-4484. It only posts a PR comment, so it blocks nothing (§4.2).

### 6.3 Feature-wall asset budget has 0.08 MB of headroom

`Feature wall assets: 10.92 MB / 11.00 MB` — 99.3% consumed. Any PR that adds or grows a
feature-wall asset fails `check:feature-wall-assets` in `pr.yml`. None of the four areas
obviously touch these assets, but it is a trip-wire with essentially no slack.

### 6.4 `mobile/node_modules` was empty in this worktree — check the other lanes

The lane brief said this worktree had `node_modules` and `mobile/node_modules`. Root was
installed; **`mobile/node_modules` was an empty directory**, so no mobile gate could run.
A survey of every worktree on this box at the start of the run:

```
blocker-pipeline-coordinator: 0    fix-glue-cluster: 0
fix-14350-cluster: 0               readiness-baseline: 0   (fixed during this run)
fix-4449-4491: 0                   repro-4449-4491: 0
fix-4451: 0                        review-4363: 56         (the only complete one)
```

**Every lane except `review-4363` cannot run a single mobile test or typecheck.** That
matters directly: the mobile native-chat reland (Area 3) lives entirely in `mobile/`. The
fix is cheap — the pnpm store is warm (966 MB), and `pnpm install --frozen-lockfile` inside
`mobile/` completed in seconds here.

### 6.5 Do not typecheck mobile with bare `npx tsc`

From `mobile/`, bare `npx tsc` resolves the **root**'s TypeScript 7.0.2 and produces two
bogus errors that look like real main breakage:

```
tsconfig.json(2,14): error TS6053: File 'expo/tsconfig.base.json' not found.
tsconfig.json(6,5): error TS5102: Option 'baseUrl' has been removed.
```

`mobile/tsconfig.json` says in a comment that mobile deliberately stays on TypeScript 6 so
Expo/Metro can use the JS compiler API during release bundling. Mobile's own toolchain is
`tsc` **6.0.3**. Use `pnpm typecheck` from inside `mobile/` (or
`./node_modules/.bin/tsc --noEmit`), which is what `mobile.yml` does. Under the correct
compiler the mobile typecheck is clean.

### 6.6 Format by explicit path

`pnpm run format` at the repo root is `oxfmt --write .` and will reformat 21 already-drifted
unrelated files (mostly Markdown) into whatever diff is open. No root CI job checks this, so
the drift is not otherwise a problem (§4.4).

### 6.7 Coverage this baseline does not give you

No E2E, no packaging, and no Node 24 run (§5). If a pipeline PR touches startup, session
restore, or terminal behavior, a golden E2E subset should be run before landing — the
Electron binary and display `:95` are available on this box, so
`pnpm run test:e2e:workspace-session-golden` is feasible on request. It was not run here
because it needs a full Electron build and the box could not carry it alongside the unit
suite.

### 6.8 Shared-repo hygiene note

`git tag --sort=-creatordate` shows a local tag `repro-4449-4491-failing-test` ahead of the
real release tags. It appears to be another lane's scratch tag in this shared repo. Harmless,
but anything that resolves "the latest tag" will pick it up instead of `v1.4.178`.

---

## 7. Baseline notes on the four incoming PR areas

Read-only review against the `readiness-checklist` categories, scoped to the areas the
pipeline is preparing PRs for. Only observations backed by file evidence are listed;
nothing here is a proven defect on main.

### Release context

`package.json` version is `1.4.178-rc.2`. `main` is **540 commits ahead of `v1.4.178`** and
503 ahead of `v1.4.178-rc.2`, with six reverts in that range — one of them the mobile
native-chat revert this pipeline is relanding. That is a large, revert-heavy delta; the
closing readiness run is worth more than usual here.

### Area 1 — Generated workspace-name retirement

Files: `src/main/worktree-name-retirement.ts` (13 KB),
`src/main/persistence.ts` (**312 KB**), `src/main/orca-profiles/`, `src/main/ssh/` (222 files).

- **Persisted-state surface (checklist 06 — backcompat / data loss).**
  `src/shared/persisted-state-types.ts:74,76` holds the two optional registries:
  ```
  retiredWorktreeNamesByRepo?: Record<string, RetiredNameRegistry>
  retiredWorktreeNamesByNamespace?: Record<string, RetiredNameRegistry>
  ```
  Both are user-owned persisted state. Any reshaping needs a rollback story, not just a
  forward migration.
- **RPC / wire surface (checklist 01, and `docs/reference/remote-wire-compatibility.md`).**
  There is an RPC method for this feature —
  `src/main/runtime/rpc/methods/worktree-retired-names.test.ts` exercises it. Retirement
  data crosses the client/host boundary, so mixed-version pairs apply.
- **Existing safety net:** `src/main/worktree-name-retirement.test.ts`,
  `src/main/persistence-worktree-name-retirement.test.ts`,
  `src/shared/worktree/retired-name-registry.test.ts`,
  `src/shared/worktree/retired-name-cache.test.ts`, plus the RPC method test. Good coverage.
- **Cross-platform note:** the module already handles WSL explicitly and deliberately
  declines to memoize the namespace key when a distro is stopped
  (`worktree-name-retirement.ts:151-156`). Preserve that when refactoring — removing it
  strands a repo in a fallback namespace for the whole session.
- **`persistence.ts` is 312 KB.** Editing it is the riskiest part of this PR; the max-lines
  ratchet currently carries 255 grandfathered suppressions, and per `AGENTS.md` no new
  `max-lines` disable may be added.

### Area 2 — Native chat image markers

Files: `src/shared/native-chat-image-transcript-markers.ts` (4.8 KB),
`src/renderer/src/components/native-chat/`.

- Pure, dependency-light transcript normalization; no I/O, no persistence, no wire surface.
  Lowest-risk of the four areas.
- **Existing safety net:** `src/shared/native-chat-image-transcript-markers.test.ts` and
  `src/renderer/src/components/native-chat/native-chat-image-paste.test.ts`.
- `normalizeImageTranscriptMessages` merges a run of `[Image: source: …]` user turns into
  the following marker-carrying prompt, and falls back to emitting each source turn as its
  own `image-ref` turn when no marked prompt follows. Both branches are the contract to
  preserve.

### Area 3 — Mobile native chat glue / pending retirement  ⚠️ highest risk

Files: `mobile/src/session/`.

**This is a reland of a revert, and the revert was for a launch-blocking regression.**

`b8dc393c18` (#14819, merged 2026-08-15T23:34:57Z, by Jinjing) reverted `68ca17e46c` (#14665).
The revert commit message says only "This reverts commit …", but the PR body states the
reason:

> This reverts #14665 because it introduced a launch-blocking regression.
> We will reland with a fix: https://linear.app/stably/issue/STA-4482/reland-14665-retire-glued-mobile-pending-bubbles-after-revert-14819

The revert removed 656 lines against 29 added:

```
$ git show --stat b8dc393c18
 mobile/src/session/mobile-native-chat-pending-echo.ts             |   4 -
 mobile/src/session/mobile-native-chat-pending-retirement.test.ts  | 285 ---
 mobile/src/session/mobile-native-chat-pending-retirement.ts       | 144 ---
 mobile/src/session/use-mobile-native-chat-controller.test.ts      |   3 +-
 mobile/src/session/use-mobile-native-chat-drafts-glued-pending.test.ts | 167 ---
 mobile/src/session/use-mobile-native-chat-drafts.ts               |  30 +-
 mobile/src/session/use-mobile-native-chat-message-send.test.ts    |  46 +-
 mobile/src/session/use-mobile-native-chat-message-send.ts         |   6 +-
 8 files changed, 29 insertions(+), 656 deletions(-)
```

Baseline consequences:

- `mobile/src/session/mobile-native-chat-pending-retirement.ts` **does not exist** on main.
- The glued-pending bug the original PR fixed is **live on main right now**.
- `mobile/src/session/mobile-native-chat-pending-echo.ts` survives (the revert took 4 lines
  out of it) and has **no dedicated test file** — its pending-ordinal logic
  (`appendMobileNativeChatPending`, `expectedOccurrence` / `expectedImageEchoOrdinal`) is
  covered only indirectly through the `use-mobile-native-chat-*` tests.

A plain re-apply of `68ca17e46c` reintroduces the launch-blocking regression. See §6.

**Desktop/mobile asymmetry on main right now.** #14665 was explicitly "mobile half of
#14262". The desktop half is `aaa877d2a2` — *fix(native-chat): stop glued rapid sends from
pinning queued bubbles (#14663)* — and it was **not** reverted:

```
$ git log --oneline --grep="14262" v1.4.178..HEAD
68ca17e46c fix(mobile-native-chat): retire pending bubbles glued into one transcript row (mobile half of #14262) (#14665)
aaa877d2a2 fix(native-chat): stop glued rapid sends from pinning queued bubbles (#14663)
```

So main currently ships the desktop half of a paired fix with the mobile half backed out.
Desktop and mobile disagree about glued pending bubbles until the reland lands. The reland
should be checked for parity against `aaa877d2a2` rather than treated as mobile-only.

The original commit's own message shows it was already hardened three times before it was
reverted, which is a signal about how subtle this area is:

```
* fix(mobile-native-chat): harden glued pending retirement
* fix(mobile-native-chat): preserve pending image previews
* fix(mobile-native-chat): bound glue to loaded transcripts
```

### Area 4 — Workspace snapshot prune / tombstones

Files: `src/main/workspace-cleanup-scan-snapshot.ts` (10.9 KB),
`src/main/workspace-space-analysis-snapshot.ts` (10.8 KB),
`src/main/workspace-snapshot-prune-index.ts` (1.6 KB).

- **Unbounded-growth check (checklist 02): clean.** Both consumers hold a module-level
  `const prunedWorkspacesByFile = new Map<string, Map<string, WorkspaceSnapshotPruneTombstone>>()`
  (`workspace-cleanup-scan-snapshot.ts:28`, `workspace-space-analysis-snapshot.ts:26`).
  `workspace-snapshot-prune-index.ts` only ever inserts, but each consumer evicts via its own
  `clearSupersededPrunes`, which deletes superseded keys and drops the whole file entry when
  the inner map empties (`workspace-cleanup-scan-snapshot.ts:164-187`,
  `workspace-space-analysis-snapshot.ts:240-251`). No process-lifetime leak.
  **Any refactor must keep that eviction** — moving `clearSupersededPrunes` into the shared
  index without it would turn these into session-lifetime maps.
- **Coverage gap (P2):** `src/main/workspace-snapshot-prune-index.ts` has **no dedicated
  test file**. Its consumers are tested
  (`workspace-cleanup-scan-snapshot.test.ts`, `workspace-space-analysis-snapshot.test.ts`,
  `workspace-cleanup-removal-snapshot-prune.test.ts`), but the shared key/tombstone helpers
  are not directly. If this PR extends the index, that is where to add tests.
- The prune key is `` `${executionHostId ?? '*'}\0${worktreeId}` `` — the `'*'` wildcard for
  a missing host id means a host-less target keys differently from the same worktree with a
  host id. Worth a deliberate look if the PR changes host scoping.
