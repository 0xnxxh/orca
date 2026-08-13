# SourceControl half-size refactor plan

## Baseline and hard budget

- Branch/worktree: `pure-extract-source-control` in the requested primary working directory; initial `git status --short` is clean.
- `SourceControl.tsx`: 8,344 lines. Required final size: **4,150 lines or fewer**, so the implementation needs at least **4,194 net lines removed** after replacement imports, re-exports, hook calls, and component invocations.
- The file starts with an existing `/* eslint-disable max-lines */`. Remove it as part of the refactor; do not copy it or add any max-lines disable/budget increase.
- Every new destination below must finish below 300 physical lines including imports, types, and comments. Do not grow already-over-cap adjacent files such as `source-control-header-toolbar.tsx`; create focused modules instead.
- Preserve the default `SourceControl` export and every current named export from `SourceControl.tsx` with explicit re-exports. Existing tests import `CommitArea`, `ActionButton`, `TooManyChangesBanner`, compare/base-ref functions, draft functions, remote-refresh functions, and AI prompt exports through this public module.

## Inventory

The first 301 lines are imports. Module-level helpers/types/constants occupy lines 352-798. `SourceControlInner` occupies lines 799-6,499, and the trailing exported/presentational cluster occupies lines 6,503-8,344.

### Module-level closed clusters (lines 352-798, about 447 gross lines)

| Current lines | Cluster | Dependencies / risk |
| --- | --- | --- |
| 352-498 | Base-ref resolution and stale-SHA repair | Pure; provider-neutral review metadata and remote ref syntax must be copied exactly. Already well covered by `SourceControl.compare-summary.test.ts`. |
| 499-558 | Icons, section labels, display constants, default collapsed sections | Move constants with their sole visual consumer rather than creating a generic constants module. Keep translated keys and tree spacing byte-for-byte. |
| 559-627 | Copy-feedback timer and editor-reveal frame lifecycle | Two small lifecycle adapters. Preserve unmount cleanup and `requestAnimationFrame` cancellation. |
| 628-706 | Commit-draft types/read/write, view-mode normalization, tree directory action paths | Pure except session persistence callers. Draft and normalization behavior already have direct tests. |
| 707-798 | Commit-area gate, default agent, remote error/refresh reconciliation | Pure or dependency-injected async adapter; preserve the three post-remote refresh calls and error swallowing contract. |

### `SourceControlInner` state/behavior clusters

| Current lines | Cluster | Notes |
| --- | --- | --- |
| 800-1,212 | Store selection plus Notes, view, commit, remote, generation, hosted-review, and history state owners | Do not wholesale-extract this mixed block. Move each state owner only together with all of its setters, cleanup, and async completion paths. |
| 1,255-1,462 | Branch-line request gate, status refresh, huge-repo probe, generation status refresh, repo default base-ref load | Narrow hooks are possible; runtime settings and connection ID must continue to route to the repo owner host. |
| 1,463-1,778 | Hosted-review/provider/base derivation and review polling | High-coupling area. Leave in `SourceControlInner` in the primary plan. It spans GitHub/GitLab/Bitbucket/Azure/Gitea/manual review state and SSH loading exceptions. |
| 1,779-1,913 | Group/filter/tree/list/selection projections | Memo-only, closed projection hook; safe to extract without moving selection ownership. |
| 1,914-2,081 | Bulk flag, conflict/recovery derivation, stale-worktree pruning, worktree-switch reconciliation | Split cleanup by the owner it cleans; do not leave a state owner in one module and its prune/reset effects in another. |
| 2,082-2,432 | Commit and commit-message generation | Coupled to Create Review intent and generation records. Keep in the primary pass; use only as fallback after moving the entire per-worktree owner and hydration lifecycle. |
| 2,433-2,721 | Remote actions and conflict abort | Viable fallback only if remote error state, sequence refs, completion reconciliation, and pruning move together. Preserve SSH/provider-neutral runtime routing. |
| 2,722-4,237 | Hosted-review field generation, creation, and Create Review intent transaction | Do not split in the primary pass. Tokens snapshot repo owner host, branch, push target, and worktree; partial extraction risks cross-worktree completion and mixed-version behavior. |
| 4,238-4,474 | Primary/dropdown action derivation and dispatch | Action-model derivation is a closed memo hook. Keep dispatcher callbacks in the parent unless an entire action controller remains under 300 lines. |
| 4,474-4,835 | Split/file opening, active-row projection, selection/bulk operations, primary dispatch | Extract narrow row-opening and bulk-action hooks. Preserve platform modifier handling through existing helpers; do not hardcode Meta. |
| 4,856-5,143 | Branch compare and Git history runners/effects plus upstream refresh | Extract two complete state owners. Keep compare request coalescing, visible-window polling, owner-host routing, stale request IDs, and history lazy loading. |
| 5,168-5,571 | Committed/note opening and stage/unstage/discard flows | Extract row-opening and mutation/confirmation hooks. Preserve autosave quiesce, editor reload notifications, old-relay bulk fallback, and conflict discard exclusions. |
| 5,581-6,497 | Render tree | Split presentational shelves, action surface, sections, and dialogs; leave only orchestration-level composition in `SourceControlInner`. |

