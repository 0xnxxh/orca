# WorktreeList half-size refactor plan

## Baseline and inventory

- Branch/worktree: `pure-extract-worktree-list`, clean at inspection.
- `WorktreeList.tsx`: **6,924 lines**.
- Structural split:
  - imports, exported/pure helpers, host header UI, drag row-model helpers: lines 1-1321 (~1,321)
  - `VirtualizedWorktreeViewport` and all viewport-owned behavior/rendering: lines 1322-5220 (~3,899)
  - `WorktreeList` outer store projection/actions/dialogs: lines 5221-6924 (~1,704)
- Direct component characterization coverage already exists in:
  - `WorktreeList.card-memo-stability.test.tsx`
  - `WorktreeList.lineage-agent-expansion-coupling.test.tsx`
  - `WorktreeList.lineage-child-card.test.ts`
  - `WorktreeList.lineage-child-real-card.test.tsx`
  - `WorktreeList.status-lane-lineage-drop.test.tsx`
- Exported helper coverage imports through `./WorktreeList` in `worktree-list-scroll-adjustment.test.ts`, `worktree-list-imported-rows.test.ts`, and `worktree-list-visible-refresh.test.ts`. Preserve those re-exports.

## Required cut

Extract the **entire virtualized viewport owner**, not isolated snippets of its state. The viewport is already a closed boundary: its state, refs, effects, event handlers, virtualizer, and row JSX are all below `VirtualizedWorktreeViewportProps`; the outer list only supplies props. After the extraction family, `WorktreeList.tsx` retains outer store selection/projection/actions plus public re-exports and should land around **2,800-3,150 lines**, safely below 3,420 even with import/type churn.

Do not move outer `WorktreeList` state into the viewport. Do not change prop identities, memoization, keys, effect dependencies, DOM attributes, event capture phase, or handler ordering.

## Destination module family (each hard-capped below 300 lines)

The estimates are source lines moved from `WorktreeList.tsx`; imports/types add headroom but every destination must be checked with `wc -l`.

| Module | Closed responsibility | Est. moved LOC |
|---|---|---:|
| `worktree-list-viewport-types.ts` | viewport props, row/drag state types, constants | 190 |
| `worktree-list-row-lookup.ts` | option IDs, mounted row lookup, render-row matching, reveal ancestor keys, active descendant selection | 250 |
| `worktree-list-drag-model.ts` | renderable rows, drag groups/indexes, preview equality/transform/status-target pure functions | 270 |
| `WorktreeListHostHeader.tsx` | host header metrics/health/detail and folder path status indicator | 195 |
| `use-worktree-viewport-reveal.ts` | reveal frame/highlight owner and pending worktree reveal effect | 285 |
| `use-worktree-viewport-row-reveal.ts` | pending arbitrary sidebar-row reveal effect | 185 |
| `use-worktree-viewport-header-drag.ts` | host/repo/project-group header maps, controllers, commits, active-row surface variant | 285 |
| `use-worktree-folder-path-statuses.ts` | folder/project-group path-status subscriptions, routing, refresh and cached getter | 170 |
| `use-worktree-viewport-virtualizer.ts` | keyed measurement guards, virtualizer construction, sticky indexes, anchor restoration, scroll suppression | 295 |
| `use-worktree-viewport-keyboard.ts` | cycling, global shortcut, listbox keyboard and scroll-input handlers | 145 |
| `use-worktree-viewport-drag-state.ts` | **whole drag state/ref owner**, cleanup, session refresh, drop computation APIs | 295 |
| `use-worktree-pointer-drag.ts` | pointer preview/autoscroll and captured pointer lifecycle, operating only through drag-state owner API | 295 |
| `use-worktree-native-drag.ts` | native drag/autoscroll/row drag/drop/document-drop lifecycle | 295 |
| `use-worktree-status-drop.ts` | pin/status drag UI handlers and document status-drop bridge | 190 |
| `use-worktree-visible-review-refresh.ts` | visible-row GitHub review refresh effect and visibility revision | 150 |
| `WorktreeListProjectHeader.tsx` | header shell, sticky/drag geometry and callbacks | 240 |
| `WorktreeListProjectHeaderMenus.tsx` | project/group menus and create/settings/visibility actions | 260 |
| `WorktreeListWorktreeRow.tsx` | normal and lineage card row presentation | 275 |
| `WorktreeListAuxiliaryRows.tsx` | lineage container, imported/inbox/pending/folder-workspace rows | 240 |
| `WorktreeListViewport.tsx` | memoized composition shell: invoke hooks, map virtual rows, render indicators/scroll-to-top | 260 |

Expected total removed from `WorktreeList.tsx`: **~3,900 lines**. Some helper moves above precede line 1322, but they belong exclusively to the viewport; expected final source size remains **~2,800-3,150**. If any destination approaches 300 after imports, split by the named responsibility before proceeding; never add a max-lines disable.

## Implementation order

