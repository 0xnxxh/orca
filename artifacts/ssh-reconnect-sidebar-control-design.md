# Technical Design — Sidebar SSH reconnect control

**Status:** proposed
**Scope:** `src/renderer/src/ssh/`, `src/renderer/src/components/sidebar/`, `src/renderer/src/components/status-bar/SshTargetStatusRow.tsx`, `src/renderer/src/components/terminal-pane/TerminalSshReconnectOverlay.tsx` (renderer only; no main-process or IPC changes)
**Related artifact:** [`claude-opus-ssh-reconnect-judgment.md`](./claude-opus-ssh-reconnect-judgment.md) — the design comparison this doc implements

---

## 1. Problem

A worktree whose SSH host has dropped shows a red `ServerOff` glyph in the sidebar card. That glyph is a passive, non-focusable `<span>` (`WorktreeCard.tsx:1430–1452`) whose only affordance is a tooltip naming the problem: "SSH disconnected". There is no control.

Recovery today has three entry points, and each is indirect:

1. **Terminal pane overlay** (`TerminalSshReconnectOverlay`) — a banner with a `Connect` button, but only when a terminal is the active view in that worktree.
2. **A blocking modal** (`SshDisconnectedDialog`) opened as a *side effect of clicking the card* — and only when the active view is **not** a terminal (`WorktreeCard.tsx:880–883`).
3. **The sidebar host-header menu** — a `Reconnect` item on the host section row (`HostSectionHeaderMenu.tsx:242`, gated by `host-header-menu-items.ts:39`), reachable only by opening a kebab menu on the host header, not on the workspace the user is actually looking at.

Note also that the main process already runs an escalating auto-reconnect ladder (`ssh-connection.ts:1271–1291`, `RECONNECT_BACKOFF_MS` in `ssh-connection-utils.ts:34`, summing to ~103 s across 9 steps) and holds `reconnecting` throughout. This design therefore serves the states the ladder cannot fix on its own — `reconnection-failed`, `error`, `auth-failed`, and a `disconnected` target the ladder is not driving — and renders the ladder's own `reconnecting` as a disabled, labeled stage rather than a false invitation to click.

Three problems follow:

- **No per-workspace affordance.** A user scanning the sidebar sees which workspaces are down but can only act through a host-scoped kebab menu or by navigating into the workspace. The one control that names a *host* does not name the *workspace* the user is looking at.
- **A modal appears as a side effect of navigation.** Clicking a card to look at a workspace can pop a focus-stealing dialog. The card already carries a comment acknowledging how sharp this is: the dialog is deliberately never auto-opened because it "would steal app-wide focus" (`WorktreeCard.tsx:393`).
- **The paths disagree.** The overlay says `Connect`; the modal says `Reconnect`; the host menu says `Reconnect` for every failure state. The reconnectable-status predicate is duplicated in **four** files (§3) and is already free to drift.

## 2. Goals / Non-goals

**Goals**

- G1. A visible, keyboard-reachable reconnect control on any SSH worktree card in a user-recoverable state (`disconnected`, `reconnection-failed`, `error`, `auth-failed`), discoverable without hovering.
- G2. One status→verb vocabulary shared by the sidebar control, the terminal overlay, and the status-bar SSH row.
- G3. Correct behavior across all 8 `SshConnectionStatus` members, the `null` status, and the removed-target case.
- G4. Card click activates the workspace and nothing else — no modal as a navigation side effect.
- G5. No regression in sidebar density, measured: the widest verb pill must fit the title row at the default sidebar width without moving the point at which the workspace title begins to truncate (§6.3).

**Non-goals**

- N1. Runtime ("Orca server") host reconnect. Those cards render a visually identical `ServerOff` (`WorktreeCard.tsx:1455–1490`) but have no renderer-reachable connect API. Out of scope; §8 covers the comment that stops a future reader from "fixing" the inconsistency.
- N2. Auto-reconnect policy, backoff, or retry scheduling. The main-process ladder (§1) is unchanged; this control is manual and user-initiated only.
- N3. Changing `TerminalSshReconnectOverlay` behavior. Its copy aligns (§6.4); its logic does not move.
- N4. Multi-select / bulk reconnect across cards.

## 3. Current-state reference

Facts this design is built on, each verified against the tree at branch `ui-ssh-reconnect-judge`:

