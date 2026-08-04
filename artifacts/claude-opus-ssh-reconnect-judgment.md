# Judgment — Sidebar SSH reconnect affordance (Grok vs Codex)

**Judge:** Claude Opus 5 (independent UI design judge)
**Date:** 2026-08-03
**Artifacts reviewed:** both standalone HTMLs (read in full) and both PNG renders (viewed).
**Grounding:** `docs/STYLEGUIDE.md`, `src/renderer/src/assets/main.css`, `src/renderer/src/components/sidebar/WorktreeCard.tsx`, `src/renderer/src/components/sidebar/SshDisconnectedDialog.tsx`, `src/renderer/src/components/terminal-pane/TerminalSshReconnectOverlay.tsx`, `src/renderer/src/components/sidebar/WorktreeCardMetadataControls.tsx`, `src/renderer/src/components/ui/button.tsx`, `src/shared/ssh-types.ts`.
**No production code was modified.**

> Note on the renders: both PNGs are single-viewport captures that cut off at ~1000px, so the state-matrix / mapping / a11y sections below the fold are visible only in the HTML. Judgment below is based on the HTML for content and on the PNGs for actual rendered visual weight — which is where the most decisive difference showed up.

---

## 1. Verified ground truth (what the code actually does today)

| Fact | Evidence |
| --- | --- |
| The sidebar cue is a passive, non-focusable `<span>` wrapping `ServerOff className="size-3 text-red-400"` with tooltip "SSH disconnected". | `WorktreeCard.tsx:1430–1452` |
| A *second*, near-identical block exists for runtime ("Orca server") hosts, also `ServerOff text-red-400`, also passive. | `WorktreeCard.tsx:1455–1490` |
| Card click opens the blocking dialog **only** when the active view is not a terminal. | `WorktreeCard.tsx:880–883`, comment at `:365` and `:393` |
| Whole card gets `opacity-60` when SSH **or** runtime is disconnected. | `WorktreeCard.tsx:1892` |
| `sshStatus` is `null` for runtime-owned SSH targets (deliberate — suppresses false "disconnected"). | `WorktreeCard.tsx:352–358` |
| `sshOwnerEnvironmentId` is already computed in the card, so runtime-routed connect is reachable from the sidebar today. | `WorktreeCard.tsx:349–351` |
| `SshConnectionStatus` has **8** members: `disconnected, connecting, auth-failed, deploying-relay, connected, reconnecting, reconnection-failed, error`. | `src/shared/ssh-types.ts:102–110` |
| Reconnectable set is `['disconnected','reconnection-failed','error','auth-failed']`, duplicated verbatim in the dialog and the overlay. | `SshDisconnectedDialog.tsx:59–61` vs `TerminalSshReconnectOverlay.tsx:35–37` |
| The overlay's connect is **not** a bare `ssh.connect`: it branches on `sshOwnerEnvironmentId`, mirrors `setSshConnectionState` (because `ssh.connect` can resolve before the state IPC lands), and on failure resyncs target metadata + removed labels (STA-1468). | `TerminalSshReconnectOverlay.tsx:91–137` |
| A removed target must never be offered Connect; `targetRemoved` is a real prop and `removedSshTargetLabels` lives in the renderer store, so the sidebar can derive it. | `TerminalSshReconnectOverlay.tsx:19–21, 88–89`; `store/slices/ssh.ts:39`; `store/slices/runtime-environment-ssh.ts:300, 321` |
| There is an existing test contract that the dialog must not auto-open for a restored active disconnected worktree. | `WorktreeCard.ssh-reconnect-prompt.test.tsx:147` |
| `WorktreeCard.tsx` is the **only** non-test consumer of `SshDisconnectedDialog`. | grep across `src` |
| `Button` has both `xs` (h-6, 12px svg) and `icon-xs` (size-6) — both proposals' primitive claims are valid. | `ui/button.tsx:23, 27` |
| **Precedent A — icon-only ghost action in the card:** `MetadataActionIcon` = `Button variant="ghost" size="icon-xs" className="size-6"` + `stopPropagation` + Tooltip. | `WorktreeCardMetadataControls.tsx:38–60` |
| **Precedent B — compact *labeled* destructive action in the title row:** the "rename failed" control is a `Button variant="ghost"` at `h-4`, `text-[10px]`, `text-destructive border-destructive/40 bg-destructive/10`, icon `size-2.5`, **plus** a tooltip even though it has a visible label. | `WorktreeCard.tsx:1523–1551` |
| Sidebar surface tokens in this pane are the `worktree-sidebar` family (`--worktree-sidebar: #2a2a2a` in dark), not the generic `--sidebar` (#171717). | `main.css:287–288`; `WorktreeList.tsx:4086, 4227, 4272` |

Precedent B matters a lot: it means a short *labeled* pill in the title row is house style, not an invention — and that a tooltip alongside a visible label is already accepted here, so the STYLEGUIDE line "don't tooltip a control that has a visible label" is not a live objection against Codex.

---

## 2. Scorecard

Scale 1–5. Weighting is mine, stated so it can be argued with.

| Criterion | Weight | Grok | Codex |
| --- | --- | --- | --- |
| Clarity of the affordance | 1.0 | 3 | **5** |
| Discoverability (the actual brief) | 1.5 | 2 | **5** |
| Consistency with Orca style / components / tokens | 1.25 | **5** | 3 |
| Accessibility | 1.25 | 3 | **4** |
| State handling: connected / connecting / error / retry / removed | 1.5 | **5** | 2 |
| Minimal UI disruption | 1.25 | **5** | 2 |
| Implementation fit (does the wiring survive contact with the code) | 1.25 | 3 | **5** |
| Correctness of stated assumptions about the codebase | 1.0 | **5** | 3 |
| **Weighted total (max 50)** | | **38.75** | **35.5** |

---

## 3. Grok — assessment

### What it gets right

1. **Complete state model.** All 8 `SshConnectionStatus` members are enumerated and mapped, including `deploying-relay` and `error`, which Codex silently drops. Its `isConnectingStatus` / `canConnectStatus` predicates are copied correctly from the real source.
2. **It is the only proposal that handles `targetRemoved`.** The ghost state ("SSH host removed — reconnect unavailable", no Connect, overlay offers Remove workspace) is a faithful port of `TerminalSshReconnectOverlay.tsx:88–89` and of the STA-1468 lesson: never render a Connect that can only fail. This is the single largest correctness gap between the two.
3. **Token fidelity.** It mirrors the `worktree-sidebar` family (`#2a2a2a` fill, `#353535` accent, `worktree-sidebar-ring`), keeps `red-400` / `yellow-500` exactly as the existing dialog and card use them, invents no tokens, and keeps the existing `opacity-60`. The render visibly *is* the Orca sidebar.
4. **Accurate, checkable citations.** `~1430–1452`, `~880–883`, the `WorktreeCardMetadataControls` pattern, the focus-steal rationale on `showDisconnectedDialog` — every one verified true. It also correctly identifies that the reconnectable-status predicate is duplicated between dialog and overlay and proposes extracting it.
5. **Respects the runtime-host boundary.** It explicitly says: do not mint a chip when `sshStatus` is `null` (runtime-owned targets), and treat the runtime-host `ServerOff` block at `:1455+` as a follow-up gated on a runtime reconnect API existing. Codex never mentions that second block at all, even though it renders the identical red icon.
6. **Additive, not subtractive.** Chip is a new parallel path; the tested dialog behavior and the overlay stay as-is. Lowest-risk landing.

### Where it is wrong or weak

1. **It under-delivers the brief.** The whole premise is "the red icon looks like a status badge, not a control" — and the fix is… the same 12px red icon, in the same place, at the same weight. Compare the two PNGs: Grok's after-state is visually indistinguishable from its own before-state except for a tooltip. Hover-to-discover does not solve discoverability for a user who never suspects the glyph is clickable. Grok's own non-goal ("no permanent Reconnect text button — too heavy for a dense sidebar") is asserted, not argued, and Precedent B (`rename failed`) refutes it: the card already carries a labeled 10px destructive pill in that exact row.
2. **Real a11y defect: `disabled` for the connected and removed states.** Grok renders the chip as a `<button disabled>` when connected or when the target is removed. A disabled button is removed from the tab order, so its tooltip is unreachable by keyboard — strictly worse than today's `<span>` for those states, and a control that can never do anything shouldn't be a button. Render a non-interactive element when not actionable; only mint a `<button>` for the reconnectable set.
3. **Thin on the connect operation.** The implementation table says "`window.api.ssh.connect` or `connectRuntimeEnvironmentSshTarget`" and stops. It misses the `setSshConnectionState` mirror (the deferred-PTY-reattach path depends on it, `overlay:102–106`) and misses the failure-path `resync` (`overlay:117–131`). A build from Grok's spec alone would reproduce the pre-STA-1468 bug.
4. **Tooltip is doing too much work.** The second line ("prod-box · connection error") carries the *reason* for a failure. STYLEGUIDE:159–162 is explicit that critical/error content belongs inline, not in a tooltip. Grok has no inline error copy at all.
5. **Minor:** hover lifting `opacity-60 → 0.88` on a disconnected card is a new behavior with no sibling; the state-matrix rows "Hover (actionable)" and "Focus-visible" are presentation notes wedged into a status table; and `statusDotColor()` in the prototype contains a dead tautological branch (`isConnectingStatus(s) && !state.localConnecting ? true : isConnectingStatus(s)`) — harmless in a mock, but sloppy.

---

## 4. Codex — assessment

### What it gets right

1. **It actually solves discoverability.** A visible `Connect` / `Retry` / `Reconnect` label plus persistent inline status copy. In the render you read the recovery action without hovering anything. On the stated brief this is not close.
2. **Best-in-class state *language*.** Verb-per-state (`Connect` when disconnected, `Retry` after a connection failure, `Reconnect` after auth failure), with matching banner titles ("Authentication required" vs "SSH connection required") and accessible names that name the host ("Retry SSH connection to devbox"). It correctly refuses to lean on color or the `ServerOff` glyph alone — which is the right read of a monochrome design system.
3. **Strongest implementation mapping.** It is the only proposal that names the real contract: branch on the target owner, `window.api.ssh.connect` + store mirror or `connectRuntimeEnvironmentSshTarget`, **and preserve the stale-metadata resync after failure**. Its test list (propagation, each reconnectable state, disabled-while-connecting, runtime routing, store mirror, failure resync, focus/accessible name) is the list I'd actually ask for in review.
4. **Best a11y package.** Native button reachable independently of the card; `aria-describedby` pointing at the *visible* status copy (not a tooltip); `sr-only aria-live="polite"` with an explicit "don't announce on every render" caveat; **reserve the action width so remote state changes don't jitter the title row**; `prefers-reduced-motion` honored (`html:141`); disable immediately to prevent duplicate SSH attempts. The width-reservation and latency framing are exactly the SSH concerns STYLEGUIDE:304 demands and Grok never raises.
5. **The better principle, stated plainly.** "No modal appears as a side effect of navigation." Correct: a Dialog should demand a decision, and reconnect doesn't. Removing the dialog-on-click branch is a genuine UX improvement, not just a refactor.
6. **Refuses the yellow.** It notes it uses spinner semantics "without a yellow hardcoded token." Defensible and arguably more styleguide-correct than Grok's `yellow-500`, since `--yellow-500` is a raw palette value and the overlay's own spinner (`overlay:152`) carries no color. (The dialog does use `text-yellow-500`, so this is a live inconsistency in the repo, not a clean win for either side — see §6.)

### Where it is wrong or weak

1. **Incomplete state model — and the omission is load-bearing.** Five states only: `connected, connecting, disconnected, reconnection-failed, auth-failed`. Missing `deploying-relay`, `reconnecting`, and `error`. `error` is in the reconnectable set, so a real user in `error` hits an unspecified branch. Worse: **no removed-target state at all.** Codex would render `Connect` on a workspace whose SSH target no longer exists — the precise failure `targetRemoved` was added to prevent. Its mapping table also says nothing about the runtime-host `ServerOff` block or about `sshStatus == null`.
2. **Highest UI disruption, and the render proves it.** The title row now holds icon + title + labeled button, and the card gains a permanent second line. In Codex's own PNG the workspace name is truncated to **"Fix reconnect ban…"** while `main` and `Review API pagination` next to it are full-width. The sidebar is resizable and has a compact-cards mode; a persistent inline label will lose that fight. The `SSH disconnected` copy line is also triply redundant with the `ServerOff` icon and the button verb.
3. **Wrong sidebar surface.** `--sidebar: #171717` is used for the pane (`html:23, 77`) where the worktree sidebar is `--worktree-sidebar: #2a2a2a`. Consequence: the mock's card/sidebar contrast relationship is not the one shipping code has, so its hover (`sidebar-accent` at 56%) and its `.active` treatment can't be trusted as-rendered. It also declares the `worktree-sidebar` tokens and then mostly doesn't use them, and sets `--font-sans: Geist` without loading it (falls back to system — the render is not in Orca's typeface).
4. **Contrast risk it raises for others but not itself.** It correctly argues against color-only error signaling, then puts 10px `--destructive` copy inside a card it dims to `opacity: .62`. `#ff6568` at 62% over `#2a2a2a` is the one contrast pair in either proposal that needs measuring, and Codex doesn't mention it.
5. **Over-reaches on "surgical."** "Retire its WorktreeCard call site after consumers are audited" — I did the audit: `WorktreeCard.tsx` is the only consumer, so this is a proposal to delete `SshDisconnectedDialog` outright. That also deletes the window-capture Enter handler (`dialog:118–140`), which exists specifically because focus lives inside xterm/Monaco; users who currently hit Enter to reconnect lose that with no replacement. And removing the click branch inverts the intent behind `WorktreeCard.ssh-reconnect-prompt.test.tsx`. Defensible as a decision, but it must be named as a behavior change with a migration, not filed under "smallest change."
6. **Prototype-level flaws.** The tooltip is hand-positioned (`right: 7px; top: 51px`) inside `.sidebar { overflow: hidden }` — it would clip; in production this is Radix `TooltipContent side="right" sideOffset={8}` as everywhere else in the card. It also duplicates the visible label verbatim, which wastes the tooltip (Precedent B's tooltip adds information: "Click to see details").

---

## 5. Ranking

### 1st — Grok. 2nd — Codex. Narrow, and the margin is not on the axis you'd guess.

Codex wins the headline question decisively: it is the more *discoverable, clearer, better-labeled, better-wired, more accessible* design, and its guiding principle ("no modal as a side effect of navigation") is the correct one. If I were scoring only "which interaction should ship," Codex's labeled action wins on sight.

Grok ranks first because it is the better **base to build on**, and the gap is in the categories that produce bugs rather than the ones that produce debate:

- Grok is **complete** on a state machine that has 8 members plus a removed-target trapdoor; Codex covers 5 and would ship a Connect button that can only fail. Missing states are correctness defects; a too-quiet control is a tunable knob.
- Grok's **tokens, surfaces, and citations are verifiably right**; Codex's sidebar is painted on the wrong surface token, so its visual claims aren't yet trustworthy at the pixel level.
- Grok is **additive and preserves a tested contract**; Codex's central move (delete the dialog path) is a behavior change mislabeled as the smallest change, and silently drops a keyboard reconnect affordance that exists for a documented reason.
- Grok's two real defects — icon-only quietness and `disabled`-when-connected — are each a few lines to fix. Codex's — no removed-target state, no `error`/`deploying-relay`, wrong surface token, title-row truncation — require reopening the design.

Timing (Grok 3m34s, Codex 5m16s) did not enter the scoring and shouldn't: the 1m42s bought Codex a materially better implementation mapping and a11y section, which is a good trade. Neither run was slow enough for cost to matter.

**Practical reading: ship Grok's state machine and token discipline, wearing Codex's visible label, copy, connect-operation contract, and a11y package.** That hybrid is below.

---

## 6. Synthesis — the production design

### 6.1 One component, one status classifier

Extract the duplicated predicates (`SshDisconnectedDialog.tsx:59` vs `TerminalSshReconnectOverlay.tsx:35`) into a named module — `src/renderer/src/ssh/ssh-connection-recoverability.ts`, exporting `isConnectingSshStatus`, `canConnectSshStatus`. Not `ssh-utils`. Both existing call sites plus the new card control consume it, so the three surfaces can't drift.

Add `src/renderer/src/components/sidebar/WorktreeCardSshHostControl.tsx` (a named concrete concept, colocated with the card; `WorktreeCard.tsx` is already 1967 lines and must not absorb this inline). Props: `targetId`, `targetLabel`, `status: SshConnectionStatus | null`, `targetRemoved: boolean`, `sshOwnerEnvironmentId: string | null`, `worktreeId`.

### 6.2 Visual spec per state — keep Grok's coverage, wear Codex's label

Rendered in the title row where the current `<span>` sits (`WorktreeCard.tsx:1430–1452`).

| `status` | Element | Icon | Visible label | Interactive | Accessible name |
| --- | --- | --- | --- | --- | --- |
| `null` (runtime-owned) | nothing changes — no control, no chip | — | — | no | — |
| `connected` | **`<span>`**, not a disabled button | `Server` `size-3 text-muted-foreground` | none | no (Tooltip: "Project on SSH host {label}") | via `sr-only` |
| `connecting`, `deploying-relay`, `reconnecting` | `Button variant="ghost" size="xs"` **`disabled`** | `Loader2 size-2.5 animate-spin`, inherits `text-muted-foreground` | `Connecting…` | no | "Connecting to SSH host {label}" |
| `disconnected` | `Button variant="ghost" size="xs"` | `ServerOff size-2.5` | `Connect` | **yes** | "Connect to SSH host {label}" |
| `error`, `reconnection-failed` | same, destructive tint | `ServerOff size-2.5` | `Retry` | **yes** | "Retry SSH connection to {label}" |
| `auth-failed` | same, destructive tint | `ServerOff size-2.5` | `Reconnect` | **yes** | "Reconnect SSH host {label} — authentication failed" |
| `targetRemoved` (any status) | **`<span>`**, not a button | `ServerOff size-2.5 text-muted-foreground` | none | no (Tooltip: "SSH host removed — reconnect unavailable") | via `sr-only` |

Adopted verbatim from **Precedent B** (`WorktreeCard.tsx:1535`) so this is a sibling, not an invention:

```
h-4 shrink-0 gap-0.5 rounded !px-1 text-[10px] font-medium leading-none
text-destructive border border-destructive/40 bg-destructive/10
hover:bg-destructive/15 hover:text-destructive has-[>svg]:!px-1
```

Non-failure interactive states drop the destructive triplet for `text-muted-foreground border-worktree-sidebar-border bg-worktree-sidebar hover:bg-worktree-sidebar-accent hover:text-foreground` (Precedent: `WorktreeCard.tsx:1780`). Focus: `focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring`, matching that same sibling.

Resolved from each side:

- **Keep from Codex:** the visible verb, verb-per-failure-mode, host name in the accessible name, `Connecting…` as a labeled stage rather than a bare spinner (STYLEGUIDE:188 asks for a named stage), reserved min-width on the label slot so remote latency can't jitter the row, `prefers-reduced-motion` on the spinner, disable-immediately.
- **Keep from Grok:** the full 8-status map, `targetRemoved` as a first-class non-actionable state, `sshStatus == null` left completely alone, existing `opacity-60` untouched, no new tokens, Radix Tooltip with `side="right" sideOffset={8}`.
- **Change in Codex:** drop the always-visible `SSH disconnected` second line — the icon plus the verb already say it, and the line is what truncated the title in its own render. Its content moves into the tooltip's second line only when it adds information the label doesn't (the failure reason), and into the terminal banner where there's room. Recolor to the `--destructive` token rather than raw `#ff6568`, and drop the `--sidebar`/`--worktree-sidebar` confusion.
- **Change in Grok:** never render `<button disabled>` as pure decoration — connected and removed states are `<span>`s, preserving today's semantics; and the failure *reason* stops living exclusively in a tooltip.
- **Truncation contract (neither proposal specified this, and it's the thing most likely to regress):** the control is `shrink-0`; the title keeps `min-w-0 truncate` and yields first. In `compactCards` mode, and when the sidebar is narrower than ~200px, render the label as `sr-only` and fall back to Grok's icon-only `size="icon-xs"` form — the label is a progressive enhancement, not a layout requirement.

### 6.3 Exact interaction behavior

1. **Click / Enter / Space on the control:** `event.stopPropagation()` and `event.preventDefault()`, plus `onPointerDown={stopQuickActionPointerPropagation}` (the existing helper the rename-error badge uses at `WorktreeCard.tsx:1532` — pointer-down is where sidebar activation actually starts). The worktree is **not** activated. Reconnect only.
2. **Connect operation** — a straight port of `TerminalSshReconnectOverlay.handleConnect` (`:91–137`), which is Codex's contribution and must not be paraphrased:
   - guard on `isConnecting`, set local `connecting` immediately (button disables before any IPC — SSH latency is 50–200ms);
   - if `sshOwnerEnvironmentId` → `connectRuntimeEnvironmentSshTarget(sshOwnerEnvironmentId, targetId)`;
   - else → `const state = await window.api.ssh.connect({ targetId })`, and **if `state`, call `setSshConnectionState(targetId, state)`** — the deferred PTY reattach keys off this store, so omitting the mirror silently breaks terminal resume;
   - on throw → `toast.error(...)` **and** resync (`resyncRuntimeEnvironmentSshTargets` or `ssh.listTargets` + `ssh.listRemovedTargetLabels`), so a vanished target converges to the removed state instead of offering a Connect that can only fail (STA-1468);
   - `finally` → clear `connecting` behind `useMountedRef` (sidebar rows unmount under virtualization mid-flight).
3. **Failure is persistent, not transient.** The toast is supplementary; the durable signal is that the control stays present and becomes `Retry`. This is Codex's note 3 and it's right.
4. **Card body click:** activation only — `activateWorktreeFromSidebar`, unchanged.
5. **The dialog:** delete the `setShowDisconnectedDialog(true)` branch at `WorktreeCard.tsx:881–883`, adopting Codex's principle. Two conditions on that, both of which Codex skipped:
   - `SshDisconnectedDialog` is the *only* remaining consumer, so retiring the branch means the component becomes dead. **Land the branch removal and the component deletion as one reviewable change**, and update `WorktreeCard.ssh-reconnect-prompt.test.tsx` to assert "card click never opens a reconnect dialog" — replacing the weaker "does not *auto*-open" assertion rather than leaving a test that no longer describes the design.
   - The dialog's window-capture Enter handler (`:118–140`) exists because focus lives in xterm/Monaco. That ergonomic is not free to drop. Its replacement is the terminal overlay, which is already on-screen for the terminal case; if telemetry or users show the Enter-to-reconnect habit matters, add it to the overlay rather than resurrecting the modal. **Name this in the PR as a deliberate behavior removal.**
6. **Announcements:** one `aria-live="polite"` `sr-only` region per card, updated only on *status transitions* (not per render), text = the accessible name of the current state. Codex's caveat is the important half.
7. **Terminal overlay:** unchanged in behavior; align its button copy to the same verb set (`Connect` / `Retry` / `Reconnect`) so the sidebar and the pane never disagree about what the same click does.
8. **Runtime hosts (`WorktreeCard.tsx:1455–1490`) stay passive** in this change, per Grok. But land a code comment there stating why the two visually identical `ServerOff` glyphs now behave differently — otherwise the next reader "fixes" the inconsistency by wiring a connect path that doesn't exist.

### 6.4 Open item to settle before implementation

`text-yellow-500` for the connecting spinner appears in `SshDisconnectedDialog.tsx:148, 171` but **not** in `TerminalSshReconnectOverlay.tsx:152`. Grok copies the yellow, Codex refuses it. The repo is inconsistent, so STYLEGUIDE:290 applies ("diverging from a sibling needs a reason: either the sibling is wrong (fix both), or..."). My call: **Codex is right** — `--yellow-500` is a raw palette value, not a role token, and STYLEGUIDE reserves color for state while `connecting` is a transitional non-state. Use `text-muted-foreground` in the new control, and file removing the yellow from the dialog as a small follow-up so the three surfaces agree.

Also measure before merge: `--destructive` (`#ff6568` dark / `#e40014` light) at `text-[10px]` inside a card at `opacity-60`, over `--worktree-sidebar`, in **both** themes. This is the one contrast pair the hybrid inherits from Codex and it is the likeliest thing to fail review.
