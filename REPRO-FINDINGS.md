# Retirement reproduction findings

## STA-4449 — CONFIRMED

A local generated name is recorded only in `retiredWorktreeNamesByRepo`. Removing the project
deletes that repo-id entry, and re-adding the same path creates a new repo id. The local backfill
does not recover a spent name when its workspace directory is gone and its surviving history is
Codex-only, because Codex rollout JSONL files are deliberately not scanned. The new repo therefore
receives an empty registry and can reissue the name, which points Codex at the old cwd history.

The failing test is `preserves a Codex-only local retirement across remove and re-add` in
`src/main/persistence-worktree-name-retirement.test.ts`.

## STA-4491 — CONFIRMED

Remote retirements are copied to a namespace keyed by `getRepoExecutionHostId(repo)` and the
workspace probe path. An SSH target-id rotation changes the host-id prefix from `ssh:ssh-old` to
`ssh:ssh-new`. After project removal deletes the repo-id entry, a re-added repo reads only the new
namespace, leaving the retirement tombstone under the old namespace key.

The failing test is `preserves a remote retirement when an SSH target id rotates before re-add` in
`src/main/persistence-worktree-name-retirement.test.ts`.

## Failure proof

Command:

```text
npx vitest run --config config/vitest.config.ts src/main/persistence-worktree-name-retirement.test.ts
```

Result: 2 failed, 23 passed. Both failures have the same material diff:

```text
AssertionError: expected { exhaustedTiers: +0, names: [] } to deeply equal
{ exhaustedTiers: +0, names: ['nautilus'] }

- Expected
+ Received

  {
    "exhaustedTiers": 0,
-   "names": [
-     "nautilus",
-   ],
+   "names": [],
  }
```

This proves the tests reach the registry read after the relevant remove/re-add transition and fail
because the specific retired name is lost, rather than because setup or an unrelated operation
throws.