### Trailing presentational/exported clusters (lines 6,503-8,344, about 1,842 gross lines)

- Commit shortcut and `CommitArea` (6,503-7,005): split composer, split action menu, notices, and the small coordinator so no file crosses 300 lines.
- Compare refresh snapshots/predicates and compare cards (7,006-7,235).
- Section header and inline Notes list (7,236-7,486).
- Conflict/operation cards (7,487-7,630).
- Too-many-changes retry banner (7,631-7,718), including abort/timeout lifecycle.
- Directory/tree chrome and submodule placeholder (7,719-7,924).
- Uncommitted row and conflict badge (7,925-8,204); keep these separate because the row plus imports would otherwise exceed 300.
- Branch row, empty state, and `ActionButton` (8,205-8,344).

## Required characterization before cuts

The current suite is strong for exported components, base resolution, preview/split behavior, open-row highlighting, virtualization, commit drafts/generation records, branch-line gating, recovery, and provider-neutral hosted-review links. Add only focused gaps before moving owners:

1. Add a rendered Notes-shelf characterization using the existing `SourceControl` store harness: expand/collapse, copy-all, per-file open/delete handoff, and clear confirmation. This protects the timer/reveal and presentational split.
2. Add a branch-compare runner test for single-flight plus one trailing refresh when multiple triggers arrive during an in-flight request. Existing tests cover trigger predicates and the 30-second constant, not coalescing.
3. Add a Git-history owner test for visibility/collapsed gating and stale completion after a worktree switch. Keep connection/runtime settings in the assertion to protect SSH/repo-owner routing.
4. Add bulk mutation characterization for success clearing selection and failure retaining it, with connection ID/runtime owner settings forwarded.
5. If the discard controller is moved, characterize notification ordering: save quiesce -> runtime discard/bulk fallback -> external-file notification -> status refresh, including folder/non-git gating already rendered by `SourceControl`.

Do not rewrite existing tests to import the new leaf modules. Their imports through `./SourceControl` are an intentional public-API compatibility gate.

## Ordered extraction plan and line budget

The estimates below are **net reductions in `SourceControl.tsx`**, not merely moved gross lines. Together they target about 4,400 net lines, leaving an expected 3,900-4,050 lines and enough margin for imports/re-exports.

### 1. Extract public pure contracts and lifecycle adapters (about 340 net lines)

- `source-control-base-ref-resolution.ts`: lines 352-498 and the public base/picker/clear functions.
- `source-control-commit-drafts.ts`: draft type/read/write and view-mode normalization only if needed by the same tests; otherwise place view-mode in `source-control-view-mode.ts`.
- `source-control-directory-action-paths.ts`: the two directory node aliases and action-path collector.
- `source-control-copy-feedback.ts`: complete timer owner.
- `source-control-editor-reveal-frames.ts`: request/cancel frame pair.
- `source-control-remote-refresh.ts`: remote error resolution, post-action refresh, and completed-conflict error reconciliation.
- Move icons/labels/spacing constants into their actual consumer modules in later steps, not a vague constants file.
- Re-export current named symbols from `SourceControl.tsx` immediately so every existing direct-import test continues to compile after each cut.

### 2. Remove the entire trailing UI cluster (about 1,800 net lines)

