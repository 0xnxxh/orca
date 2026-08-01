# PR #11950 review — React #185 at `terminal.workbench`

Date: 2026-08-01  
Reviewed remote head: `bf184ac400`  
Base: `origin/main` at `16c5526dfd`

## Verdict

**SHIP WITH NITS after committing the local amendments in this worktree.**

The core diagnosis is sound: duplicate terminal entity IDs can make `setActiveTab` refuse the
global active-tab repair while reallocating an effect dependency forever. Preferring the active
worktree plus preserving `activeTabIdByWorktree` identity makes the repair converge, without
changing healthy single-owner behavior.

The remote PR head had one medium functionality gap and one low edge-case gap. Both are fixed and
tested locally; no blocking correctness or performance finding remains in the amended worktree.

## Findings fixed during review

### Medium — unified activation could still choose the stale/background duplicate

`setActiveTab` repaired legacy ownership to the active worktree, then independently searched
`Object.values(unifiedTabsByWorktree).flat()` and activated the first unified tab with the same
entity ID. When the stale/background key was inserted first, the React loop stopped but the active
worktree's split group remained on its previous tab.

The new regression test failed on the PR head with:

```text
expected 'u-previous' to be 'u-active'
```

The local amendment scopes unified lookup to the owner selected by
`resolveActiveTabOwnerWorktreeId`, retaining the old global fallback for unified-only terminal
rows. This also reduces the normal activation lookup from all unified worktrees to the owning
worktree.

### Low — null and falsy owner checks disagreed with the resolver contract

The resolver deliberately supports an empty-string worktree ID, but `setActiveTab` used a
truthiness check before updating `activeTabIdByWorktree`. It also treated `null` owner and `null`
active worktree as an ownership match, allowing an ownerless ID to become globally active and to
clear a stale unread signal.

The local amendment uses explicit `!== null` ownership checks. Tests pin the empty-string owner,
ownerless activation, and unread preservation cases.

### Nit — diagnostic comments overstated the breadcrumb cap and were stale

The guard is capped at 256 **verdict keys**, not 256 distinct tab IDs; one ID can consume both a
`true` and `false` key. Comments now describe the actual 128–256-tab coverage and the known
hydration path while preserving the honest fact that existing field reports predate the signal.

## Correctness review

- Duplicate ID, active worktree owns the ID: the resolver returns the active worktree regardless
  of insertion order; `activeTabId`, remembered activation, and unified group activation now agree.
- Duplicate ID, active worktree does not own the ID: behavior falls back to the first legacy owner,
  preserving background activation and bell semantics.
- Single owner: behavior is equivalent to the prior first-match resolver.
- No owner: global terminal selection and unread state remain unchanged; unified-only activation
  still uses the compatibility fallback.
- Redundant activation: `activeTabIdByWorktree` retains identity, removing the repair effect's
  self-trigger even if ownership becomes anomalous again.
- SSH, folder workspaces, native worktrees, macOS, Windows, and Linux share this renderer-only
  logic. The resolver makes no path, Git, or host assumptions.

The direct-SSH hydration regression test is meaningful: it exercises snapshot application,
path-based remapping, stale-key retention, the real store action, and repair convergence. Its
limits remain correctly documented: catalog ID change and transport are modelled, three IPC
boundaries are stubbed, and `reconnectPersistedTerminals` is load-bearing.

## Functionality review

Normal-state tab selection, background bell retention, and unified-only terminal activation are
preserved. The local unified-owner amendment closes the main wrong-tab risk introduced by applying
the new active-owner preference to only half of the activation model.

Known duplicate-state ambiguity remains outside the crash fix:

- `updateTabTitle` and `clearTabLaunchAgent` still use the last-writer-wins owner cache.
- `setRuntimePaneTitle` cannot distinguish a background pane from an active pane when both share
  the same tab ID. The PR chooses to suppress a sort bump if the active worktree owns that ID; a
  genuine background copy can therefore miss a re-sort.
