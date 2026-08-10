# #12532 reduced candidate — retained production file table

**Base:** `d0271cb46f` (#13611 dependency; branch never modified)
**Archived broad tip:** `7c64936ce7` / docs `39d2585a90` on `archive/issue-12532-broad-66file-7c64936-20260810-122250`
**Hard gate:** ≤45 total / ≤28 production

## Retention policy

- Bare IDs remain the default when the catalog has a **single** owner for that bare id (legacy `folder:folder-workspace-1` unchanged).
- Owner-qualified refs are used only when **same bare id appears on multiple owners**, or when the caller already supplies `ownerHostId`.
- Ambiguous bare mutate/delete/auth **fails closed**.
- No global rewrite of worktree IDs, tabs, palette, chat, or dashboard cards.

## Retained production files

| #   | File                                                                    | Failing behavior without it                                                                                                       | Why a narrower seam cannot absorb it                                                                                |
| --- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/shared/project-groups.ts`                                          | Same bare `group.id` on local+SSH collapses into one row on normalize; subtree delete/update walks bare parent edges across hosts | Canonical owner identity + fail-closed `resolveProjectGroupOwner` must live in shared code used by store, IPC, auth |
| 2   | `src/shared/folder-workspaces.ts`                                       | Same bare folder id dropped on normalize; row keys collide in multi-host catalogs                                                 | Catalog identity for folders is parallel to groups; must stay co-located with normalize                             |
| 3   | `src/shared/folder-workspace-path-status.ts`                            | Path-status requests cannot name owner → cross-owner cache/RPC mix                                                                | Request type is the IPC/renderer contract boundary                                                                  |
| 4   | `src/renderer/src/store/slices/repos.ts`                                | Group/folder CRUD and path status can select or purge the wrong owner                                                             | Single store owns routing and optimistic catalog state                                                              |
| 5   | `src/renderer/src/store/slices/project-group-removal-targets.ts`        | Contained-project removal enumerates bare subtree across hosts                                                                    | Delete-with-projects needs the selected owner subtree before IPC                                                    |
| 6   | `src/main/ipc/repos.ts`                                                 | Main IPC drops optional `ownerHostId`                                                                                             | Wire entry for group/folder selectors                                                                               |
| 7   | `src/preload/api-types.ts`                                              | Renderer types omit optional `ownerHostId`                                                                                        | Additive preload contract boundary                                                                                  |
| 8   | `src/main/persistence.ts`                                               | Host-local group/folder CRUD mutates the first bare-id row                                                                        | Durable owner-aware mutation boundary                                                                               |
| 9   | `src/main/ipc/filesystem-auth.ts`                                       | Same-id remote folders can authorize local paths                                                                                  | Security boundary uses precomputed owner indexes                                                                    |
| 10  | `src/main/project-groups/folder-workspace-path-status.ts`               | Path status resolves bare folder/group to the wrong connection                                                                    | Main path probe must fail closed on ambiguity                                                                       |
| 11  | `src/renderer/src/components/sidebar/worktree-list-groups.ts`           | Same-id groups share render and collapse keys                                                                                     | Row model mints both identities                                                                                     |
| 12  | `src/renderer/src/components/sidebar/project-group-sidebar-identity.ts` | Sidebar callers otherwise resolve owners inconsistently                                                                           | One precomputed sidebar lookup index                                                                                |
| 13  | `src/renderer/src/store/slices/worktrees.ts`                            | Bare same-id folder activation selects one owner while tabs still share `folder:<id>`                                             | A bounded guard fails closed without changing workspace/tab identity                                                |
| 14  | `src/renderer/src/components/sidebar/WorktreeList.tsx`                  | Rendered owner-qualified headers still send bare mutations and composer targets                                                   | Interaction handlers must carry the owner selected by the row                                                       |
| 15  | `src/renderer/src/components/sidebar/worktree-list-virtual-rows.ts`     | Folder rows discard owner-qualified keys, causing virtual DOM reuse                                                               | TanStack row keys are minted at this boundary                                                                       |
| 16  | `src/renderer/src/components/sidebar/host-section-rows.ts`              | Runtime folders route from connection/default host instead of their runtime stamp                                                 | Host-section assignment owns this projection                                                                        |
| 17  | `src/renderer/src/components/sidebar/worktree-list-host-filtering.ts`   | Runtime path status and filter rebuilds can route the wrong owner                                                                 | Shared filter/path-status routing must use one host resolver                                                        |
| 18  | `src/renderer/src/components/sidebar/WorktreeContextMenu.tsx`           | Move/create/remove actions expose foreign-owner groups and send bare selectors                                                    | The context menu independently owns these action call sites                                                         |
| 19  | `src/renderer/src/lib/new-workspace-project-options.ts`                 | Duplicate group IDs produce duplicate composer values and first-owner selection                                                   | Option identity and parsing live here                                                                               |
| 20  | `src/renderer/src/hooks/useComposerState.ts`                            | Selection immediately loses the option owner                                                                                      | Composer state must retain owner through selection and creation                                                     |
| 21  | `src/renderer/src/components/NewWorkspaceComposerModal.tsx`             | Sidebar initial-group owner is dropped at the modal boundary                                                                      | Modal data is the launch contract                                                                                   |

**Production count: 21** (≤28). Changes to dependency-origin files are narrow and remain only on this stacked candidate branch.

## Explicitly dropped vs broad 38-file tip (and why)

| Dropped                                                                                          | Reason                                                                                                  |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| WorktreeCard                                                                                     | Card workspace identity can keep bare id when unambiguous                                               |
| dashboard-snapshot-workspaces                                                                    | Dashboard identity is unrelated to project-group catalog ownership                                      |
| worktrees.ts bulk dual-read                                                                      | Prefer bare session keys when unambiguous; avoid global session routing rewrite                         |
| folder-workspace-session-owner, workspace-session-host-persistence, worktree-runtime-owner       | Cascade from always-qualified keys; not needed if default stays bare                                    |
| folder-workspace-worktree                                                                        | Keep bare synthetic `folder:<id>` when unambiguous                                                      |
| folder-workspace-connection, composer helpers/path-status                                        | Not required for adversarial same-id group/folder CRUD                                                  |
| project-group-header-drag/drop/contract, move-targets, header-section-boundaries, rendered-order | Existing contracts remain bare internally; the rendered-view gate guarantees one owner before drag      |
| ui.ts draft owner field                                                                          | Legacy drafts fail closed only for ambiguity; transient sidebar launches carry owner through modal data |
| repos-runtime-routing-fixture                                                                    | Test-only support (count under tests if reintroduced)                                                   |

## Test budget (focused only)

Same-id / fail-closed / auth-index / path-status / owner update-delete / normalize — no mass expectation rewrites of sticky geometry or bare-key consumers.