1. Characterize public seams before moving code:
   - Add/extend a focused helper test for active-descendant preference across duplicate pinned rows and a pending row reveal ancestor case if these branches are not already asserted.
   - Keep all existing direct `WorktreeList` tests importing the default component.
2. Move viewport-only pure types/constants/functions first into `worktree-list-row-lookup.ts`, `worktree-list-drag-model.ts`, and `worktree-list-viewport-types.ts`. Re-export the existing named public API from `WorktreeList.tsx`: `countRecordKeysByReference`, `shouldAdjustWorktreeSidebarMeasuredRowScroll`, `resolvePendingSidebarReveal`, `renderRowContainsWorktree`, `getPinnedWorktreeRevealCollapsedGroupKeys`, `getRenderRowKey`, `getWorktreeDragGroups`, `canKeepImportedWorktreesHidden`, `getWorktreeDragIndexes`, `installWorktreeVisibleRefreshVisibilityListener`, plus the existing sidebar reveal exports.
3. Cut/paste the presentational branches into the four named row/header components. Pass computed values and existing callbacks; do not let presentation modules read the store except where the moved code already did so.
4. Extract the virtualizer, reveal, folder-status, keyboard, header-drag, and visible-review owners as hooks. Preserve every `useMemo`/`useCallback` dependency and why-comment verbatim.
5. Extract drag behavior last. `use-worktree-viewport-drag-state.ts` owns all current drag `useState`/`useRef` values and cleanup. Pointer/native/status hooks receive that owner's stable API; they must not create shadow state. Preserve pointer threshold, capture listeners, board-preview ordering, lineage eligibility, autoscroll frame cancellation, native/document-drop fallbacks, and expanded lineage ID semantics.
6. Compose the extracted hooks/components in `WorktreeListViewport.tsx` and replace the original ~3,899-line declaration with one import. Keep `React.memo`, `key={viewportResetKey}`, props, defaults, scroll-root lifecycle, listbox DOM, and virtualization keying unchanged.
7. Run formatting only after the move, then check every new production file is under 300 lines and `WorktreeList.tsx <= 3420`.

## Risk boundaries / reviewer rejection criteria

- **Hook order/state ownership:** reject any partial move that duplicates or conditionally calls viewport hooks. The whole viewport remains one memoized owner; composed hooks are called unconditionally in the same order.
- **Drag behavior:** highest risk. Reject rewritten algorithms, consolidated pointer/native branches, reordered document listeners, altered `preventDefault`/`stopPropagation`, or changed cleanup timing. Prefer literal moves with parameter plumbing.
- **Virtualization/reveal:** preserve row keys, callback identity, measurement suppression clocks, sticky header refs, retry count (8), frame cancellation, anchor recording, remount key, and DOM selectors/data attributes.
- **Memo stability:** `WorktreeCard` callback identities and lineage toggle cache must remain stable; the existing memo-stability and expansion/remount tests are mandatory.
- **Remote/folder/SSH:** keep `ExecutionHostId`, host section ordering, connection-scoped path-status routing, folder-workspace conversion, SSH generation refresh, and host filtering untouched. No local-path assumptions.
- **Public API:** default `WorktreeList` export and all current named exports stay available from `./WorktreeList`; tests and callers must not need import changes.
- **No cleanup drive-bys:** retain current copy, why-comments, duplicate-looking guards, and effect dependency lists unless typecheck proves a mechanical import/type adjustment is required.

## Verification gate

1. `wc -l src/renderer/src/components/sidebar/WorktreeList.tsx` (must be <=3420) and all new production modules (each <300).
2. Run all five direct WorktreeList suites listed above plus:
   - `worktree-list-scroll-adjustment.test.ts`
   - `worktree-list-imported-rows.test.ts`
   - `worktree-list-visible-refresh.test.ts`
   - relevant virtual-row, reveal, drag geometry/autoscroll/drop-preview, lineage-drag-drop, host/project-header drag tests.
3. `pnpm run typecheck:web`.
4. `pnpm run check:max-lines-ratchet`.
5. Review `git diff --word-diff=porcelain` module-by-module for move-only semantics, then commit only if green.

## Plan reviewer corrections

The original module estimates are rejected where literal source clusters exceed the cap. Implementation must preserve the existing hook/effect registration order with staged hooks, split pointer drag into preview resolution/autoscroll/document commit, split native drag autoscroll from handlers, and keep document effects separate from native handlers. Header rendering must split into shell/title, project-group actions, and repo actions; auxiliary rows must split folder-workspace rendering from lineage/imported/inbox/pending rows.

DOM lookup/reveal ancestry/active-descendant preference must be separate modules. The visibility-listener installer must live in its own module and remain re-exported from `WorktreeList`; drag state owns only complete refs/state/setters while cleanup, pointer, native, and document listener APIs remain staged to avoid dependency cycles. These corrections retain the viewport-sized cut but supersede any table estimate that would put a destination at or above 300 lines.
