# #12532 exact-candidate independent review

## Verdict

**NOT CLEAN.** Exact candidate `de06dbb4f2e2e27da7fa21592432439b985649db` retained four issue-scoped defect classes in persistence provenance, local filesystem authorization, same-ID folder deletion, and bulk owner/path-status work. The defects are fixed locally with deterministic coverage; PR #13599 was not pushed or retargeted, PR #13611 was not modified, and Electron QA remains post-acceptance.

## Gate

| Metric      | Limit | Actual |
| ----------- | ----- | ------ |
| Total files | ≤45   | **55** |
| Production  | ≤28   | **32** |
| Tests       | —     | **21** |
| Docs        | —     | **2**  |

Base/dependency #13611 remains `d0271cb46f2871c201f39c51e35356efd4658eac`. The exact candidate exceeds the retained-candidate hard gate by 10 total and 4 production files; the final local correction SHA is reported with worker completion.

## Defects found and fixed in this review

- Folder-scope SSH migration collapsed missing and explicit `connectionId: null`, allowing inferred SSH ownership to overwrite explicit local project-group and folder provenance.
- Indexed filesystem authorization inspected the first lexicographic prefix candidate only, so a sibling such as `scope-archive` could hide the remote descendant `scope/repo` and authorize a legacy remote-only root locally.
- Quick-delete and context-menu deletion compared the active folder by bare `folder:<id>`, deactivating a surviving same-ID owner; the correction also handles legacy active sessions without owner provenance.
- Bulk folder ownership rebuilt the same project-group index for each row, while project-group path-status snapshots rescanned subtrees and repos for each scope. Both now cache by immutable catalog identity, and persistence group deletion uses sets instead of repeated sibling scans.

The migration, authorization, deletion, owner-index, and path-status performance regressions failed deterministically before their narrow fixes. The owner-index reproduction read group IDs 786,432 times, and the path-status reproduction read group IDs 264,704 times before correction.

## Prior findings re-audited

- Folder context-menu deletion retains the selected local, SSH, or runtime owner.
- Composer requests, source-repo traversal, cache identity, and runtime routing retain the selected project-group owner.
- Same-ID folder activation and metadata lookup/save resolve the exact owner.
- Legacy SSH folders still resolve a single unstamped legacy group without broadening generic membership or local filesystem authorization.
- Runtime project moves query the owning runtime even when the client group catalog is absent or stale.
- Rename, delete, reorder, collapse, path-status, and host-filter paths remain owner-qualified and fail closed when ambiguous.
- Folder workspaces remain supported independently of git worktrees.

## Remote compatibility decision

No new stream opcode or required wire field was introduced. Existing optional `ownerHostId` selectors remain additive, and paired-runtime RPC schemas can discard selectors they do not understand while operating on the runtime's own unambiguous catalog. The cross-version terminal-wire suite passes; no capability negotiation change is required.

## Validation

- Node `v24.18.0` node/CLI/web typechecks: pass.
- Node `v26.5.0` node/CLI/web typechecks: pass.
- Final changed-test matrix: 1,000 tests across 21 files on Node 26; the Node 24 matrix passed 998 tests before the final two legacy-owner assertions, followed by 39/39 final deletion tests.
- Path-status invalidation suite: 23/23 on Node 24 and Node 26.
- Cross-version terminal-wire suite: 4/4 on Node 24.
- Full lint, native/type-aware quality, 73 reliability gates, max-lines ratchet, skill, and localization gates: pass; only pre-existing `WorktreeJumpPalette` hook warnings were reported.
- Changed-code quality and React Doctor changed gates: 0 new findings across 55 changed files.
- Frozen geometry-boundary file hashes match the exact candidate.
- `oxfmt --check` on edited files and `git diff --check`: pass.

## Remaining work

The coordinator should review the local correction commit and decide how to resolve the 55/32 hard-gate overage. Because meaningful defects were found, do not push or retarget PR #13599 from this worker result; Electron QA remains intentionally deferred until the corrected candidate is accepted for another clean review.