| Fact | Location |
| --- | --- |
| `SshConnectionStatus` has 8 members: `disconnected`, `connecting`, `auth-failed`, `deploying-relay`, `connected`, `reconnecting`, `reconnection-failed`, `error` | `src/shared/ssh-types.ts:102–110` |
| Reconnectable set `['disconnected','reconnection-failed','error','auth-failed']` is duplicated in **four** files | `SshDisconnectedDialog.tsx:60`, `TerminalSshReconnectOverlay.tsx:36`, `status-bar/SshTargetStatusRow.tsx:12`, `hooks/useIpcEvents.ts:2800` |
| A connecting-status predicate already has two shared homes with divergent signatures | `settings/ssh-target-action-state.ts:11` (`isSshTargetConnecting`), `lib/new-workspace-ssh-gate.ts:11` (`isSshConnectInProgress`, nullable) |
| `SshTargetStatusRow` renders a visible `Connect` button for every reconnectable status, so it is simultaneously visible with the sidebar and must share the verb set | `status-bar/SshTargetStatusRow.tsx:12` |
| `ssh.connect` has no built-in timeout; one renderer call site already wraps it | `NewWorkspaceComposerCard.tsx:217–236, 540` (`withUiConnectTimeout`) |
| The SSH glyph is gated on `repo?.connectionId`, **not** on a non-null status: with `sshStatus === null` the card renders a muted `Server` + "Project on SSH host" today | `WorktreeCard.tsx:1430–1452` |
| `sshStatus` is `null` for runtime-owned SSH targets, deliberately, to suppress a false "disconnected" | `WorktreeCard.tsx:352–358` |
| `sshOwnerEnvironmentId` and `sshTargetLabel` are already computed in the card; `selectRuntimeAwareSshTargetRemoved` is **not** yet read by the card (only by `TerminalPane.tsx:360`) | `WorktreeCard.tsx:349–351`, `:398–402` |
| `selectRuntimeAwareSshTargetRemoved` exists and only reports removal on positive evidence | `store/slices/runtime-environment-ssh.ts:307–336` |
| `selectRuntimeAwareSshTargetLabel` falls back to the raw target id, so the existing call site guards with `sshTargetLabel \|\| repo.displayName` | `runtime-environment-ssh.ts:295–305`, `WorktreeCard.tsx:1946` |
| Whole card dims to `opacity-60` when SSH or runtime is disconnected — applied to the **card root**, so CSS opacity composites the entire subtree and no descendant can opt out | `WorktreeCard.tsx:1892` |
| `compactCards` is `!newCardStyle && settings?.compactWorktreeCards === true` — it is never true under the new card style | `WorktreeCard.tsx:260–261` |
| Connect is **not** a bare `ssh.connect`: it branches on target owner, mirrors `setSshConnectionState`, and resyncs target metadata on failure (STA-1468) | `TerminalSshReconnectOverlay.tsx:91–137` |
| `WorktreeCard.tsx` is the only non-test consumer of `SshDisconnectedDialog`; **14** test files stub it (10 `WorktreeCard.*`, 4 `WorktreeList.*`) | grep over `src` |
| A comment in the deferred-PTY-reattach gate names the dialog as the user-driven connect path | `terminal-pane/pty-connection.ts:8216` |
| Existing contract: the dialog must not auto-open for a restored active disconnected worktree | `WorktreeCard.ssh-reconnect-prompt.test.tsx:147` |
| `Button` exposes both `xs` (h-6) and `icon-xs` (size-6) | `ui/button.tsx:23, 27` |
| No global `prefers-reduced-motion` rule exists: all 7 blocks in `main.css` are scoped to named component classes, none of which match `animate-spin` | `main.css:1544, 1607, 1725, 2254, 2334, 2687, 3184` |

**Precedent A — icon-only ghost action in a card row:** `MetadataActionIcon` is `Button variant="ghost" size="icon-xs" className="size-6"` + `stopPropagation` + Tooltip (`WorktreeCardMetadataControls.tsx:38–60`).

**Precedent B — compact *labeled* destructive action in the title row:** the "rename failed" control is a `Button variant="ghost"` at `h-4`, `text-[10px] font-medium`, `text-destructive border-destructive/40 bg-destructive/10`, icon `size-2.5`, with `onPointerDown={stopQuickActionPointerPropagation}` and a tooltip *in addition to* its visible label (`WorktreeCard.tsx:1523–1551`).

Precedent B is what licenses a labeled pill in the title row: it is a sibling, not an invention, and it settles that a tooltip beside a visible label is accepted here when the tooltip adds information the label doesn't.

