# Persistence half-refactor plan

Status: implemented and independently reviewed; final `persistence.ts` size is 3,644 lines.

## Plan reviewer verdict

**APPROVED WITH REQUIRED CORRECTIONS BELOW.** The ownership boundary is sound only if the load pipeline returns data/dirty flags and `Store` remains the sole writer of its fields, timers, promises, listeners, and cache flags. Phase 3 is required, not optional: the source has only about 2,500 lines between the imports and `Store`, and the 792-line `load` can realistically shed about 570–650 lines while retaining recovery I/O/control flow, so reaching 3,800 requires all three measured Store-operation clusters (automation, project, and lineage) unless `wc -l` proves another complete extraction already supplied the same margin.

Reviewer-required gates:

- Treat pane identity migration as an **impure closed adapter**, not a pure helper cluster. `collectMigrationUnsupportedPtyEntries` currently calls `agentHookServer.registerPaneKeyAlias` synchronously. Move that dependency with the cluster and preserve the call timing/order, or inject the exact call as a callback at the same sites; do not redesign it into deferred registrations during this refactor.
- Do not split mutually recursive or ordered pane functions merely at the proposed filename boundaries. First make the actual call graph one-way; if a proposed lower layer must import upward, merge or repartition it. No extracted `persistence-*` file may import `./persistence`.
- Count physical destination LOC **after imports and comments**. The 260–280 estimates are ceilings for whole files, not body budgets; split earlier when an import-heavy module would cross 299.
- Keep backup retry/restore and the assignment of `this.loadNeedsSave`/`this.githubCacheDirty` in `Store.load`. Extracted load stages return flags. Do not replace the current ordered dirty assignments with a deferred callback whose exception or invocation timing can change recovery behavior.
- Do not claim the target from estimated volume. Record `wc -l` after every phase. If Phase 1 + load + project + automation still exceeds 3,800, extract the complete lineage cluster; if still above target, select another complete Store method cluster rather than splitting a live owner or stopping.
- Preserve public type/value imports through `persistence.ts`. Use `export { ... } from` for moved values, and keep `StoreOptions`/`PtyBindingSourceExpectation` stable without creating a runtime cycle.

## Baseline and target

- `src/main/persistence.ts`: 7,716 physical lines at inventory time.
- Hard target: at most 3,800 physical lines in that file; planned landing range is 3,250–3,650.
- Preserve the `./persistence` public surface (`Store`, `StoreOptions`, `PtyBindingSourceExpectation`, `initDataPath`, `getCanonicalUserDataPath`, `migrateMobilePairingDataToCanonicalUserDataPath`, `normalizeRightSidebarTab`) with re-exports where needed.
- Every new production file must remain below the default 300-line rule without a disable or budget change. Budget below means physical lines including imports/comments; stop around 260–280, not 299.

## Boundary rule

`Store` remains the sole owner of `state`, write generations, timers, pending promises, secret persistence, snapshot storage, listeners, and cache flags. Do not move one map/timer or introduce a second live owner. Extracted Store operations receive an explicit narrow context (state plus named callbacks) and return updated values/dirty flags; the class keeps scheduling, listener dispatch, write ordering, and field assignment. Prefer literal cut/paste into named functions and one-line Store delegates. Do not use prototype mutation, declaration-merging mixins, or circular imports back to `persistence.ts`.

For extracted code that currently writes `this.loadNeedsSave`, return `{ state, needsSave }` (or accept a local `markNeedsSave` callback) and OR it into the class field at one boundary. For ordinary mutations, a context such as `{ state, scheduleSave, notifyUIChanged, notifySettingsChanged }` is acceptable; it must not own state. Keep public methods on `Store` as thin delegates so all callers and type-only imports remain stable.

## Extraction inventory

### Phase 1: pure and closed top-level clusters (about 2,400–2,650 lines removed)

1. `persistence-user-data-path.ts` (~105 lines)
   - Move captured path fields and the complete cluster `initDataPath`, internal data-file lookup, `getCanonicalUserDataPath`, and mobile-pairing copy migration.
   - Export the data-file accessor only to persistence internals; re-export the existing public functions from `persistence.ts`.
   - Dependency risk: Electron `app` timing is load-bearing. Preserve lazy/captured evaluation exactly and do not replace it with a module constant.

2. `persistence-worktree-metadata-normalization.ts` (~150 lines)
   - Move `gcStaleWorktreeMeta`, `normalizeWorktreeLinkedItemMetadata`, and constants.
   - Dependencies: workspace keys, repo execution host, WSL/Windows path guards, linked-item/source-context normalizers.
   - Keep the local/SSH/WSL gates byte-for-byte; never probe remote paths.

3. `persistence-workspace-session-salvage.ts` (~105 lines)
   - Move patch-full-normalization key test, salvage log details, per-host partition parser, and partition-owner helpers that do not touch Store.
   - Dependencies: `parseWorkspaceSessionSalvaging`, host normalization/default session types.

