# Brief: redesign the "Create worktree" project picker

## The problem

The Project field in the Create-worktree composer (`src/renderer/src/components/new-workspace/ProjectCombobox.tsx`) feels **bulky** and **unpolished**. That's the whole mandate. Read the shipped component first — you're replacing it.

Concretely, what "bulky" and "unpolished" mean here:

- **Bulky:** a label row + an add-project icon button + a 36px full-width outline trigger + a chevron, all spent before the user has chosen anything. Then a 288px popover with its own search field, its own empty state, and a pinned footer button. Two-line rows (name over detail) make even a modest list scroll. The overwhelmingly common case — picking the project you use every day — costs a click, a visual scan, and another click.
- **Unpolished:** the trigger shows a bare dot + name while rows show dot + name + a second line of detail, so the same project reads differently in two places. Selection state is a checkmark column that's empty for every row but one. There is no notion of recency, no grouping, and no keyboard hint. `Escape`/focus handoff works but nothing communicates it.

## Your deliverable

**Exactly two designs**, in **one file**: `tools/wt-picker-lab/variants/design-<your-slug>.tsx`.

It must `export default` an array of two `DesignVariant` objects (see `tools/wt-picker-lab/design-contract.ts`). The registry auto-discovers your file via `import.meta.glob` — **do not edit `registry.ts`**, and do not touch any file outside your own variant file. Other agents are working in this same worktree in parallel.

```tsx
import type { DesignVariant } from '../design-contract'
const variants: DesignVariant[] = [
  { id: 'yourslug-a', title: '…', tagline: '…', notes: ['…'], Component: DesignA },
  { id: 'yourslug-b', title: '…', tagline: '…', notes: ['…'], Component: DesignB }
]
export default variants
```

`id` must be globally unique — prefix both with your assigned slug. `notes` is 3–4 bullets saying what the design does about _bulky_ and _unpolished_, and what it trades away.

## Hard requirements

1. **Drop-in contract.** Your components take `ProjectPickerProps` and must work as a straight replacement for `ProjectCombobox` in `NewWorkspaceComposerCard.tsx`. Honour `value`, `onValueChange`, `onValueSelected` (fires after a pick — the real card moves focus to the name field), `onAddProject`, `placeholder`, `invalid`, `describedBy`. You may ignore `triggerClassName` if your design has no trigger, but say so in `notes`.
2. **Actually interactive.** Real selection, real filtering, real keyboard support. No static mockups, no `alert()`. Arrow keys / Enter / Escape must behave sanely, and a pointer user must be able to do everything a keyboard user can.
3. **Design system.** Follow `docs/STYLEGUIDE.md`. Use the shadcn primitives in `src/renderer/src/components/ui/` and the tokens in `src/renderer/src/assets/main.css`. **No new hex values** — use `bg-accent`, `text-muted-foreground`, `border-border`, `ring`, etc. Icons from `lucide-react` only. Reuse `RepoBadgeLabel` / `RepoBadgeMark` from `@/components/repo/RepoBadgeLabel` for project identity.
4. **Both themes.** Verify light _and_ dark. The popover/dialog recipes in `ui/popover.tsx` and `ui/dialog.tsx` show how surfaces are meant to read in dark mode.
5. **Cross-platform.** Never hardcode `metaKey` — `const isMac = navigator.userAgent.includes('Mac')`. Shortcut chips must match the real binding per platform.
6. **Handle the real data.** `tools/wt-picker-lab/fixtures.ts` has 13 options: provider-backed projects (`orca-labs/orca`), duplicate display names disambiguated only by their `detail` line (`scratch` × 2), a "3 hosts configured" project, and two `kind: 'project-group'` folder groups. Folder groups are a different kind of thing than repos and use `FolderOpen`. Long names must truncate, not wrap. `LAB_RECENT_PROJECT_IDS` is available if your design uses recency.
7. **Degenerate cases.** One project. Zero projects (the composer shows "Add a project before creating a workspace." underneath — your empty state shouldn't duplicate that). A search that matches nothing. `Add a new project` must stay reachable in every state, including no-matches.
8. **SSH/latency.** Assume the option list may arrive late and selection may be slow. Don't design something that only feels right at 0ms.

## Explore, don't converge

Your two designs should be **genuinely different from each other** — not one design and its slightly-restyled twin. Push on the real question: _does this need to be a form field with a popover at all?_ Some directions worth considering (not a checklist): collapsing project into an existing control, showing the common case with zero interaction, deferring search until the list is actually long, treating project as context rather than input, or making the whole composer one surface instead of three stacked fields.

Prefer a sharp, opinionated design that could be wrong over a safe one that changes nothing. The point of this round is range. If a design has a real cost (loses discoverability, needs a new store field, only works for ≤N projects), say so plainly in `notes` — that's useful, not disqualifying.

## Verify before you finish

A dev server is already running — **do not start your own**, and do not restart or kill it:

```
http://127.0.0.1:5200/
```

Pick your design in the left rail, then check it renders, filters, and keyboard-navigates in both themes. Screenshot with the repo's bundled Playwright:

```js
import { chromium } from '/Users/nwparker/orca/workspaces/orca/wt-search-v2/node_modules/playwright-core/index.mjs'
```

Watch the browser console — a runtime error in your file will surface there. Also confirm you introduced **no TypeScript errors** in your file.

Your final message back should be short: the two ids, one line each on the idea, and anything you deliberately traded away.