## 4. Design overview

Replace the passive SSH `<span>` with a small state machine that renders **either** a non-interactive glyph **or** a labeled ghost button, and delete the modal path.

```
┌─ WorktreeCard title row ────────────────────────────────┐
│  [SSH control]  workspace title…            [badges]    │
└─────────────────────────────────────────────────────────┘

status === null             → <span> Server,   muted, tooltip only  (unchanged from today)
targetRemoved               → <span> ServerOff, muted, tooltip only
connected                   → <span> Server,    muted, tooltip only
connecting/relay/reconnecting → <Button disabled> ⟳ Connecting…
disconnected                → <Button> ⬛ Connect
error | reconnection-failed → <Button> ⬛ Retry        (destructive tint)
auth-failed                 → <Button> ⬛ Reconnect    (destructive tint)
```

Three principles:

1. **A button exists only when pressing it does something.** Non-actionable states render a `<span>`, matching today's semantics. A `<button disabled>` used as decoration is worse than a span: it leaves the tab order, so its tooltip becomes keyboard-unreachable.
2. **The verb is the label.** `Connect` / `Retry` / `Reconnect` / `Connecting…` are visible text, not tooltip content. STYLEGUIDE:159–162 reserves tooltips for *naming* a control and puts anything the user must read while acting into visible UI.
3. **The label is a progressive enhancement.** Under density pressure it degrades to an icon-only form with an `sr-only` label. Layout never depends on the label fitting (§6.3).

### 4.1 Alternatives considered

**Label the host-header row instead of each card.** The connection status this control reads is `repo.connectionId`-scoped (`WorktreeCard.tsx:352–358`), so every card sharing a host shows the same status and every pill invokes the same connection-level connect. Putting one labeled control on the host header row — which already renders a disconnected glyph and buries `Reconnect` in a menu (`WorktreeList.tsx:844–878`) — would deliver "act without navigating in" with a single control, and would sidestep both of this design's top risks (10 px destructive text under `opacity-60`; title truncation).

Rejected as the *primary* affordance because the sidebar is scanned per workspace, not per host: the user's unit of attention is the dimmed card whose agent has stalled, and G1 is specifically about acting on the thing they are already looking at. A host-scoped control also disappears from view when the host section is collapsed, while the affected cards may still be visible under a different grouping. The two are complementary, and §6.4 aligns the host menu's verb rather than leaving it to drift; adding a labeled control to the host row is a reasonable follow-up, not a substitute.

**Keep the modal and make it reachable deliberately.** Rejected: a blocking dialog for a one-click operation is the wrong weight, and the focus-steal hazard is already documented in the card (`WorktreeCard.tsx:393`).

## 5. Component design

### 5.1 New module: shared status classification

`src/renderer/src/ssh/ssh-connection-recoverability.ts`

```ts
import type { SshConnectionStatus } from '../../../shared/ssh-types'

// Why: a Record keyed by the union makes a 9th member a typecheck failure, not a
// silent fall-through to "not recoverable". A `.includes([...])` array cannot.
const CONNECTING: Record<SshConnectionStatus, boolean> = { /* … */ }
const CAN_CONNECT: Record<SshConnectionStatus, boolean> = { /* … */ }

export function isConnectingSshStatus(status: SshConnectionStatus | null): boolean
export function canConnectSshStatus(status: SshConnectionStatus | null): boolean
```

Named for what it classifies, not for its role — no `ssh-utils`.

**Exhaustiveness is enforced by the typechecker, not by tests.** The doc's earlier claim that "unit tests over all 8 members" catch a 9th member was wrong: a test enumerating 8 known members still passes when a 9th appears. A total `Record<SshConnectionStatus, boolean>` fails `pnpm typecheck` the moment the union grows. Unit tests remain as regression coverage for the classification itself.

**Single source, actually.** All four current copies of the reconnectable set are migrated: `TerminalSshReconnectOverlay.tsx:36`, `status-bar/SshTargetStatusRow.tsx:12`, `hooks/useIpcEvents.ts:2800`, and the new control. (`SshDisconnectedDialog.tsx:60` is *not* migrated — that file is deleted in §6.5; migrating it first would be discarded work.) The two existing connecting-status helpers, `isSshTargetConnecting` (`settings/ssh-target-action-state.ts:11`) and `isSshConnectInProgress` (`lib/new-workspace-ssh-gate.ts:11`), are reduced to one-line delegations to `isConnectingSshStatus` so the new module does not become copy five. Their exported names and signatures are unchanged, so no caller moves.