4. `persistence-settings-migrations.ts` split into three files, each ~220–275 lines:
   - `persistence-terminal-settings-migrations.ts`: legacy scrollback rows/bytes, TUI sensitivity, agent launch defaults, workspace-dir history.
   - `persistence-floating-workspace-normalization.ts`: `expandFloatingWorkspaceHomePath` through trusted-CWD normalization.
   - `persistence-settings-value-normalization.ts`: notification, onboarding-load, sidebar/setup-guide and small settings normalizers.
   - `retireLegacyInstructionsForClearedTextActionRecipes` may live in `persistence-source-control-settings.ts` (~90 lines) rather than making any file exceed budget.

5. `persistence-ui-normalization.ts` split into two files (~190 and ~180 lines):
   - `persistence-ui-selection-normalization.ts`: group/sort/project-order/sidebar/explorer/dotfile normalization; re-export `normalizeRightSidebarTab` from `persistence.ts`.
   - `persistence-ui-interaction-merge.ts`: feature-interaction merge, contextual-tour merge, reserved telemetry-marker stripping, lineage-map normalization.

6. Automation normalizers in two files (~180 and ~190 lines):
   - `persistence-automation-run-normalization.ts`: workspace name, pane key/PTY id, output snapshot, precheck, session reuse/setup decision.
   - `persistence-automation-context-migration.ts`: context derivation, scheduler ownership and legacy context backfill.
   - Dependency direction is shared types/shared automation modules only; neither imports Store.

7. Repo/project compatibility in three files (~210–270 each):
   - `persistence-repo-sanitization.ts`: upstream/remote identity/setup method/fork mode/update sanitization and hydration-safe value normalization.
   - `persistence-project-host-compatibility.ts`: equality, repo-backed test, merge/projection compatibility state, ID construction.
   - `persistence-folder-scope-migration.ts`: folder connection inference and backfill.
   - Avoid a repo↔project-host cycle by placing the shared compatibility record operations in the latter and passing sanitized repos into it.

8. Pane/session identity migration, currently roughly lines 1,677–2,467 (~790 lines), split in source-order closed layers. This is an impure adapter because normalization synchronously registers aliases with `agentHookServer`:
   - `persistence-terminal-layout-normalization.ts` (~255): layout leaf count/order/clone/remap/equality/preservation.
   - `persistence-pane-identity-migration.ts` (~275): unsupported PTY collection, legacy alias construction, layout snapshot normalization.
   - `persistence-workspace-pane-normalization.ts` (~270): workspace-session pane identities, SSH lease leaf remap, acknowledged pane-key remap.
   - `persistence-pane-alias-normalization.ts` (~210): bounded session IDs, unsupported-entry/alias normalization, register/merge/equality.
   - Circularity risk is highest here. Enforce a one-way chain `layout -> pane identity -> workspace pane`; move shared entry types to the lowest module. A direct dependency from the pane-identity adapter to `agentHookServer` is acceptable and safer than changing when registrations occur; callback injection is acceptable only when invoked synchronously at the exact existing sites. Keep migration and alias-registration ordering unchanged.

9. Workspace-session owner deletion in two files (~245 and ~175):
   - `persistence-session-owner-fields.ts`: terminal-tab construction/clone and keyed-field deletion.
   - `persistence-session-owner-removal.ts`: scanned-field deletion, host partition helpers, one/many owner removal, deleted scrollback references.
   - These functions operate on provided snapshots; they must not schedule writes or access Store.

Expected Phase 1 result: approximately 5,050–5,300 lines remain. This phase alone is deliberately not the stopping point.

### Phase 2: extract the load pipeline (about 950–1,100 lines removed)

The current `Store.load` is ~792 lines, but it also relies on nearby backup and telemetry code. Keep backup ring I/O in Store; extract parsing/normalization into a pipeline whose inputs explicitly include `raw`, `fileExistedOnLoad`, defaults/home/platform, protected-secret adapter, terminal snapshot storage, and logging/dirty callbacks.

- `persistence-secret-load.ts` (~190): decrypt and validate OpenCode cookie, proxy, Kagi link, and SSH owner leases. Preserve fail-closed branches and retained-blob removal exactly.
- `persistence-loaded-settings.ts` split into `persistence-loaded-terminal-settings.ts`, `persistence-loaded-agent-settings.ts`, and `persistence-loaded-application-settings.ts` (~230–275 each). These construct the settings portion and return `needsSave`.
- `persistence-loaded-ui.ts` split into `persistence-loaded-worktree-card-ui.ts` and `persistence-loaded-ui-state.ts` (~230–275 each).
- `persistence-loaded-state.ts` (~260): defaults merge, workspace-session salvage, SSH/automation collections, and final assembly from the above results.
- `persistence-post-load-migrations.ts` (~240): scrollback migration/pruning, project-host compatibility, automation/folder-scope backfills, linked metadata GC, plus returned dirty flags.
- `Store.load` keeps file existence/read/JSON parse, backup retry recursion, mutation of `loadNeedsSave`, sidecar seeding, telemetry/tab-switch cohort application, and startup milestones. This protects recovery control flow and class-owned side effects; its body should fall to ~140–220 lines.