Create the following focused files, splitting sooner if imports push one near 300:

- `source-control-commit-shortcut.ts`
- `source-control-commit-area.tsx` (coordinator only)
- `source-control-commit-message-composer.tsx`
- `source-control-commit-action-menu.tsx`
- `source-control-commit-notices.tsx`
- `source-control-compare-summary.tsx`
- `source-control-section-header.tsx`
- `source-control-diff-comments-list.tsx`
- `source-control-conflict-status-cards.tsx`
- `source-control-too-many-changes-banner.tsx`
- `source-control-tree-directory-rows.tsx`
- `source-control-submodule-placeholder-row.tsx`
- `source-control-uncommitted-entry-row.tsx`
- `source-control-conflict-badge.tsx`
- `source-control-branch-entry-row.tsx`
- `source-control-empty-state.tsx`
- `source-control-action-button.tsx`

This is primarily cut/paste. Preserve memoization on `UncommittedEntryRow`, translated IDs, DOM/ARIA structure, CSS classes, tooltip provider placement, timeout constants, and component names. `SourceControl.tsx` remains a facade for all previously exported components/functions.

### 3. Split render-only composition (about 600 net lines)

- `source-control-notes-shelf.tsx`: lines 5,615-5,750, receiving callbacks and state; it must not start owning store mutations.
- `source-control-action-surface.tsx`: fork-push label plus `CreateHostedReviewComposer`/`CommitArea` choice (5,826-5,938). Pass the existing resolved values and callbacks; do not re-resolve provider eligibility here.
- Split lines 5,939-6,198 into `source-control-uncommitted-sections.tsx`, `source-control-section-actions.tsx`, and `source-control-section-file-list.tsx`; one monolithic section component would exceed 300 lines. Keep filtered action suppression and touch/SSH forced-visibility classes unchanged.
- `source-control-branch-section.tsx`: lines 6,212-6,295.
- `source-control-clear-notes-dialog.tsx`, `source-control-base-ref-dialog.tsx`, `source-control-resolve-conflicts-dialog.tsx`, and `source-control-generation-dialogs.tsx`: lines 6,327-6,495. Keep mutation/state ownership in the parent; these are controlled presentational components.
- Leave conflict/huge-repo/history placement and the shared scroll container in `SourceControlInner`; their sticky/virtualization relationship is layout-sensitive.

### 4. Extract closed projections and action model (about 280 net lines)

- `use-source-control-file-projection.ts`: all memos from grouped entries through visible selection entries (1,779-1,913). Input existing entries/filter/view/collapse/submodule state; return the exact maps/rows currently consumed.
- `use-source-control-action-model.ts`: primary action, Create Review header action, and dropdown derivation (4,238-4,420). Return data only. Keep `handleActionInvoke`, primary click, and Create Review execution in the parent so this cut cannot change side effects.
- Avoid a giant context/options bag that recomputes identity-sensitive values. Preserve every `useMemo` dependency and stable empty sentinel.

### 5. Extract complete status/base and compare/history owners (about 720 net lines)

- `use-source-control-status-refresh.ts`: `refreshActiveGitStatus`, post-mutation wrapper, huge-repo warning probe, and PR-generation status refresh. The hook receives repo-owner settings and current push target; it must continue resolving connection IDs per target worktree.
- `use-source-control-base-ref-default.ts`: move the `defaultBaseRef` state, reset/load effect, and stale guard together. Dependency keys remain repo connection ID, execution host ID, repo ID, runtime environment ID, visibility, and folder mode.
- `use-source-control-branch-line-total-request.ts`: own the gate effect and cleanup; no persisted state.
- `source-control-branch-compare-refresh.ts`: snapshot types and public trigger predicates.
- `source-control-branch-compare-runner.ts`: small single-flight/trailing-run scheduler so `use-source-control-branch-compare.ts` stays under 300 lines.
- `use-source-control-branch-compare.ts`: own all compare refs, request execution, HEAD/upstream triggers, interval, and missing-base clear effect. Continue using `getRuntimeGitBranchCompare` with `activeRepoSettings`; preserve summary during same-base polling.
- `use-source-control-git-history.ts`: move `gitHistoryByWorktree`, sequence/request refs, stale-worktree pruning for this state, refresh callback/ref, and lazy visibility/base effects together. Return state and refresh. Keep `useGitHistoryCommitActions` outside unless the combined file remains below 300.
- Keep upstream-status fetch as a narrow effect in the compare hook or a dedicated `use-source-control-upstream-refresh.ts`; never derive execution host from the focused pane.