Out of scope: `pty-connection.ts:821` encodes a different, narrower triple (`auth-failed | error | reconnection-failed`, without `disconnected`) for a different purpose and is left alone.

### 5.2 New module: shared in-flight connect registry

`src/renderer/src/ssh/ssh-connect-in-flight.ts`

```ts
export function beginSshConnect(targetId: string): void
export function endSshConnect(targetId: string): void
/** Subscribes via useSyncExternalStore so every card on the same host re-renders. */
export function useSshConnectInFlight(targetId: string): boolean
```

**Why this is not component-local state.** The risk table previously claimed that a sidebar click and a terminal-overlay click "cannot double-fire" because both read the same store status and disable on `isConnecting`. That was false: each surface held its own `useState`, and the store status stays `disconnected` until the main process broadcasts `connecting` one IPC hop later (`ssh-connection.ts:656`). The window is wider at startup, where timed-out eager targets are left marked disconnected while a connect is still running (`App.tsx:1019`).

It also matters per-host, not just per-surface: N cards on one disconnected host each render an armed pill for the same connection-level connect. For passphrase-gated targets — deliberately excluded from startup reconnect and therefore left in `disconnected` (`App.tsx:995`, `pty-connection.ts:8198`) — N clicks would fan out to N credential prompts. A registry keyed by `targetId` means the first click disables every pill for that host, and both surfaces read the same flag.

### 5.3 New component

`src/renderer/src/components/sidebar/WorktreeCardSshHostControl.tsx`

Colocated with the card and named for the concrete thing it renders. `WorktreeCard.tsx` is 1967 lines and under a `max-lines` ratchet (`pnpm run check:max-lines-ratchet`); this logic must not be inlined there.

```ts
type WorktreeCardSshHostControlProps = {
  targetId: string
  /** Card passes `sshTargetLabel || repo.displayName` — the raw selector can return a bare target id. */
  targetLabel: string
  /** Null for runtime-owned targets; renders the passive connected glyph, as today. */
  status: SshConnectionStatus | null
  targetRemoved: boolean
  /** Non-null when the SSH target belongs to a remote Orca server; routes connect to that runtime. */
  sshOwnerEnvironmentId: string | null
  /** True when the row cannot afford a visible label: render icon-only with an sr-only label. */
  iconOnly: boolean
  onPointerDown: React.PointerEventHandler<HTMLButtonElement>
}
```

`status` is nullable because §5.4's null row is the component's responsibility, and because `onPointerDown` must be assignable from the existing `stopQuickActionPointerPropagation`, which is typed `(event: React.PointerEvent<HTMLButtonElement>) => void` (`WorktreeCard.tsx:1050`) and would not satisfy a widened `React.PointerEvent` parameter under `strictFunctionTypes`.

The component owns the connect call and reads its in-flight flag from §5.2. It does **not** own the card's `opacity-60` dimming (`WorktreeCard.tsx:1892`) — see §7.

### 5.4 State table

| `status` | Element | Icon | Visible label | Tooltip | Accessible name |
| --- | --- | --- | --- | --- | --- |
| `null` (runtime-owned) | `<span>` | `Server size-3 text-muted-foreground` | none | "Project on SSH host" | from `sr-only` text |
| `connected` | `<span>` | `Server size-3 text-muted-foreground` | none | "Project on SSH host {label}" | from `sr-only` text |
| `connecting`, `deploying-relay`, `reconnecting` | `<Button disabled>` | `Loader2 size-2.5 animate-spin motion-reduce:animate-none` | `Connecting…` | host + status | "Connecting to SSH host {label}" |
| `disconnected` | `<Button>` | `ServerOff size-2.5` | `Connect` | "Connect to SSH host {label}" | same |
| `error`, `reconnection-failed` | `<Button>` destructive tint | `ServerOff size-2.5` | `Retry` | "{label} · connection failed" | "Retry SSH connection to {label}" |
| `auth-failed` | `<Button>` destructive tint | `ServerOff size-2.5` | `Reconnect` | "{label} · authentication failed" | "Reconnect SSH host {label} — authentication failed" |
| `targetRemoved` (overrides any status) | `<span>` | `ServerOff size-2.5 text-muted-foreground` | none | "SSH host removed — reconnect unavailable" | from `sr-only` text |

