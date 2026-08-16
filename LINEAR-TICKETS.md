# STA-4449 — [P1][daily 1.4.184] Local project remove/re-add can reissue generated name and Codex history (#14350)

State: Todo | Priority: 1 | URL: https://linear.app/stably/issue/STA-4449/p1daily-14184-local-project-removere-add-can-reissue-generated-name
Branch: brennan/sta-4449-p1daily-14184-local-project-removere-add-can-reissue

## Context

Daily: `v1.4.184-daily.202608151425`
TARGET: `c0a775454a29667c3f9fbfeef356e31e1e2acbe0`
FROM: `v1.4.183`
Severity-validated by Codex gpt-5.6-sol high.
Cherry-pick canvas: this original PR is **not** on the canvas.

## Severity

P1 — removing and re-adding a local project can reissue a generated workspace name and resurface prior Codex cwd history.

## Original broken PR

[https://github.com/stablyai/orca/pull/14350](<https://github.com/stablyai/orca/pull/14350>) — never reissue a generated workspace name (author: brennanb2025)

## TARGET evidence

* `src/main/worktree-name-retirement.ts:169-224`, `:236-286`
* `src/main/persistence.ts:4903-4930`
* `src/main/runtime/orca-runtime.ts:22647-22673`

## Ask

Retain compacted local retirement tombstones independently of the live repo id, keyed by a stable local source/collision identity, and union them when the path is re-added. Add a local remove/re-add test whose only surviving history is a Codex JSONL cwd.

---

# STA-4471 — [P0][continuous] Older paired clients bypass generated-name retirement — PR #14350

State: Todo | Priority: 1 | URL: https://linear.app/stably/issue/STA-4471/p0continuous-older-paired-clients-bypass-generated-name-retirement-pr
Branch: brennan/sta-4471-p0continuous-older-paired-clients-bypass-generated-name

## Original broken PR

* **PR #14350** — [https://github.com/stablyai/orca/pull/14350](<https://github.com/stablyai/orca/pull/14350>)
* Author: brennanb2025
* Span: continuous readiness `e570cad..d2ffe1f` (main)

## Summary

Generated-name retirement only runs when the client sends the new optional `nameWasGenerated` bit. A still-supported older paired/mobile client omits the field, so the new host treats the name as user-typed, skips the retirement registry, and can recreate a workspace at a cwd it already knows is unsafe.

## Why P0

Mixed desktop/mobile versions are supported. Reusing a retired cwd can attach the previous workspace's Claude/Codex conversation history to the new workspace.

## Action

Refuse reuse of a known retired generated path on the host even when the client omits provenance. Cover old-mobile/new-host (and local/SSH/runtime create).

---

# STA-4472 — [P0][continuous] WSL retirement backfill misses distro Claude history — PR #14350

State: Todo | Priority: 1 | URL: https://linear.app/stably/issue/STA-4472/p0continuous-wsl-retirement-backfill-misses-distro-claude-history-pr
Branch: brennan/sta-4472-p0continuous-wsl-retirement-backfill-misses-distro-claude

## Original broken PR

* **PR #14350** — [https://github.com/stablyai/orca/pull/14350](<https://github.com/stablyai/orca/pull/14350>)
* Author: brennanb2025
* Span: continuous readiness `e570cad..d2ffe1f` (main)

## Summary

WSL workspaces live under the distro UNC root, but retirement backfill only scans the Windows host `~/.claude/projects`. After a generated WSL workspace is deleted, the distro-local Claude bucket is still the durable evidence that the name is spent — and backfill misses it, so create can reissue the same cwd.

## Why P0

A current supported WSL path can inherit the previous workspace's Claude history.

## Action

Include each WSL distro's `<wslHome>/.claude/projects` in retirement discovery. Add a WSL delete/recreate test.

---

# STA-4473 — [P1][continuous] Generated-name create can hang on retirement backfill — PR #14350

State: Todo | Priority: 1 | URL: https://linear.app/stably/issue/STA-4473/p1continuous-generated-name-create-can-hang-on-retirement-backfill-pr
Branch: brennan/sta-4473-p1continuous-generated-name-create-can-hang-on-retirement

## Original broken PR

* **PR #14350** — [https://github.com/stablyai/orca/pull/14350](<https://github.com/stablyai/orca/pull/14350>)
* Author: brennanb2025
* Span: continuous readiness `e570cad..d2ffe1f` (main)

## Summary

Generated workspace create awaits a retirement-backfill scan whose Promise is cached forever and whose `readdir` has no deadline. A stalled NFS/SMB/WSL UNC or `~/.claude/projects` listing blocks this create and every later generated-name create for that namespace until restart. WSL UNC also bypasses the existing bounded WSL filesystem gate.

## Why P1

Ordinary create can hang indefinitely with no cancel/evict path. Not P0 (no proven history leak on this hang path).

## Action

Add a deadline and failed-Promise eviction. Route WSL UNC reads through the existing WSL filesystem gate.

---

# STA-4491 — [P1][continuous] SSH target-id rotation strands retirement tombstones — PR #14350

State: Todo | Priority: 1 | URL: https://linear.app/stably/issue/STA-4491/p1continuous-ssh-target-id-rotation-strands-retirement-tombstones-pr
Branch: brennan/sta-4491-p1continuous-ssh-target-id-rotation-strands-retirement

## Original broken PR

* **PR #14350** — [https://github.com/stablyai/orca/pull/14350](<https://github.com/stablyai/orca/pull/14350>)
* Author: brennanb2025
* Span: continuous readiness `e570cad..d2ffe1f` (main)

## Summary

Remote retirement namespaces embed the SSH target id. Re-add mints a new target id; `reassignSshTargetId` migrates other state but not `retiredWorktreeNamesByNamespace`.

## Evidence

* `src/main/worktree-name-retirement.ts:108-120,236-245`
* `src/main/ssh/ssh-connection-store.ts:37-54`
* `src/main/persistence.ts:7395-7492`

## Impact

After SSH remove/re-add, generated remote names can be reissued onto the old cwd and inherit agent history.

## Action

Migrate/merge retirement namespace keys in `reassignSshTargetId`.

---

# STA-4479 — [P2][continuous] Mobile RPC errors clear retired-name suggestion cache — PR #14350

State: Todo | Priority: 2 | URL: https://linear.app/stably/issue/STA-4479/p2continuous-mobile-rpc-errors-clear-retired-name-suggestion-cache-pr
Branch: brennan/sta-4479-p2continuous-mobile-rpc-errors-clear-retired-name-suggestion

## Original broken PR

* **PR #14350** — [https://github.com/stablyai/orca/pull/14350](<https://github.com/stablyai/orca/pull/14350>)
* Author: brennanb2025

Mobile treats a resolved RPC error as an empty retired-name registry and overwrites the cache. Host create still refuses reuse; impact is wrong suggestions until refresh.

---

# STA-4480 — [P2][continuous] Mobile shows proposed name when host created another — PR #14350

State: Todo | Priority: 2 | URL: https://linear.app/stably/issue/STA-4480/p2continuous-mobile-shows-proposed-name-when-host-created-another-pr
Branch: brennan/sta-4480-p2continuous-mobile-shows-proposed-name-when-host-created

## Original broken PR

* **PR #14350** — [https://github.com/stablyai/orca/pull/14350](<https://github.com/stablyai/orca/pull/14350>)
* Author: brennanb2025

Mobile routes the proposed generated name even when the host created a later retired-name-safe candidate. The live-name hook later corrects the label. Transient wrong title only.

---

# STA-4482 — [Reland] #14665 retire glued mobile pending bubbles after revert #14819

State: Done | Priority: 1 | URL: https://linear.app/stably/issue/STA-4482/reland-14665-retire-glued-mobile-pending-bubbles-after-revert-14819
Branch: brennan/sta-4482-reland-14665-retire-glued-mobile-pending-bubbles-after

# Reland after revert

#14665 (`https://github.com/stablyai/orca/pull/14665`) retired mobile pending bubbles when two fast sends landed as one transcript row. That change is reverted in #14819 (`https://github.com/stablyai/orca/pull/14819`) because it introduced a launch-blocking regression.

## User-facing regression

* A rejected mobile send can restore a trimmed composer and drop user draft text.
* Sends that were glued while the transcript was still loading can stay queued forever.

## Reland ask

Reland the glue-retirement work with a fix that:

1. Does not drop draft text when a send is rejected (restore the original composer contents, not a trimmed version).
2. Does not leave loading-time glued sends permanently queued.

Keep the intended glue-retirement behavior. This is a reland of #14665, not a new bug ticket. STA-4388 is a related mobile ghost-queued report and is not this work.

## Links

* Original: [https://github.com/stablyai/orca/pull/14665](<https://github.com/stablyai/orca/pull/14665>)
* Revert: [https://github.com/stablyai/orca/pull/14819](<https://github.com/stablyai/orca/pull/14819>)

---

# STA-4477 — [P1][continuous] Desktop glue can retire a newer queued send — PR #14663

State: Todo | Priority: 1 | URL: https://linear.app/stably/issue/STA-4477/p1continuous-desktop-glue-can-retire-a-newer-queued-send-pr-14663
Branch: brennan/sta-4477-p1continuous-desktop-glue-can-retire-a-newer-queued-send-pr

## Original broken PR

* **PR #14663** — [https://github.com/stablyai/orca/pull/14663](<https://github.com/stablyai/orca/pull/14663>)
* Author: brennanb2025
* Span: continuous readiness `e570cad..d2ffe1f` (main)

## Summary

Desktop native-chat glue matching filters candidates only against the oldest still-open send, then matches the entire open queue. A newer queued prompt can be treated as already delivered against an older glued transcript row and then pruned.

## Why P1

A queued prompt can disappear. Do not revert — that would re-open #14262.

## Action

Enforce each pending send's own transcript boundary during glue matching.

---

# STA-4492 — [P1][continuous] Mobile hydration sends can stay queued after glued landing — PR #14665

State: Todo | Priority: 1 | URL: https://linear.app/stably/issue/STA-4492/p1continuous-mobile-hydration-sends-can-stay-queued-after-glued
Branch: brennan/sta-4492-p1continuous-mobile-hydration-sends-can-stay-queued-after

## Original broken PR

* **PR #14665** — [https://github.com/stablyai/orca/pull/14665](<https://github.com/stablyai/orca/pull/14665>)
* Author: brennanb2025
* Span: continuous readiness `e570cad..d2ffe1f` (main)

## Summary

Sends during transcript hydration persist `glueBaselineTrusted: false` and become permanent glue barriers. Distinct from STA-4482 (reland after revert #14819). TARGET `d2ffe1f` still has #14665; #14819 is not in this span.

## Evidence

* `mobile/src/session/use-mobile-native-chat-drafts.ts:129-144`
* `mobile/src/session/mobile-native-chat-pending-retirement.ts:34-46`
* `mobile/src/session/use-mobile-native-chat-controller.ts:157-159,210-218`
* `mobile/src/session/use-mobile-native-chat-drafts-glued-pending.test.ts:133-140`

## Impact

Two rapid mobile sends during hydration can stay visibly queued after one glued row lands.

## Action

Let post-hydration pending entries reconcile safely; do not permanently disqualify hydration-time sends.

---

# STA-4451 — [P2][daily 1.4.184] Removed-workspace snapshot tombstones persist until later scans (#13413)

State: Todo | Priority: 2 | URL: https://linear.app/stably/issue/STA-4451/p2daily-14184-removed-workspace-snapshot-tombstones-persist-until
Branch: brennan/sta-4451-p2daily-14184-removed-workspace-snapshot-tombstones-persist

## Context

Daily: `v1.4.184-daily.202608151425`
TARGET: `c0a775454a29667c3f9fbfeef356e31e1e2acbe0`
FROM: `v1.4.183`
Severity-validated by Codex gpt-5.6-sol high.

## Severity

P2 — removed workspace snapshot tombstones persist until later unrelated cleanup/space-analysis scans.

## Original broken PR

[https://github.com/stablyai/orca/pull/13413](<https://github.com/stablyai/orca/pull/13413>) (author: brennanb2025)

## TARGET evidence

* `src/main/workspace-cleanup-scan-snapshot.ts:28`, `:130-189`, `:244-280`
* `src/main/workspace-space-analysis-snapshot.ts:26`, `:209-291`
* `src/main/workspace-snapshot-prune-index.ts:42-56`

## Ask

Retire tombstones after all pre-prune producers are fenced, with a bounded fallback for tombstones whose producers never settle.

---

# STA-4363 — [P2][daily 1.4.183] Native chat strips literal [Image #N] from user messages (#14162)

State: In Progress | Priority: 2 | URL: https://linear.app/stably/issue/STA-4363/p2daily-14183-native-chat-strips-literal-image-n-from-user-messages
Branch: brennan/sta-4363-p2daily-14183-native-chat-strips-literal-image-n-from-user

## Context

Daily: `v1.4.183-daily.202608141436`
TARGET: `cb42b60849d81ff58976200baa6b89dc5df99fb7`
FROM: `v1.4.182` (`9df0488ec0ad771673ea3a3f2cef79d179b33857`)
Severity-validated by Codex gpt-5.6-sol high.
Cherry-pick canvas: this original PR is **not** on the canvas.
Scan run: `/tmp/prod-release-scan-daily-1.4.183-20260814T170415`

## Severity

P2 — display-only. Unanchored `[Image #N]` stripping runs on ordinary user turns with no preceding image-source, so literal text is removed on desktop and mobile. Stored transcript is intact.

## Original broken PR

[#14162](<https://github.com/stablyai/orca/pull/14162>) — Fix native chat image marker position handling (author: brennanb2025)

## TARGET evidence

* `src/shared/native-chat-image-transcript-markers.ts:4-7`, `:25-36`, `:90-144`
* `src/renderer/src/components/native-chat/native-chat-session-assembler.ts:132-145`
* `mobile/src/session/mobile-native-chat-render-data.ts:46-49`

## Ask

Strip positional markers only from the prompt proven to follow a contiguous image-source run. Preserve marker-looking text in standalone user turns.

---