### 6. Extract opening, bulk, and discard controllers (about 650 net lines)

- `use-source-control-row-opening.ts`: own pending reveal frame refs and cleanup plus split-target resolution, uncommitted opening, and committed opening. Preserve preview/permanent conversion and `navigator.userAgent`-based platform handling through existing helpers.
- `use-source-control-note-opening.ts`: lines 5,199-5,286. Route notes to unstaged, branch compare, or plain editor exactly as today and set `scrollToDiffCommentId` before reveal.
- `use-source-control-bulk-actions.ts`: move `isExecutingBulk` state and all bulk/stage-all/unstage callbacks together. It consumes selection from `useSourceControlSelection`; success/failure selection behavior stays unchanged.
- `use-source-control-entry-mutations.ts`: stage, unstage, and low-level single discard (5,287-5,413).
- `use-source-control-discard-confirmation.ts`: move `pendingDiscard` state and every path that sets/clears it, including discard-many, discard-all, request, and confirm (5,414-5,571). Keep the existing `discard-all-sequence.ts` fallback for older SSH relays and retain conflict exclusions.

At this checkpoint run `wc -l`. Expected size is about 3,900-4,050 lines. Stop extracting once the file is at or below 4,150 and all checks pass; do not disturb hosted-review/Create Review orchestration merely to make the file smaller.

### 7. One bounded fallback if estimates miss (250-400 net lines)

Use only one of these, in order, and still move the whole owner:

1. Split `use-source-control-conflict-abort.ts` from lines 2,622-2,721 and `use-source-control-remote-actions.ts` from 2,433-2,621, moving remote-error maps, sequence refs, completion reconciliation, and prune/reset effects with them.
2. If remote action ownership cannot stay below 300 per file, extract commit-message generation as `use-source-control-commit-generation.ts`, but move its per-worktree in-flight/error state, generation store hydration, cancellation, pruning, and Create Review intent adapter as a single owner split across domain-specific submodules.

Do not use the 2,722-4,237 Create Review transaction as the fallback. That area carries the highest host-switch/provider risk.

## Dependency and compatibility gates

- **SSH / owner host:** every runtime Git/repo call must retain `activeRepoSettings` or the request-snapshotted runtime settings and target worktree connection ID. Never substitute the focused runtime.
- **Folder workspaces:** keep the early folder-repo return and all `isFolder` guards. Extracted hooks must no-op before shelling out.
- **Cross-platform:** keep split-open helpers and `getScreenSubmitModifierLabel`/`isScreenSubmitShortcut`; no direct `event.metaKey` logic.
- **Remote wire / mixed versions:** this is renderer-only organization. Do not change runtime/RPC params, result shapes, opcodes, or host-published content. Preserve old-relay discard fallback.
- **Providers:** keep generic hosted-review names and explicit provider checks. Do not rename generic review concepts to PR/GitHub or collapse GitLab/other-provider links into GitHub cache behavior.
- **React identity:** copy dependency arrays and refs exactly first. Do not replace stable store selectors with inline arrays/objects, and do not turn event-owned refs into render state.
- **Layout:** preserve shared scroll element, sticky history position, virtual-list keys, memoized uncommitted row, and selection key namespaces.

## Review gates after each batch

1. `git diff --word-diff=porcelain` or side-by-side review must show moved bodies unchanged except imports/exports/types and unavoidable prop plumbing.
2. Search for lost why-comments and forbidden disables: `rg -n "Why:|eslint-disable max-lines|oxlint-disable max-lines"` in all touched files. Every existing why-comment moves with its behavior; final touched files contain no max-lines disable.
3. Check every new production file: `wc -l ...`; each must be below 300 before proceeding.
4. Re-run the smallest direct-import tests after moving public exports, then rendered `SourceControl` tests after hook/render cuts.
5. Verify no runtime-git signature, wire type, provider dispatch, translated string/ID, class string, or ARIA label changed.

## Final validation