- Hydration still retains the stale worktree key. This PR makes the broken state safe; it does not
  clean the state.

These do not justify widening the P0 crash patch. They should be resolved together by stale-key
cleanup or by making ambiguous APIs carry worktree identity.

## Performance review

| Path | Added work | Assessment |
|---|---:|---|
| `setActiveTab` | `O(worktrees × terminal tabs)` ownership scan | Discrete activation/IPC path, not render, pointer, title-frame, or PTY-byte hot path |
| Unified activation | Owner-array scan, global fallback only on model mismatch | Net improvement over unconditional `Object.values().flat()` |
| Background classified title change | Up to `O(active-worktree tabs)` membership scan | Technically new work in healthy background cases, but bounded and only on classification changes |
| Duplicate breadcrumb | One full resolver pass plus at most two emissions per tab ID | Renderer set capped at 256 verdict keys; main-process coalescing bounded to two keys |

The PR body's statement that the non-duplicated title path is entirely unchanged is slightly too
strong: a normal background title classification now scans the active worktree's tab list after
the cheap owner inequality. That is not an actionable regression; it avoids the much worse
`O(all worktrees × tabs)` resolver on title frames and is negligible at the field sizes reviewed.

## Does the production stack require this fix?

The field stack is compatible with this driver, but it does **not uniquely require** it. All eight
provided samples match the six-frame passive `useState` dispatch signature, and the checked-in
repair harness proves non-convergence. The PR's production React experiment further demonstrates
that a descendant passenger can throw the exact field stack while the Zustand repair loop is the
driver.

That establishes a credible causal path, not direct attribution of every field report:

- `TerminalPaneOverlayLayer` and `SortableTab` are descendant stack tops, not necessarily drivers.
- The prior overlay geometry loop remains covered and passes; there is no new evidence to reopen
  the already-shipped #10026 fix.
- The two later LesleyMurfin samples contain `terminal_park_verdict_churn`, although the churn is
  not temporally sufficient to prove a cold-parking loop and one report follows a reload.
- `bdf0db48` also records an earlier #185 at `scrollToEnd`, evidence that this surface can host
  more than one update-depth driver.
- Several samples show repeated worktree activation, which supports the repair-path model, while
  others do not expose a trigger in their retained activity window.

Therefore the P0 fix should ship, but the cluster should remain monitored. On versions newer than
1.4.163:

1. Check `terminal_tab_id_owned_by_multiple_worktrees` on every continuing
   `terminal.workbench` #185.
2. If present, prioritize stale-key cleanup and capture the SSH/repo-remap context.
3. If absent, investigate cold-parking/local passive setters and `scrollToEnd`; do not assume the
   overlay geometry loop regressed without new geometry evidence.

## Verification

- Mandatory React #185 command: **2 files, 11 tests passed**.
- Changed-path targeted suite: **6 files, 66 tests passed**.
- Broader renderer store + terminal-pane suite: **364 files, 5,119 tests passed**.
- `oxlint` on all PR files: passed.
- `oxfmt --check` on all PR files: passed after formatting the local amendment.
- Web typecheck: `npx tsc --noEmit -p config/tsconfig.tc.web.json` passed.
- Node typecheck: `npx tsc --noEmit -p config/tsconfig.node.json` passed.
- Remote PR checks were green at the reviewed head.

The repeated npm warnings about `shamefully-hoist` and `minimum-release-age` are unrelated project
configuration warnings; no test or validation command failed because of them.

## Remaining nits

- Update the PR body from “once per tab ID” to “once per tab ID per verdict.”
- Avoid saying the breadcrumb identifies “which duplicate”; its payload intentionally contains no
  tab/worktree identity and only proves owner count plus active-owner resolution.
- The production-bundle end-to-end harness is documented rather than committed. The checked-in
  convergence and hydration tests are sufficient for this patch, but a future isolated production
  React config would make that evidence reproducible without reconstructing the PR experiment.