Characterization before this cut: add/retain direct assertions that a corrupt primary plus corrupt `.bak.0` falls through to `.bak.1`; protected proxy failure clears and marks durable save; a damaged host partition is independently salvaged; legacy in-file GitHub cache marks the sidecar dirty; and old-client-compatible local `workspaceSession` remains separate from non-local partitions. Existing tests cover these, but name them in the move commit and run them focused if diagnosing.

Expected cumulative result: approximately 4,350–4,800 lines remain. The original 4,000–4,350 estimate credited 950–1,100 removed lines to a 792-line method even though backup recovery, telemetry migration, sidecar handling, and a 140–220-line shell remain in `Store`; use measured LOC instead.

### Phase 3: domain Store adapters to cross the half-size goal (about 700–1,000 lines removed)

Move the following public-method bodies to typed operations; leave one-line delegates and the full live state owner in `Store`.

1. `persistence-automation-store.ts` split into three files (~180–260 each): definition CRUD, run CRUD/snapshots, scheduling. Approximate body volume: 285 lines.
2. `persistence-project-store.ts` split into four or more files (~220–275 physical lines each): project-host setup CRUD, project-group/folder-workspace CRUD, repo order/removal/pruning, repo update/hydration. Approximate source span: 900 lines, but delegate/import overhead means the net removal is lower. Move whole named clusters, never half a CRUD cluster.
3. `persistence-lineage-store.ts` split into worktree metadata, worktree identity migration, and workspace lineage (~210–270 physical lines each). Approximate source span: 290 lines. This is part of the required budget unless measured LOC is already <=3,800 after complete preceding clusters.

Each operation accepts a narrow `PersistenceMutationContext`, returns the pre-existing method result, and invokes supplied class callbacks at the exact old sites. Preserve mutation order (especially pruning before save), array identity where the old code mutates in place, thrown messages, listener notification timing, and host-qualified matching. Do not extract SSH lease/PTY persistence or write/flush methods in this pass: they are tightly coupled to protected secrets, relay ID conversion, snapshot work, write generations and shutdown ordering.

Expected final `persistence.ts`: 3,500–3,800 lines after all measured Store clusters. Import/delegate overhead makes 3,250–3,650 optimistic; keep extracting complete clusters until the physical target is actually met.

## Sequencing and verification gates

1. Record exact baseline LOC and run `pnpm test -- src/main/persistence.test.ts` plus `pnpm run typecheck:node`; stop on persistence/typecheck red per task rules.
2. Move Phase 1 modules in dependency order. After each 2–3 modules, run typecheck and the focused persistence suite. Use cut/paste plus imports; do not rename values or reformat unrelated code.
3. Add/load characterization only where an extracted seam lacks direct coverage; keep tests behavior-oriented in existing persistence tests or a domain-named `persistence-*.test.ts` under the same line cap rules.
4. Extract Phase 2, then run focused persistence tests plus secret/write-focused existing suites if touched: `persistence-proxy-secret-recovery.test.ts`, `persistence-protected-secret-fail-closed.test.ts`, `persistence-single-serialize.test.ts`, and `persistence-async-write-syscalls.test.ts`.
5. Extract Phase 3 whole domain clusters until physical `wc -l src/main/persistence.ts` is <=3,800. Do not stop after pure helpers.
6. Review gate: diff with whitespace ignored where useful; verify each removed body exists once, call order is unchanged, public exports are stable, no new local-only path checks exist, no `persistence-*` module imports `./persistence`, and no state/timer/map moved out of Store.
7. Final commands: focused persistence tests (including any added `persistence-*.test.ts`), `pnpm run typecheck:node`, and `pnpm run check:max-lines-ratchet`. Report before/after physical LOC and every new-file LOC.

## Explicitly deferred because the ownership graph is not closed

- Async/sync durable writes, hash/encryption payload construction, backup rotation, GitHub sidecar flush, debounce/enqueue/final flush/freeze: coupled through generation fields and pending promises.
- Workspace-session set/patch/snapshot queue and PTY binding/SSH lease methods: coupled through snapshot storage, host partition ownership, relay translation, protected-secret flushing, and shutdown durability.
- Moving the Store class wholesale: impossible under the 300-line destination cap without unsafe prototype/mixin machinery or splitting the live owner.

These deferrals still leave enough safe extraction volume to land below 3,800 lines.