- Focused unit tests: run all `src/renderer/src/components/right-sidebar/SourceControl*.test.*`, `CommitArea*.test.tsx`, `ActionButton.test.tsx`, and `source-control-too-many-changes-banner.test.tsx`, plus the new characterization tests. Include adjacent extracted-module tests if names no longer match those globs.
- `pnpm run typecheck:web`
- `pnpm run check:max-lines-ratchet`
- `wc -l src/renderer/src/components/right-sidebar/SourceControl.tsx` and all new production modules. Hard fail if `SourceControl.tsx` is above 4,150 or any new destination is 300+.
- `git diff --check` and `git status --short`.
- Ignore only the explicitly allowed unrelated `node-pty`/daemon/runtime/relay baseline failures; any SourceControl-focused failure or `typecheck:web` failure is a hard stop.
- When green, commit locally as `refactor(source-control): extract modules to half SourceControl.tsx` and report before/after LOC, focused tests, typecheck, max-lines ratchet, commit hash, and “No intentional behavior change.”

## Plan reviewer verdict

**REJECTED pending the corrections below.** The overall seams are credible and the trailing UI plus controller cuts can reach the hard target, but the current plan contains one lint-invalid instruction, one unnecessary scheduler rewrite, and incomplete state-owner boundaries.

Required corrections:

1. **Retain the existing first-line `max-lines` suppression on `SourceControl.tsx`.** The task forbids adding a suppression; it does not authorize removing this grandfathered one while the target file remains roughly 4,150 lines. Removing it makes oxlint fail the 300-line rule and makes `check:max-lines-ratchet` fail on the stale `config/max-lines-baseline.txt` entry. Do not add or copy a suppression to any destination file.
2. **Move the branch-compare scheduler literally, without introducing `source-control-branch-compare-runner.ts`.** The current refs, recursive trailing refresh, promise identity cleanup, and why-comment fit inside a sub-300-line compare hook once history/upstream code is separated. Recasting them as a new scheduler is a logic rewrite and violates the move-only gate. Keep the characterization test, but preserve the existing algorithm byte-for-byte apart from imports and hook plumbing.
3. **Finish every moved state owner, including reset/prune effects.** `use-source-control-bulk-actions.ts` must own the `activeWorktreeId` reset of `isExecutingBulk`; `use-source-control-discard-confirmation.ts` must own the worktree-switch reset of `pendingDiscard`; `use-source-control-git-history.ts` must own both history state and request-ref pruning. Remove those lines from the parent's combined reset/prune effects only after their owners move. The fallback remote controller likewise must own `remoteActionErrors`, its sequence refs, previous-conflict reconciliation, and worktree pruning as one boundary.
4. **Treat the fallback as expected capacity, not an optional afterthought.** The primary steps have only a narrow line-budget margin after hook option/return types, imports, facade re-exports, and component props. Run `wc -l` after the trailing UI and render/projection batches; if projected final size is not safely below 4,150, perform the complete remote-action + conflict-abort fallback before polishing. Do not compensate by partially cutting Create Review or commit-generation ownership.
5. **Split `CommitArea` by exact render-only seams.** Keep all derivation (`rows`, spinner flags, failure summaries, disabled state, `describedBy`, generation tooltip, and dropdown content inputs) in the coordinator, and extract only composer, split-action control, and notices as controlled presentational children. Preserve DOM nesting, IDs/ARIA relationships, Radix tooltip/dropdown placement, translations, and shortcut behavior. This avoids redistributing behavior merely to satisfy the per-file cap.

With these corrections, the plan is approved for implementation: the selected trailing components, render shelves, projections, complete compare/history owners, and complete mutation controllers provide sufficient gross volume, and the bounded remote fallback supplies the necessary safety margin without entering the high-risk Create Review transaction.

## Incorporated implementation corrections

- Retain only the pre-existing `SourceControl.tsx` max-lines suppression; add none elsewhere.
- Preserve the branch-compare coalescing algorithm literally inside its extracted hook.
- Move bulk, discard, history, and any remote-action reset/prune effects with their complete owners.
- Use the complete remote-action/conflict-abort extraction as planned capacity when the measured margin requires it.
- Keep `CommitArea` derivation in its coordinator and extract controlled render-only seams.
