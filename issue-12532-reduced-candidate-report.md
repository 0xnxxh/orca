# #12532 correction review

## Verdict

**NOT CLEAN.** The reviewed candidate `d9d80e705f9bff0722eac14488135ee04c30641f` modified immutable #13611 geometry. The illegal change and its dependent test are reverted locally for another fresh review; PR #13599 was not pushed or retargeted.

## Gate

| Metric      | Limit | Actual |
| ----------- | ----- | ------ |
| Total files | ≤45   | **26** |
| Production  | ≤28   | **13** |
| Tests       | —     | **11** |
| Docs        | —     | **2**  |

## SHAs

| Role                  | SHA                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| Base (#13611)         | `d0271cb46f2871c201f39c51e35356efd4658eac`                                                     |
| Reviewed candidate    | `d9d80e705f9bff0722eac14488135ee04c30641f`                                                     |
| Candidate code commit | `253f8c3f9e48dfec505d7ec96e104f099cf365a1`                                                     |
| Archived broad tip    | `7c64936ce7` / docs `39d2585a90` on `archive/issue-12532-broad-66file-7c64936-20260810-122250` |

## Findings fixed

- Restored byte identity for `worktree-list-virtual-rows.ts`, `host-section-rows.ts`, and `WorktreeList.tsx` against #13611 SHA `d0271cb46f2871c201f39c51e35356efd4658eac`.
- Retained owner-qualified folder row keys only when the same bare folder ID exists across owners; unambiguous rows keep `folder-workspace:<id>`.
- Removed owner-qualified folder identity propagation from `WorkspaceScope`, worktree/tab/session maps, active workspace IDs, and editor/file routing. Unambiguous folder activation keeps `folder:folder-workspace-1`; same-id ambiguity fails closed.
- Added optional owner selectors only at folder CRUD and path-status preload/IPC/persistence seams. Legacy unambiguous calls keep their prior payload shape, while ambiguous mutations require an exact owner.
- Made persistence folder lookup/update/delete and folder path-status selection fail closed on bare same-id ambiguity without purging a surviving sibling's shared bare session state.
- Scoped project-group removal, move, path auth, and sidebar row/collapse identity by owner without changing unrelated repo/worktree IDs or #13611 header geometry.
- Replaced quadratic filesystem-auth subtree materialization with a linear owner-indexed aggregation plus sorted path indexes; cycles fail closed and a 4,096-level adversarial chain remains bounded.
- Removed the sidebar's per-row full catalog scan by precomputing ambiguous group IDs.
- Corrected owner-qualified folder path-status cache eviction to use the same canonical identity codec as cache creation.

## Deferred finding

Runtime-stamped folder rows can split from runtime project-group headers in the all-host section view. The frozen `host-section-rows.ts` assigns folder rows from `connectionId` plus one global default and cannot observe runtime owner stamps; fixing that behavior requires a dependency-owned geometry change, so this candidate does not expand scope around it.

## Validation

- Node `v24.18.0` focused identity/sidebar/host matrix: **784 passed** across **14 files**.
- Node `v24.18.0` node/CLI/web typechecks: pass.
- Full lint, native/type-aware quality, reliability (73 gates), max-lines, skill, and localization gates: pass; baseline oxlint reported only pre-existing `WorktreeJumpPalette` hook warnings.
- Changed-code quality, type-aware quality, and React Doctor: 0 new findings across 24 changed source files.
- `oxfmt --check` on all 26 changed files and `git diff --check`: pass.
- Focused filesystem-auth and path-status performance gates: **20 passed** across **2 files**, including the 4,096-level adversarial hierarchy and 12,208-group cache fixture.
- #13611 `worktree-list-virtual-rows`, `host-section-rows`, and `WorktreeList` geometry: byte-identical to `d0271cb46f2871c201f39c51e35356efd4658eac`.

## Remaining work

Another independent reviewer must review the fixed local commit. Because this review found an actionable scope defect, do not push or retarget PR #13599 yet; the runtime folder/header split remains dependency-owned, and Electron QA was intentionally not performed.
