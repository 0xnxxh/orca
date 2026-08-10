# #12532 reduced candidate — retained production file table

**Base:** `d0271cb46f` (#13611 geometry locked)  
**Archived broad tip:** `7c64936ce7` / docs `39d2585a90` on `archive/issue-12532-broad-66file-7c64936-20260810-122250`  
**Hard gate:** ≤45 total / ≤28 production

## Retention policy

- Bare IDs remain the default when the catalog has a **single** owner for that bare id (legacy `folder:folder-workspace-1` unchanged).
- Owner-qualified refs are used only when **same bare id appears on multiple owners**, or when the caller already supplies `ownerHostId`.
- Ambiguous bare mutate/delete/auth **fails closed**.
- No global rewrite of worktree IDs, tabs, palette, chat, dashboard cards, WorktreeCard/ContextMenu, or #13611 geometry.

## Retained production files

| # | File | Failing behavior without it | Why a narrower seam cannot absorb it |
| --- | --- | --- | --- |
| 1 | `src/shared/project-groups.ts` | Same bare `group.id` on local+SSH collapses into one row on normalize; subtree delete/update walks bare parent edges across hosts | Canonical owner identity + fail-closed `resolveProjectGroupOwner` must live in shared code used by store, IPC, auth |
| 2 | `src/shared/folder-workspaces.ts` | Same bare folder id dropped on normalize; row keys collide in multi-host catalogs | Catalog identity for folders is parallel to groups; must stay co-located with normalize |
| 3 | `src/shared/workspace-scope.ts` | No dual-read for `folder:folder-workspace-1` vs optional owner-qualified form; parse cannot recover owner segment | Session key codec is shared main↔renderer; dual-read helpers belong at the codec, not duplicated |
| 4 | `src/shared/types.ts` | `WorkspaceScope` cannot carry optional `ownerHostId` from parse | One-line additive field; no alternative without a parallel type |
| 5 | `src/shared/folder-workspace-path-status.ts` | Path-status requests cannot name owner → cross-owner cache/RPC mix | Request type is the IPC/renderer contract boundary |
| 6 | `src/renderer/src/store/slices/repos.ts` | `updateProjectGroup`/`deleteProjectGroup` map by bare id and replace/delete both hosts; folder delete purges wrong session; path-status routes by focus | Single store owns CRUD orchestration; IPC alone cannot fix optimistic local state |
| 7 | `src/renderer/src/store/slices/project-group-removal-targets.ts` | Contained-project removal enumerates bare subtree across hosts | Delete-with-projects path must use owner-scoped subtree before IPC |
| 8 | `src/main/ipc/repos.ts` | Main IPC drops optional `ownerHostId` → host store cannot disambiguate | Wire entry for project-group/folder selectors |
| 9 | `src/preload/api-types.ts` | Renderer types omit optional `ownerHostId` | Type contract for preload; additive only |
| 10 | `src/main/persistence.ts` | Host-local group update/delete by bare id mutates wrong row; session maps need dual-read/migrate for bare folder keys | Persistence is the durable store for groups/folders/sessions on this host |
| 11 | `src/main/ipc/filesystem-auth.ts` | Authorize uses bare group/folder membership → same-id remote folder can authorize local path (or fail open) | Security boundary must index by owner once per rebuild (linear) |
| 12 | `src/main/project-groups/folder-workspace-path-status.ts` | Path status resolves bare folder/group to wrong connection | Main path probe must fail-closed on ambiguous owner |
| 13 | `src/renderer/src/components/sidebar/worktree-list-groups.ts` | Same-id groups share collapse key `project-group:<id>`; folder rows share list keys | Row model is where collapse/render keys are minted; virtualizer host stamp alone does not fix collapse Set |
| 14 | `src/renderer/src/components/sidebar/project-group-sidebar-identity.ts` | Call sites reimplement owner resolve inconsistently | Thin shared index for sidebar owner lookup (kept small; avoids bloating WorktreeList) |
| 15 | `src/renderer/src/store/slices/worktrees.ts` | `setActiveFolderWorkspace` always used bare `folder:<id>` so same-id hosts share session maps; no dual-read migrate of `folder:folder-workspace-1` | Activation/session map ownership lives in worktrees slice; cannot dual-read tabs without this seam |

**Production count: 15** (≤28). WorktreeList left on base: collapse keys come from `worktree-list-groups`; store fail-closes bare ambiguous mutate; optional `ownerHostId` on APIs covers explicit callers/tests.

## Explicitly dropped vs broad 38-file tip (and why)

| Dropped | Reason |
| --- | --- |
| WorktreeCard / WorktreeContextMenu | Store fail-closed + optional owner covers delete; card can keep bare id when unambiguous |
| dashboard-snapshot-workspaces | Dual-read in session codec/store activation; dashboard not required for issue #12532 same-id group headers |
| worktrees.ts bulk dual-read | Prefer bare session keys when unambiguous; avoid global session routing rewrite |
| folder-workspace-session-owner, workspace-session-host-persistence, worktree-runtime-owner | Cascade from always-qualified keys; not needed if default stays bare |
| folder-workspace-worktree | Keep bare synthetic `folder:<id>` when unambiguous |
| folder-workspace-connection, composer helpers/path-status | Not required for adversarial same-id group/folder CRUD |
| project-group-header-drag/drop/contract, move-targets, header-section-boundaries, folder-reveal, host-filtering, rendered-order, virtual-rows | Geometry/drag cascade; #13611 host stamp already unique for virtualizer; drag can follow store owner later if proven |
| ui.ts draft owner field | Optional convenience; not required for fail-closed CRUD |
| repos-runtime-routing-fixture | Test-only support (count under tests if reintroduced) |

## Test budget (focused only)

Same-id / fail-closed / dual-read / auth-index / path-status / owner update-delete / normalize — prefer **≤20** test files, no mass expectation rewrites of sticky geometry or bare-key consumers.
