# #12532 reduced candidate final review

## Verdict

**NOT CLEAN.** The reviewed candidate `d83f9aae932c2d0eddd46e70cfd03e0cb78ac1fa` contained correctness, scope, and bounded-performance defects. Issue-scoped fixes are committed locally for another fresh review; PR #13599 was not pushed or retargeted.

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
| Reviewed candidate    | `d83f9aae932c2d0eddd46e70cfd03e0cb78ac1fa`                                                     |
| Candidate code commit | `253f8c3f9e48dfec505d7ec96e104f099cf365a1`                                                     |
| Archived broad tip    | `7c64936ce7` / docs `39d2585a90` on `archive/issue-12532-broad-66file-7c64936-20260810-122250` |

## Findings fixed

- Removed owner-qualified folder identity propagation from `WorkspaceScope`, worktree/tab/session maps, active workspace IDs, and editor/file routing. Unambiguous folder activation keeps `folder:folder-workspace-1`; same-id ambiguity fails closed.
- Added optional owner selectors only at folder CRUD and path-status preload/IPC/persistence seams. Legacy unambiguous calls keep their prior payload shape, while ambiguous mutations require an exact owner.
- Made persistence folder lookup/update/delete and folder path-status selection fail closed on bare same-id ambiguity without purging a surviving sibling's shared bare session state.
- Scoped project-group removal, move, path auth, and sidebar row/collapse identity by owner without changing unrelated repo/worktree IDs or #13611 header geometry.
- Replaced quadratic filesystem-auth subtree materialization with a linear owner-indexed aggregation plus sorted path indexes; cycles fail closed and a 4,096-level adversarial chain remains bounded.
- Removed the sidebar's per-row full catalog scan by precomputing ambiguous group IDs.
- Corrected owner-qualified folder path-status cache eviction to use the same canonical identity codec as cache creation.

## Validation

- Focused identity, CRUD, path-status, auth, persistence, activity/session, dashboard, and legacy suites: **866 passed** across **23 unique files**; the corrected owner-cache fixture was rerun separately (**5 passed**).
- Node `v24.19.0` node/CLI/web typechecks: pass.
- Changed-code quality: 0 findings; max-lines ratchet and reliability gates: pass.
- `git diff --check` and formatting: pass.
- Filesystem-auth adversarial 4,096-level chain and cycle fixtures: pass.
- #13611 `worktree-list-virtual-rows`, `host-section-rows`, and `WorktreeList` geometry: byte-identical to `d0271cb46f2871c201f39c51e35356efd4658eac`.

## Remaining work

Another independent reviewer must review the fixed local commit. Because this review found actionable defects, do not push or retarget PR #13599 yet; Electron and SSH multi-host QA remain post-review/post-push work.
