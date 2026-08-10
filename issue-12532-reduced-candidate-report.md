# #12532 independent correction review

## Verdict

**NOT CLEAN.** Exact candidate `bc1714b6f0f29df377ae59181b8fdac8d13ed153` did not fully fix the reported duplicate/overlapping header and blocked-click behavior. The defects are fixed and committed locally; PR #13599 was not pushed or retargeted, PR #13611 was not modified, and Electron QA remains post-clean.

## Gate

| Metric      | Limit | Actual |
| ----------- | ----- | ------ |
| Total files | ≤45   | **41** |
| Production  | ≤28   | **21** |
| Tests       | —     | **18** |
| Docs        | —     | **2**  |

Base/dependency #13611 is `d0271cb46f2871c201f39c51e35356efd4658eac`. The reviewed candidate is `bc1714b6f0f29df377ae59181b8fdac8d13ed153`; the final local correction SHA is reported with worker completion.

## Defects found and fixed

- `getRenderRowKey` discarded owner-qualified folder row keys, so same-ID local/runtime folders still gave TanStack duplicate keys and reused the wrong DOM/fiber during cold render, scrolling, and rebuilds.
- Runtime-stamped folder rows were sectioned from `connectionId` plus the focused default instead of `executionHostId`, splitting them from their runtime group after host-filter rebuilds.
- Rendered headers carried an owner but WorktreeList and WorktreeContextMenu still sent bare group IDs for rename, delete, move, create, reorder, cache lookup, and path-status prefetch; ambiguous calls therefore failed closed or targeted the first owner.
- Project-group drag was disabled by any catalog-wide duplicate. It now permits a filtered single-owner view and remains disabled for a mixed-owner rendered view until bare-ID drag internals are unambiguous.
- Composer group options and initial sidebar launches used bare group IDs. Options and initial selection now carry owner identity, and legacy ownerless restoration fails closed only when the ID is ambiguous.
- Host filtering could turn an owner-qualified header back into a bare key. The global ambiguity set now preserves collapse/render identity across filter rebuilds.
- Candidate-added filesystem-auth tests used wall-clock thresholds. Coverage now asserts deterministic operation shape instead.

## Issue behavior covered

- Cold local + runtime render produces distinct owner-qualified header keys.
- Collapse affects only the selected owner and remains stable through a host-filter rebuild.
- Same-ID folder rows keep distinct virtualizer keys, preventing DOM reuse while scrolling.
- Runtime folder rows remain under their stamped runtime host.
- Header/menu actions, removal selection, path status, cache keys, and composer targets retain the selected owner.
- All-host mixed-owner drag fails closed; a filtered single-owner view can reorder with an explicit mutation owner.

## Remote compatibility decision

No new RPC field or stream opcode was introduced by this correction. Existing optional `ownerHostId` selectors remain additive: new clients with old hosts degrade to legacy unambiguous behavior, and current runtime mutations stay bare inside the owning runtime where unambiguous. Publishing an inner SSH owner through one paired runtime would require a separate composite ownership model and capability-aware transport; it is not needed for the reported local + paired-runtime topology and was not added here.

## Validation

- Node `v24.18.0` node/CLI/web typechecks: pass.
- Node `v26.5.0` node/CLI/web typechecks: pass.
- Focused candidate/sidebar/composer/auth matrix: **927 passed across 24 files** on Node 24 and again on Node 26.
- Additional runtime-folder regression: pass on Node 24 and Node 26.
- Full lint, native/type-aware quality, 73 reliability gates, max-lines ratchet, skill, and localization gates: pass; only pre-existing `WorktreeJumpPalette` hook warnings were reported.
- Changed-code quality and React Doctor changed gates: 0 new findings across 41 changed files.
- `oxfmt --check` on all edited files and `git diff --check`: pass.

## Remaining work

The coordinator should review the local correction commit. Because meaningful defects were found, do not push or retarget PR #13599 from this worker result; Electron QA remains intentionally deferred until a later clean review.