The `null` row renders the muted connected glyph, **not** nothing. Today's glyph is gated on `repo?.connectionId` alone (`WorktreeCard.tsx:1430–1452`), so a runtime-owned card with `sshStatus === null` currently shows `Server` + "Project on SSH host". Rendering nothing there would silently delete that indicator from every runtime-owned card, and from any card whose runtime environment has not yet hydrated.

`targetRemoved` is checked **first**. A removed host can never connect, so offering `Connect` there reproduces exactly the bug `targetRemoved` was introduced to prevent (`TerminalSshReconnectOverlay.tsx:19–21, 88–89`). It also drops the destructive tint — a removed host is a settled fact, not an error to act on. Unlike the overlay, the sidebar control does not offer "Remove workspace" in this state: the card's own context menu already owns workspace deletion, and a delete action inside a status glyph is too easy to hit by accident.

`Connecting…` is a labeled stage rather than a bare spinner, per STYLEGUIDE:188 ("prefer a label that names the stage over an unlabeled spinner").

### 5.5 Styling

One shape for every state, taken from Precedent B (`WorktreeCard.tsx:1535`) — the closest sibling in this exact row. States differ only by color token, so the control never changes height as status changes.

Failure states, verbatim from Precedent B:

```
h-4 shrink-0 gap-0.5 rounded !px-0.5 text-[10px] font-medium leading-none
text-destructive border border-destructive/40 bg-destructive/10
hover:bg-destructive/15 hover:text-destructive has-[>svg]:!px-0.5
```

Non-failure interactive/disabled states — Precedent B's geometry with the color tokens of the lineage-toggle sibling (`WorktreeCard.tsx:1780`, which is itself `h-[18px] rounded-md px-1.5`; its dimensions are deliberately **not** adopted, so the pill cannot change height between a failure and a connecting state):

```
h-4 shrink-0 gap-0.5 rounded !px-0.5 text-[10px] font-medium leading-none
text-muted-foreground border border-worktree-sidebar-border bg-worktree-sidebar
hover:bg-worktree-sidebar-accent hover:text-foreground shadow-none
focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring has-[>svg]:!px-0.5
```

Decisions:

- **No new tokens.** `--destructive`, `worktree-sidebar*`, `muted-foreground`, `ring` only.
- **`text-destructive`, not `text-red-400`.** The card currently uses raw `red-400` for the passive glyph, but `destructive` is the documented role for error states (STYLEGUIDE:39) and is what the adjacent rename-error control already uses. Both `ServerOff` glyphs in this file move to `text-destructive` — the SSH glyph at `WorktreeCard.tsx:1435` and the runtime glyph at `:1460`. The runtime change is token hygiene only; it stays a passive span with no connect path, consistent with N1.
- **No yellow.** The connecting spinner inherits `text-muted-foreground`. `--yellow-500` is a raw palette value, not a role token, and `connecting` is a transient rather than a state worth spending color on. This diverges from `SshDisconnectedDialog.tsx:148, 171`; STYLEGUIDE:290 requires resolving a divergence from a sibling rather than duplicating it, and the resolution here is that the dialog is retired (§6.5).
- **Tooltip:** Radix `TooltipContent side="right" sideOffset={8}`, matching every other tooltip in this file. Never hand-positioned — the sidebar clips overflow.

## 6. Interaction contract

### 6.1 Control activation

- `onPointerDown={stopQuickActionPointerPropagation}` (`WorktreeCard.tsx:1050`) — sidebar activation begins on pointer-down, so stopping only `click` is too late.
- `onClick`: `event.stopPropagation()` then `event.preventDefault()`, then connect. **The worktree is not activated.** Reconnecting a host and navigating to a workspace are separate intents.
- Keyboard: it is a native `<button>`, so Enter/Space activate it and it is tabbable independently of the card. No custom key handling.

### 6.2 Connect operation

A direct port of `TerminalSshReconnectOverlay.handleConnect` (`:91–137`), with the in-flight flag lifted to §5.2 and a UI timeout added. This sequence is load-bearing and must not be paraphrased:

1. Return early if `useSshConnectInFlight(targetId)` is already true, or the status is a connecting transient.
2. `beginSshConnect(targetId)` **before** any IPC — every pill for this host must disable within the frame, not after a 50–200 ms SSH round trip.
3. If `sshOwnerEnvironmentId` → `await connectRuntimeEnvironmentSshTarget(sshOwnerEnvironmentId, targetId)`.
4. Else → `const state = await withUiConnectTimeout(window.api.ssh.connect({ targetId }))`; **if `state`, call `setSshConnectionState(targetId, state)`.** `ssh.connect` can resolve before the state-change IPC lands, and the deferred PTY reattach path keys off this store value. Omitting the mirror silently breaks terminal resume. `withUiConnectTimeout` is promoted out of `NewWorkspaceComposerCard.tsx:217–236` into `src/renderer/src/ssh/`, unchanged, and both call sites import it: `ssh.connect` has no built-in timeout, and a stall on a passphrase-gated target would otherwise leave the pill reading `Connecting…` forever with no way to retry.
5. On throw (including timeout) → `toast.error(message)` **and** resync target metadata: `resyncRuntimeEnvironmentSshTargets(sshOwnerEnvironmentId)` for the runtime path, or `ssh.listTargets()` + `ssh.listRemovedTargetLabels()` applied in that order for the local path. Without this, a vanished target keeps offering the same failing `Connect` forever (STA-1468); with it, the control converges to the removed state.
6. `finally` → `endSshConnect(targetId)`. This is registry state rather than component state, so it must clear even if the card unmounted; `useMountedRef` still guards any component-local `setState`. Sidebar rows unmount under virtualization while a connect is in flight.

### 6.3 Density and truncation

- The control is `shrink-0`; the title keeps `min-w-0 truncate` and yields first. This is the existing title-row contract and is unchanged.
- The label slot carries a reserved `min-w` sized to the widest verb (`Connecting…`) so a remote status transition cannot jitter the row mid-connect.
- **Icon-only fallback.** `iconOnly` is set by the card when `compactCards || newCardStyle` (`WorktreeCard.tsx:260–261`). Keying on `compactCards` alone would make the fallback unreachable under the new card style — the mode that already packs a repo-identity chip and title-row indicators into this same row (`:1185`, `:1206`), and therefore the mode with the least room for a label. The fallback keeps the `h-4` geometry with a `size-4` override on `size="icon-xs"` (whose default `size-6` is 24 px and would make the densest mode the tallest); only the visible label and horizontal padding drop. Same component, same handler, same accessible name.
- **G5 is measured, not asserted.** Before merge: at the default sidebar width, compare the title's truncation point on an SSH-disconnected card against the same card with the control suppressed, in both the default and new card styles. A shift means the fallback threshold is wrong.

### 6.4 Verb alignment (copy only)

Two other surfaces render a reconnect verb and are visible at the same time as the sidebar:

- `TerminalSshReconnectOverlay` reads `Connect` for every reconnectable status. Align it to `Connect` / `Retry` / `Reconnect`. Its logic, layout, and `role="status"` live region are untouched (N3).
- `HostSectionHeaderMenu`'s `ssh-reconnect` item (`:242`) reads `Reconnect` for every failure state, gated only on a `connected` boolean (`host-header-menu-items.ts:39`). Align it through the same predicates, so a card reading `Retry` and the host menu directly above it do not describe the same click differently.

`SshTargetStatusRow` also renders a visible `Connect` for every reconnectable status; its predicate is migrated in §5.1 and its label follows the same verb set.

### 6.5 Removing the modal path

- Delete the `if (isSshDisconnected && !activeViewIsTerminal) setShowDisconnectedDialog(true)` branch (`WorktreeCard.tsx:880–883`), the `showDisconnectedDialog` state (`:394`), the render site (`:1944–1950`), and the now-unused `activeViewIsTerminal` selector (`:366–368`).
- `WorktreeCard.tsx` is the only non-test consumer, so `SshDisconnectedDialog.tsx` becomes dead and is deleted. **14** test files stub it — 10 `WorktreeCard.*` specs and 4 `WorktreeList.*` specs (`lineage-child-card.test.ts`, `lineage-child-real-card.test.tsx`, `lineage-agent-expansion-coupling.test.tsx`, `status-lane-lineage-drop.test.tsx`); 13 have their mock removed and 1 is rewritten (below). A stale `vi.mock` pointing at a deleted module fails resolution, so missing one is a red CI run, not a silent leftover.
- Update the stale comment at `pty-connection.ts:8216`, which names `SshDisconnectedDialog` as the user-driven connect path the deferred PTY reattach gate waits on. The gate's contract is unchanged — the sidebar control and the overlay both satisfy it — but the comment must name a component that exists. `AutoRenameFailedDialog.tsx:29, 153` also references the dialog as a pattern sibling; retarget those to the surviving sibling.
- **This is a deliberate behavior removal and must be called out in the PR body, not filed under "refactor."** Specifically: the dialog carries a window-capture Enter handler (`:118–140`) that exists because focus lives inside xterm/Monaco and dialog-scoped handlers never fire. Users who press Enter to reconnect lose that. The replacement is the sidebar control plus the terminal overlay, both of which are on-screen and focusable. The signal that this mattered is any reconnect-related report in the first release after landing; the response is to add Enter-to-connect to the overlay, not to resurrect the modal.
- `WorktreeCard.ssh-reconnect-prompt.test.tsx:147` asserts the dialog does not *auto*-open. That assertion is superseded by the stronger one — a card click never opens a reconnect dialog — and is rewritten, not deleted, so the intent stays recorded.

