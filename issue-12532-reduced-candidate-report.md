# #12532 exact-candidate independent review

## Verdict

**NOT CLEAN.** Exact candidate `dfdc6d1c63f0dbe9a7c440a66d0a4e50cf545316` retained six owner-identity defects across folder interactions, composer behavior, legacy SSH resolution, and runtime moves. The defects are fixed locally with deterministic coverage; PR #13599 was not pushed or retargeted, PR #13611 was not modified, and Electron QA remains post-clean.

## Gate

| Metric      | Limit | Actual |
| ----------- | ----- | ------ |
| Total files | ≤45   | **45** |
| Production  | ≤28   | **26** |
| Tests       | —     | **17** |
| Docs        | —     | **2**  |

Base/dependency #13611 remains `d0271cb46f2871c201f39c51e35356efd4658eac`. The reviewed candidate is `dfdc6d1c63f0dbe9a7c440a66d0a4e50cf545316`; the final local correction SHA is reported with worker completion.

## Defects found and fixed

- Folder context-menu deletion dropped the selected folder row owner, so same-ID folders failed closed instead of deleting the selected local, SSH, or runtime row.
- Composer project-group path-status requests used bare group IDs, sharing request/cache identity across same-ID owners.
- Composer source-repo traversal built descendant IDs from every owner, so a foreign owner's child ID could include an unrelated repo under the selected owner.
- Exact-owner same-ID folder activation failed before checking the requested execution host, and metadata lookup/save could still select or update a bare-ID sibling.
- Legacy SSH folders carrying `connectionId` could not use a single unstamped legacy group for normalization or runtime path resolution. The compatibility fallback remains outside generic membership and local filesystem authorization.
- Runtime project moves returned before querying the owning runtime when the client group catalog was absent or stale.
- A candidate migration test omitted explicit folder sort order and could reverse its expected rows across a millisecond boundary; the fixture now has deterministic ordering.

The first three product regressions failed deterministically before the fixes: 3 failed and 36 passed across the focused tests. The subreview then reproduced the remaining three failures against upstream coverage before their narrow fixes.

## Issue behavior covered

- Cold local + one-runtime rendering produces distinct owner-qualified React, TanStack, header, and folder-row keys.
- Collapse affects only the selected owner and remains stable through scrolling and host-filter rebuilds.
- Runtime folder rows remain under their stamped `executionHostId` after filtering and reconciliation.
- Rename, delete, move, create, context-menu, composer, cache, and path-status actions retain the selected owner.
- Local, SSH, runtime, and folder catalogs preserve owner identity through persistence, migration, authentication, and cache lookup.
- All-host mixed-owner drag fails closed; a filtered single-owner view can reorder with an explicit mutation owner.

## Remote compatibility decision

No new stream opcode or required wire field was introduced. Existing optional `ownerHostId` selectors remain additive, and paired-runtime RPC schemas safely discard selectors they do not understand while operating on the runtime's own unambiguous catalog. Projecting a paired runtime's private inner SSH ownership would require a separate composite ownership and capability-negotiated wire redesign; it is not needed for the reported local + one-runtime topology and was not added.

## Validation

- Node `v24.18.0` node/CLI/web typechecks: pass.
- Node `v26.5.0` node/CLI/web typechecks: pass.
- Exact-candidate owner-identity matrix: **749 passed across 17 changed test files** on Node 24 and again on Node 26.
- Upstream exact-owner activation, legacy SSH runtime file routing, and stale-catalog runtime move reproductions: pass on Node 24 and Node 26.
- Full lint, native/type-aware quality, 73 reliability gates, max-lines ratchet, skill, and localization gates: pass; only pre-existing `WorktreeJumpPalette` hook warnings were reported.
- Changed-code quality and React Doctor changed gates: 0 new findings across 45 changed files.
- `oxfmt --check` on edited files and `git diff --check`: pass.

## Remaining work

The coordinator should review the local correction commit. Because meaningful defects were found, do not push or retarget PR #13599 from this worker result; Electron QA remains intentionally deferred until a later clean review.