## 7. Accessibility

- Native `<button>`, tabbable independently of the card, Enter/Space via platform default.
- `aria-label` always includes the action **and** the host label, using the card's guarded label (`sshTargetLabel || repo.displayName`) so a screen reader never announces a raw `ssh-<ts>-<rand>` id.
- Non-actionable states render a `<span>` carrying `sr-only` text, preserving today's semantics rather than parking an unfocusable disabled button in the row.
- `aria-busy="true"` while connecting.
- One `aria-live="polite"` `sr-only` region per card, updated **only on status transitions** — not per render, which would spam.
- Focus-visible uses `ring-worktree-sidebar-ring`; state is never conveyed by color alone (icon + verb carry it).
- **Reduced motion:** `main.css` has no global rule covering `animate-spin` — all 7 of its `prefers-reduced-motion` blocks are scoped to named component classes. The spinner therefore carries `motion-reduce:animate-none` explicitly. A repo-wide `.animate-spin` rule is deliberately not added here; it would change every other spinner in the app and belongs in its own change.
- **Contrast gate:** `--destructive` (`#ff6568` dark / `#e40014` light) at `text-[10px]` inside a card at `opacity-60`, over `--worktree-sidebar`. Measure in both themes before merge. This is the likeliest thing to fail review. If it fails, the remedy is **not** "exempt the control": `opacity-60` sits on the card root (`WorktreeCard.tsx:1892`) and CSS opacity composites the whole subtree, so no descendant can opt out. The remedy is to move the disconnected dim off the root onto the content children that should dim (title, badges, metadata rows), leaving the SSH control at full opacity. That is a real change to a shared card style and must be reviewed as one, not slipped in as a tweak.

## 8. Cross-cutting constraints

- **Runtime hosts:** the `ServerOff` block at `WorktreeCard.tsx:1455–1490` stays passive (N1); only its color token changes (§5.5). Land a comment there stating *why* two visually identical glyphs now behave differently, or the next reader wires a connect path that does not exist.
- **Folder workspaces:** the control keys off `repo?.connectionId`, which is repo-level and orthogonal to whether the workspace is a git worktree or a folder. No branch needed, but the tests cover a folder workspace on an SSH host explicitly.
- **SSH latency:** every state change is optimistic-then-reconciled — disable on click, reconcile from the store. Verified under simulated latency, not just locally (STYLEGUIDE:304).
- **Cross-platform:** no modifier keys, no platform-conditional labels, no new shortcuts. Nothing platform-specific in this change.
- **i18n:** all five strings go through `translate()` with `auto.components.sidebar.WorktreeCardSshHostControl.*` keys, then `pnpm run sync:localization-catalog`. Locale files are never hand-edited or reverted via git.

## 9. Testing

`WorktreeCardSshHostControl.test.tsx`:

1. Renders the muted `Server` glyph and "Project on SSH host" tooltip when `status` is `null` — the today-behavior guard.
2. Renders a non-button `<span>` when `connected`; when `targetRemoved`; and for `targetRemoved` **while** `status` is reconnectable (precedence check).
3. Renders a disabled button with `Connecting…` and `aria-busy` for each of `connecting`, `deploying-relay`, `reconnecting`.
4. Renders the right verb for each of `disconnected` → `Connect`, `error`/`reconnection-failed` → `Retry`, `auth-failed` → `Reconnect`.
5. Click calls `window.api.ssh.connect` and mirrors via `setSshConnectionState`.
6. Click with `sshOwnerEnvironmentId` routes to `connectRuntimeEnvironmentSshTarget` and never touches `window.api.ssh`.
7. Failure path toasts **and** resyncs target metadata; the local path applies `listTargets` before `listRemovedTargetLabels`.
8. Two controls mounted for the same `targetId`: clicking one disables both and issues exactly one `ssh.connect` (§5.2 registry).
9. A connect that never settles resolves through `withUiConnectTimeout` into the failure path, re-enabling the control.
10. Unmount mid-connect does not warn or set state, and still clears the registry entry.
11. `iconOnly` renders icon-only with an unchanged accessible name and unchanged height.
12. Accessible name includes the host label in every actionable state, and falls back to the display name rather than a raw target id.

`ssh-connection-recoverability.test.ts`: both predicates over all 8 union members plus `null`, as regression coverage. Union growth is caught by the typechecker (§5.1), not here.

`ssh-connect-in-flight.test.ts`: begin/end pairing, subscriber notification, and that `end` is idempotent.

`WorktreeCard.ssh-reconnect-prompt.test.tsx` (rewritten): card click activates and never opens a reconnect dialog; pointer-down on the control does not activate the workspace; the control appears for an SSH-disconnected folder workspace.

`TerminalSshReconnectOverlay.test.tsx`: extended for the aligned verb set; existing tests remain the protocol contract for the connect sequence.

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Destructive text at 10 px inside a 60%-opacity card fails contrast | Measured in both themes before merge (§7). Remedy is relocating the dim off the card root — a descendant cannot escape ancestor opacity — and is scoped as a reviewed change, not a tweak |
| Visible label truncates the workspace title at narrow sidebar widths | `shrink-0` control + `min-w-0 truncate` title; icon-only fallback under both compact and new card styles; truncation point measured before merge (§6.3) |
| Deleting the modal removes Enter-to-reconnect for xterm/Monaco-focused users | Called out explicitly in the PR body; overlay is the documented follow-up home for that binding (§6.5) |
| Reconnect from the sidebar while a terminal shows the overlay double-fires, or N cards on one host fan out N passphrase prompts | Shared in-flight registry keyed by `targetId` (§5.2), set before the IPC. Store status is not sufficient: it lags by one IPC hop |
| A stalled connect leaves the pill on `Connecting…` with no retry | `withUiConnectTimeout` around `ssh.connect` (§6.2 step 4) |
| A 9th `SshConnectionStatus` member falls through as unrecoverable | Total `Record<SshConnectionStatus, boolean>` — a typecheck failure, not a test that would still pass (§5.1) |
| `max-lines` ratchet on `WorktreeCard.tsx` | Net line count falls: ~44 lines of glyph and dialog wiring leave the file against ~22 added (control invocation plus the `targetRemoved` subscription). Verified by `pnpm run check:max-lines-ratchet`, not by estimate |

## 11. Rollout

Single PR, no feature flag — the change is a visible affordance plus a removal, and a flag would leave two reconnect models alive at once. The footprint is larger than the affordance suggests (two new modules, one new component, a component deletion with 14 mock updates, and verb alignment across three other surfaces), so the PR body leads with a file-by-file map. Landing order:

1. `ssh-connection-recoverability.ts` + `ssh-connect-in-flight.ts` + tests; promote `withUiConnectTimeout` into `src/renderer/src/ssh/`. Migrate `TerminalSshReconnectOverlay`, `SshTargetStatusRow`, `useIpcEvents`, and reduce `isSshTargetConnecting` / `isSshConnectInProgress` to delegations. `SshDisconnectedDialog` is **not** migrated — it is deleted in step 4.
2. `WorktreeCardSshHostControl.tsx` + tests.
3. Wire it into `WorktreeCard.tsx`, replacing the passive SSH `<span>`. This adds a `targetRemoved = selectRuntimeAwareSshTargetRemoved(...)` subscription the card does not have today (§3), alongside the existing `sshOwnerEnvironmentId` / `sshTargetLabel` selectors, and passes `sshTargetLabel || repo.displayName`.
4. Remove the modal path; delete `SshDisconnectedDialog.tsx`; drop its mock from 13 specs and rewrite `WorktreeCard.ssh-reconnect-prompt.test.tsx`; retarget the stale comments in `pty-connection.ts:8216` and `AutoRenameFailedDialog.tsx`.
5. Align verbs in the overlay and `HostSectionHeaderMenu`.
6. Measure the two gates: title-truncation parity (§6.3) and destructive-token contrast in both themes (§7).
7. `sync:localization-catalog`; then `lint`, `typecheck`, unit tests, and the sidebar e2e spec.
