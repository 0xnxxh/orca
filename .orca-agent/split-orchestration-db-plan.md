# Split `src/main/runtime/orchestration/db.ts`

Mechanical cut/paste. Zero intentional behavior change. No method renames. Keep every Why-comment. Never add `max-lines` disables or budget bumps.

## Constraints that size the cut

- User hard cap: every dest file including the leftover barrel is **≤ 400 physical lines** (leave ~20).
- Repo oxlint (`**/*.ts`): **300 counted lines** (`skipBlankLines` + `skipComments`). After the file-level disable is removed, this is the real CI gate. SQL-heavy files have almost no comments, so counted ≈ physical — treat **~280 counted / ~320 physical** as the working budget.
- Source leftover (`db.ts`) is a thin barrel only, ideally < 80, hard ≤ 400.
- Remove `/* eslint-disable max-lines */` from `db.ts`.
- Remove `inline src/main/runtime/orchestration/db.ts` from `config/max-lines-baseline.txt` (stale baseline entries fail the ratchet).

---

## 1. Architecture

### Layout

Keep the public path `src/main/runtime/orchestration/db.ts`. TypeScript resolves `from './db'` / `from '../orchestration/db'` to the **file** `db.ts`, not the folder. Implementation lives beside it:

```
src/main/runtime/orchestration/db.ts          # barrel only
src/main/runtime/orchestration/db/            # domain modules
```

Do **not** add `db/index.ts`. Consumers must keep importing `./db` or `../orchestration/db`.

### Class + prototype attach

The class cannot keep 150+ method signatures in `db.ts`. Use this-typed standalone functions, prototype attach, and interface merge.

**`db/orchestration-db.ts`** — class shell only:

```ts
export class OrchestrationDb {
  // Why: sibling domain modules need the sqlite handle; this is a TS visibility
  // change only (was private). Runtime field access is unchanged.
  db: Database.Database
  hasAnyDispatchContextsCache: boolean | undefined

  constructor(dbPath: (string & {}) | ':memory:') {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('busy_timeout = 5000')
    this.createTables()
    this.migrate()
    hardenOrchestrationDatabaseFiles(dbPath)
  }
}

export interface OrchestrationDb extends
  SchemaCreateTablesApi,
  SchemaMigrateApi,
  /* one Api interface per domain file — see §2 */
{}
```

Each domain file:

```ts
import { OrchestrationDb } from './orchestration-db'

export function insertMessage(this: OrchestrationDb, msg: { /* unchanged */ }): MessageRow {
  /* original body, unchanged */
}

export interface MessageInsertApi {
  insertMessage(msg: { /* same signature */ }): MessageRow
}

OrchestrationDb.prototype.insertMessage = insertMessage
```

Overloads (only `getTask`) must be copied onto the extracted function **and** the Api interface:

```ts
export function getTask(this: OrchestrationDb, id: string): TaskRow | undefined
export function getTask(this: OrchestrationDb, id: string, dispatchRunId: string): TaskRuntimeLineageRow | undefined
export function getTask(this: OrchestrationDb, id: string, dispatchRunId?: string): TaskRow | TaskRuntimeLineageRow | undefined
```

Former `private` methods become ordinary prototype methods. They stay **off** the barrel public re-export list. They become visible on the `OrchestrationDb` type so `this.foo()` typechecks across files. That is a TypeScript visibility change, not a runtime change.

### Barrel (`db.ts`)

Side-effect-import every attach module **before** constructing is possible, then re-export the public API:

```ts
import './db/schema-create-tables'
import './db/schema-migrate'
/* …every attach module, one import per file… */

export { OrchestrationDb } from './db/orchestration-db'
export {
  LEGACY_RUN_ID,
  LEGACY_CONTRACT_VERSION,
  CURRENT_CONTRACT_VERSION
} from './db/contract-constants'
export type { RunListPage, TaskRuntimeLineageRow } from './db/contract-constants'
export type {
  MessageType,
  MessagePriority,
  MessageDeliveryContract,
  TaskStatus,
  DispatchStatus,
  GateStatus,
  CoordinatorStatus,
  MessageRow,
  TaskRow,
  DispatchContextRow,
  DecisionGateRow,
  CoordinatorRun,
  WorkerReportOutcome,
  WorkerReportSettlement,
  RunRow,
  DeliveryRow,
  DeliveryStatus,
  LegacyAdoptionRow,
  LegacyCompatibilityPrincipalRow,
  LegacyPrincipalRole,
  LegacyOperationReceiptRow,
  LegacyMailReceiptRow,
  QuestionRow,
  QuestionStatus,
  MutationReceiptRow,
  MutationState,
  WorkerDispatchRow,
  WorkerDispatchState
} from './types'
```

Do not re-export pure helpers, `SCHEMA_VERSION`, former private methods, or `RunListCursor`.

### What implementers must not do

- Do not import `OrchestrationDb` from `./db/orchestration-db` outside `db/`. The class file does not attach methods; the barrel does.
- Do not import `../db` from inside `db/` (cycle). Domain files import the class from `./orchestration-db` and pures from sibling files.
- Do not change SQL, transaction boundaries, or `this.db.exec` / `prepare` call shapes.
- Do not rename public methods.
- Do not add `max-lines` disables.

---

## 2. Dest file tree

LOC estimates include imports, `this: OrchestrationDb`, the Api interface, and the prototype assign. They are physical-line estimates. Keep each file ≤ 380 physical and ≤ 280 counted.

### 2.1 Pure / shared (no prototype attach)

| Dest | Symbols | ~LOC | Source lines |
| --- | --- | --- | --- |
| `db/contract-constants.ts` | `LEGACY_RUN_ID`, `LEGACY_CONTRACT_VERSION`, `CURRENT_CONTRACT_VERSION`, `RunListPage`, `TaskRuntimeLineageRow` | 35 | 278–293 |
| `db/schema-version.ts` | `SCHEMA_VERSION` + the existing schema-version Why/changelog comment | 12 | 300–301 |
| `db/orchestration-id.ts` | `generateId` | 12 | 133–135 |
| `db/pane-key-match.ts` | `isEquivalentPaneKey`, `parseWorkerTerminalPriorOwnerIds`, `RUN_PANE_KEY_MATCH_SUFFIX_SQL`, `DISPATCH_PANE_KEY_MATCH_SUFFIX_SQL`, `paneKeyMatchSuffix` | 50 | 68–100 |
| `db/dispatch-capability-hash.ts` | `hashDispatchCapability` | 12 | 137–139 |
| `db/lifecycle-rejection-marker.ts` | `addLifecycleRejectionMarker`, `hasLifecycleRejectionMarker` | 45 | 141–174 |
| `db/utc-timestamp.ts` | `SQLITE_UTC_TIMESTAMP_RE`, `exposeUtcTimestamp`, `exposeMessageTimestamps`, `exposeMessageListTimestamps`, `exposeRunTimestamps`, `exposeDeliveryTimestamps`, `exposeQuestionTimestamps` | 85 | 176–243 |
| `db/run-list-cursor.ts` | `RunListCursor`, `encodeRunListCursor`, `decodeRunListCursor` | 45 | 206–226, 295–298 |
| `db/legacy-question-identity.ts` | `normalizeLegacyQuestionText`, `normalizeLegacyQuestionOptions`, `legacyMessageMatchesQuestion` | 45 | 245–276 |
| `db/database-file-permissions.ts` | `hardenOrchestrationDatabaseFiles` | 25 | 303–313 |
| `db/federated-worker-report-outcome.ts` | `parseFederatedWorkerReportOutcome` | 25 | 7109–7122 |

These stay **folder-internal**. Tests that need them import the dest file, not `./db`.

### 2.2 Schema SQL + migrate

`createTables` (336–629, ~294) and `migrate` (631–1028, ~398) cannot live in one dest file.

Split the `createTables` template **by concatenating string constants**, then keep a **single** `this.db.exec(...)` so statement order and atomicity stay identical:

```ts
this.db.exec(
  SCHEMA_CREATE_SQL_RUNS_MESSAGES +
    SCHEMA_CREATE_SQL_WORKERS +
    SCHEMA_CREATE_SQL_TASKS_DISPATCH
)
this.createUndeliveredInboxIndexIfPossible()
```

Exact SQL text, interpolation (`${LEGACY_RUN_ID}`, `${CURRENT_CONTRACT_VERSION}`, `${RUN_PANE_KEY_MATCH_SUFFIX_SQL}`), and whitespace must be preserved. Build the three constants as template literals that already contain their trailing newlines so the concatenated string equals today’s exec body.

| Dest | Contents | ~LOC | Source |
| --- | --- | --- | --- |
| `db/schema-create-sql-runs-messages.ts` | `CREATE` runs, messages, deliveries, mutation_receipts + their indexes | 90 | 338–406 |
| `db/schema-create-sql-workers.ts` | worker_dispatches, worker_terminal_resources/archives, federated_dispatches, remote_dispatch_attachments, federation_relay_items, remote_questions + indexes | 160 | 408–543 |
| `db/schema-create-sql-tasks-dispatch.ts` | tasks, dispatch_contexts, decision_gates, coordinator_runs, run pane-leaf index | 100 | 545–625 |
| `db/schema-create-tables.ts` | `createTables` + `SchemaCreateTablesApi` | 40 | 336–629 |
| `db/schema-column-probes.ts` | `hasColumn`, `createUndeliveredInboxIndexIfPossible`, `messagesTypeCheckAllowsHeartbeat`, `messagesTypeCheckAllowsQuestion` | 50 | 1398–1426 |
| `db/schema-migrate.ts` | `migrate` orchestrator: read `user_version`, `resolveOrchestrationMigrationStartVersion`, `BEGIN IMMEDIATE`, call version slices, leaf index, undelivered index, `user_version = SCHEMA_VERSION`, `COMMIT`/`ROLLBACK` | 70 | 630–643, 1015–1028 |
| `db/schema-migrate-v2-v9.ts` | `migrateSchemaV2ThroughV9(this, current)` — heartbeat rebuild, delivered_at, task creator/title, pane keys, v7 run_id backfill, v8 deliveries/questions, v9 question CHECK rebuild | 200 | 644–821 |
| `db/schema-migrate-v10-v18.ts` | `migrateSchemaV10ThroughV18(this, current)` — capabilities, mutation_receipts, worker_dispatches, runtime_epoch, federated/remote tables, relay, remote_questions, protocol_version | 160 | 822–967 |
| `db/schema-migrate-v19-v27.ts` | `migrateSchemaV19ThroughV27(this, current)` — calls legacy contract / question / scheduler / v22 index / `backfillWorkerTerminalResources` / v24 task creator / v25 active assignee / `migrateMutationReceiptCapacity` / v27 ack column | 80 | 968–1014 |

Version-slice functions are this-typed and prototype-attached (former private helpers). `migrate()` stays one transaction: slices only run `this.db.exec` / `this.hasColumn` / existing private calls; they must **not** open their own txn.

### 2.3 Legacy schema (1030–1396)

| Dest | Methods | ~LOC | Source |
| --- | --- | --- | --- |
| `db/schema-legacy-contract.ts` | `migrateLegacyContractStorage`, `classifyLegacyMessageContracts` | 130 | 1030–1136 |
| `db/schema-legacy-scheduler-loss.ts` | `migrateLegacySchedulerLossProvenance`, `ensureLegacySchedulerLossColumn` | 30 | 1138–1151 |
| `db/schema-legacy-question-backfill.ts` | `backfillLegacyQuestionThreads` | 140 | 1153–1268 |
| `db/schema-legacy-run-adoption.ts` | `adoptLegacyRunIfNeeded` | 150 | 1270–1396 |

### 2.4 Mutation receipts (1430–1516)

| Dest | Methods | ~LOC |
| --- | --- | --- |
| `db/mutation-receipts.ts` | `beginMutationReceipt`, `completeMutationReceipt`, `discardPendingMutationReceipt`, `getMutationReceipt` | 110 |

### 2.5 Legacy compatibility (1520–2230)

713 lines → 5 files.

| Dest | Methods | ~LOC | Source |
| --- | --- | --- | --- |
| `db/legacy-adoption.ts` | `getLegacyAdoption` | 20 | 1520–1524 |
| `db/legacy-compatibility-principals.ts` | `commitLegacyCompatibilityPrincipal`, `getLegacyCompatibilityPrincipal`, `listLegacyCompatibilityPrincipals`, `getLegacyCoordinatorPrincipal` | 170 | 1526–1667 |
| `db/legacy-compatibility-resolve.ts` | `resolveLegacyCompatibilityPrincipalByIdentity`, `resolveLegacyWorkerCandidate`, `resolveLegacyCoordinatorCandidate`, `isLegacyCoordinatorHandle` | 150 | 1669–1793 |
| `db/legacy-operation-receipts.ts` | `findLegacyWorkerCompletion`, `hasPendingCurrentDelivery`, `setLegacyCompatibilityPrincipalStatus`, `getLegacyOperationReceipt`, `requireCommittedLegacyPrincipal`, `requireLegacyMailPrincipal`, `initializeLegacyRecoveryCohort` | 200 | 1795–1963 |
| `db/legacy-mail.ts` | `getLegacyMailPage`, `getLegacyMailHistory`, `acknowledgeLegacyMail` | 210 | 1965–2147 |
| `db/legacy-question-answer-ack.ts` | `acknowledgeLegacyQuestionAnswer` | 100 | 2149–2230 |

### 2.6 Runs + deliveries (2234–2833)

| Dest | Methods | ~LOC | Source |
| --- | --- | --- | --- |
| `db/runs.ts` | `createRun`, `getRun`, `listRuns`, `getCurrentRunForPane`, `getRunRaw`, `requireRun` | 130 | 2234–2257, 2404–2468, 2487–2491 |
| `db/run-bind.ts` | `bindRun`, `runsBoundToPane`, `unbindOtherRunsForPane`, `fenceOutstandingDelivery` | 200 | 2259–2402, 2448–2485, 2493–2499 |
| `db/legacy-coordinator-mail-takeover.ts` | `promoteLegacyCoordinatorMailForTakeover`, `getUniqueLegacyCoordinatorHandle` | 170 | 2501–2651 |
| `db/run-deliveries.ts` | `requireCurrentConsumer`, `getDeliveryRaw`, `getDeliveryMessages`, `getOrCreateRunDelivery`, `acknowledgeRunDelivery`, `getRunMailboxHistory` | 210 | 2653–2833 |

### 2.7 Messages + legacy lifecycle (2837–3627)

| Dest | Methods | ~LOC | Source |
| --- | --- | --- | --- |
| `db/message-insert.ts` | `insertMessage` | 60 | 2837–2879 |
| `db/legacy-lifecycle-operation.ts` | `commitLegacyLifecycleOperation` | 190 | 2881–3051 |
| `db/legacy-ask-operation.ts` | `commitLegacyAskOperation` | 150 | 3053–3183 |
| `db/legacy-question-find.ts` | `findPendingLegacyQuestions`, `findLegacyQuestionsBySemanticIdentity`, `resolveLegacyWorkerCoordinatorDelivery` | 130 | 3185–3282 |
| `db/legacy-reply-operation.ts` | `commitLegacyReplyOperation`, `requireMatchingLegacyOperationReceipt`, `insertLegacyOperationReceipt` | 180 | 3284–3446 |
| `db/message-inbox.ts` | `getUnreadMessages`, `convertLifecycleMessageToRejection`, `getUndeliveredUnreadMessages`, `getUndeliveredUnreadMailboxHandles`, `getAllMessages`, `getMessageById`, `markAsRead`, `markAsDelivered`, `markAsReadAndDelivered`, `getInbox`, `getAllMessagesForHandle`, `getThreadMessagesFor` | 220 | 3448–3627 |

### 2.8 Questions + tasks (3629–3983)

| Dest | Methods | ~LOC | Source |
| --- | --- | --- | --- |
| `db/questions.ts` | `createQuestion`, `getQuestion`, `getQuestionRaw`, `answerQuestion`, `closeQuestionsForDispatch` | 170 | 3629–3777 |
| `db/tasks.ts` | `createTask`, `getTask` (overloads), `listTasks`, `listTasksWithDispatch`, `updateTaskStatus`, `promoteReadyTasks` | 230 | 3781–3983 |

### 2.9 Worker dispatch start / stage / fail (3987–4576)

| Dest | Methods | ~LOC | Source |
| --- | --- | --- | --- |
| `db/worker-dispatch-start.ts` | `createStartingWorkerDispatch` | 150 | 3987–4117 |
| `db/worker-dispatch-stage.ts` | `recordWorkerStage`, `updateWorkerSetupEvidence`, `prepareStartingWorkerAuthority` | 220 | 4119–4312 |
| `db/worker-dispatch-ready-fail.ts` | `markWorkerDispatchReady`, `failWorkerStart`, `markWorkerStartUnknown` | 110 | 4314–4406 |
| `db/federated-worker-start.ts` | `reconcileFederatedWorkerStart` | 110 | 4408–4501 |
| `db/worker-dispatch-lookup.ts` | `getWorkerDispatch`, `listLegacyWorkerTerminalRecoveryRows`, `reconcileMissingWorkerTerminal` | 90 | 4503–4576 |

`prepareStartingWorkerAuthority` is ~123 lines. If `worker-dispatch-stage.ts` goes over 280 counted after imports, move `prepareStartingWorkerAuthority` to `db/worker-dispatch-authority.ts` (~140) and leave stage/evidence in `worker-dispatch-stage.ts` (~90).

### 2.10 Federation / remote attachment / relay (4578–5567)

990 lines → 8 files.

| Dest | Methods | ~LOC | Source |
| --- | --- | --- | --- |
| `db/federated-dispatch.ts` | `getFederatedDispatch`, `listActiveFederatedDispatches`, `findNextTerminalFederatedDispatchPendingAcknowledgment`, `isFederatedDispatchRelayEligible`, `updateFederatedDispatchResources` | 100 | 4578–4656 |
| `db/remote-attachment-create.ts` | `createRemoteDispatchAttachment`, `getRemoteDispatchAttachment` | 90 | 4658–4731 |
| `db/remote-attachment-stage.ts` | `recordRemoteAttachmentStage`, `updateRemoteAttachmentSetupEvidence`, `prepareRemoteAttachmentAuthority` | 140 | 4733–4851 |
| `db/remote-attachment-lifecycle.ts` | `markRemoteAttachmentReady`, `failRemoteAttachment`, `verifyRemoteAttachmentAuthority`, `isRemoteAttachmentProcessCurrent`, `beginRemoteAttachmentStop`, `settleRemoteAttachmentStop`, `markRemoteAttachmentStopUnknown`, `findActiveRemoteAttachmentForPane` | 170 | 4853–4993 |
| `db/federation-relay-enqueue.ts` | `enqueueFederationRelay` | 190 | 4995–5160 |
| `db/federation-relay-ack.ts` | `listFederationRelay`, `listPendingFederationRelay`, `acknowledgeFederationRelay`, `setFederatedHomeImportSequence`, `recordFederatedHomeAcknowledgment` | 190 | 5162–5322 |
| `db/federation-relay-import.ts` | `importFederatedRelayItem` | 140 | 5324–5440 |
| `db/federation-remote-questions.ts` | `getRemoteQuestion`, `answerRemoteQuestion`, `setRemoteWorkerImportSequence`, `registerFederatedQuestion`, `getFederationRelayItem`, `settleRemoteAttachmentInRelayTransaction` | 150 | 5442–5567 |

### 2.11 Worker stop (5569–5828)

| Dest | Methods | ~LOC | Source |
| --- | --- | --- | --- |
| `db/worker-process-currency.ts` | `isDispatchProcessCurrent` | 25 | 5569–5582 |
| `db/worker-stop.ts` | `beginWorkerStop`, `settleWorkerStop`, `markWorkerStopUnknown` | 140 | 5584–5646, 5648–5676, 5749–5759 |
| `db/federated-worker-stop.ts` | `reconcileFederatedWorkerStop`, `resumeFederatedWorkerForTerminalRelay` | 90 | 5678–5747 |
| `db/worker-abandon.ts` | `abandonWorkerDispatch` | 90 | 5761–5828 |

### 2.12 Worker terminal resources (5833–6454)

| Dest | Methods | ~LOC | Source |
| --- | --- | --- | --- |
| `db/worker-terminal-resource-create.ts` | `backfillWorkerTerminalResources`, `createWorkerTerminalResourceStatement`, `getWorkerTerminalResource`, `getWorkerTerminalResourceByOwner`, `getWorkerTerminalResourceFormerlyOwnedBy` | 120 | 5833–5931 |
| `db/worker-terminal-resource-transfer.ts` | `transferWorkerTerminalResourceStatement`, `findTransferableWorkerTerminalResource`, `workerTerminalResourceHasIdentityConflict` | 130 | 5933–6042 |
| `db/worker-terminal-release-request.ts` | `requestWorkerTerminalRelease`, `settleDeadWorkerTerminalRelease` | 170 | 6044–6188 |
| `db/worker-terminal-archive.ts` | `storeWorkerTerminalArchive`, `commitWorkerTerminalArchiveForRelease`, `getWorkerTerminalArchive`, `settleWorkerTerminalRelease`, `markWorkerTerminalReleaseUnknown`, `revertWorkerTerminalReleaseToRetained` | 130 | 6190–6298 |
| `db/worker-terminal-retain.ts` | `retainWorkerTerminalResource`, `markWorkerTerminalUserOwned`, `listWorkerTerminalReleaseBacklog` | 120 | 6300–6398 |
| `db/worker-terminal-list.ts` | `listWorkerTerminalResources` | 70 | 6400–6454 |

### 2.13 Dispatch contexts + settlement (6456–6882)

| Dest | Methods | ~LOC | Source |
| --- | --- | --- | --- |
| `db/dispatch-context-create.ts` | `createDispatchContext`, `getDispatchContext`, `getDispatchContextById`, `commitDispatchLaunchTokenHash` | 120 | 6456–6553 |
| `db/dispatch-capability.ts` | `mintDispatchCapability`, `verifyDispatchCapability`, `revokeDispatchCapability` | 100 | 6555–6633 |
| `db/dispatch-active-lookup.ts` | `getActiveDispatchForTerminal`, `hasAnyDispatchContexts`, `getActiveDispatchForIdentity`, `findActiveDispatchForAssignee`, `getLatestDispatchForTerminal` | 90 | 6635–6697 |
| `db/worker-report-settlement.ts` | `completeDispatch`, `completeActiveDispatchForTask`, `settleWorkerReport`, `settleWorkerReportInTransaction` | 150 | 6699–6821 |
| `db/dispatch-fail-heartbeat.ts` | `failActiveDispatchForTask`, `recordHeartbeat`, `getStaleDispatches`, `failDispatch` | 80 | 6823–6882 |

### 2.14 Gates, coordinator, reset (6885–7106)

| Dest | Methods | ~LOC | Source |
| --- | --- | --- | --- |
| `db/decision-gates.ts` | `createGate`, `resolveGate`, `timeoutGate`, `listGates`, `getGate` | 100 | 6885–6967 |
| `db/coordinator-runs.ts` | `createCoordinatorRun`, `getCoordinatorRun`, `updateCoordinatorRun`, `getActiveCoordinatorRun`, `getIdleTerminals` | 80 | 6971–7029 |
| `db/database-reset.ts` | `runResetTransaction`, `resetAll`, `resetTasks`, `resetMessages`, `close` | 100 | 7033–7106 |

### 2.15 Class shell + leftover barrel

| Dest | Contents | ~LOC |
| --- | --- | --- |
| `db/orchestration-db.ts` | class fields, constructor, `export interface OrchestrationDb extends …` | 90 |
| `db.ts` | side-effect imports + public re-exports only | 70 |

### File count

- **70 dest files** under `db/` (11 pures + 9 schema/migrate + 4 legacy-schema + 46 method modules + class shell)
- **1 leftover barrel** `db.ts`
- **5 characterization tests** (see §6) — only if those pures stay unasserted after extract

If any dest exceeds 280 counted while implementing, split at the next method boundary already listed as a fallback (do not invent new behavior to shrink a file).

---

## 3. Visibility changes (`private` → accessible)

TypeScript only. Runtime field/method names stay the same.

### Fields on `OrchestrationDb`

| Was | Becomes | Why |
| --- | --- | --- |
| `private db` | `db` | Every extracted method reads `this.db`. Tests already reach it via `(db as unknown as { db }).db` — leave those casts; do not “clean up” test access in this split. |
| `private hasAnyDispatchContextsCache` | `hasAnyDispatchContextsCache` | `createDispatchContext`, `hasAnyDispatchContexts`, `resetAll`, `resetTasks` live in different files. |

Do not use `#private` fields. Do not add getters.

### Former private methods (prototype-attached, not barrel-exported)

`createTables`, `migrate`, `migrateSchemaV2ThroughV9`, `migrateSchemaV10ThroughV18`, `migrateSchemaV19ThroughV27`, `migrateLegacyContractStorage`, `classifyLegacyMessageContracts`, `migrateLegacySchedulerLossProvenance`, `ensureLegacySchedulerLossColumn`, `backfillLegacyQuestionThreads`, `adoptLegacyRunIfNeeded`, `hasColumn`, `createUndeliveredInboxIndexIfPossible`, `messagesTypeCheckAllowsHeartbeat`, `messagesTypeCheckAllowsQuestion`, `requireCommittedLegacyPrincipal`, `requireLegacyMailPrincipal`, `initializeLegacyRecoveryCohort`, `runsBoundToPane`, `getRunRaw`, `unbindOtherRunsForPane`, `requireRun`, `fenceOutstandingDelivery`, `promoteLegacyCoordinatorMailForTakeover`, `getUniqueLegacyCoordinatorHandle`, `requireCurrentConsumer`, `getDeliveryRaw`, `getDeliveryMessages`, `resolveLegacyWorkerCoordinatorDelivery`, `requireMatchingLegacyOperationReceipt`, `insertLegacyOperationReceipt`, `getQuestionRaw`, `promoteReadyTasks`, `getFederationRelayItem`, `settleRemoteAttachmentInRelayTransaction`, `backfillWorkerTerminalResources`, `findActiveDispatchForAssignee`, `settleWorkerReportInTransaction`, `runResetTransaction`.

The three `migrateSchemaV*` names are new only as extracted slice functions that already ran inline in `migrate()`. Bodies stay byte-for-byte the existing `if (current < N)` blocks.

---

## 4. Circular-import strategy

```
db.ts  --value-->  every db/*.ts attach module  --value-->  ./orchestration-db
db.ts  --value-->  ./db/orchestration-db  (re-export)
db.ts  --value-->  ./db/contract-constants, ./types  (public constants/types)

orchestration-db.ts  --type-only-->  each *Api interface
orchestration-db.ts  --value-->  ./database-file-permissions  (constructor)

domain.ts  --value-->  ./orchestration-db
domain.ts  --value-->  sibling pures (pane-key-match, utc-timestamp, …)
domain.ts  --value-->  ../types, ../orchestration-error, …  (existing deps)

FORBIDDEN:  db/*.ts import from '../db'
FORBIDDEN:  outside code import from './db/orchestration-db'
```

`import type` in `orchestration-db.ts` is erased, so the class module does not load domain modules at runtime. Domain modules load the class, attach methods, then the barrel finishes evaluating. `new OrchestrationDb()` only happens after the barrel’s side-effect imports, so `this.createTables()` / `this.migrate()` exist.

Do not attach methods from `orchestration-db.ts` (that would force a runtime cycle).

Existing external imports (`./orchestration/db`, `../orchestration/db`, `./db`) stay valid because they hit the barrel file.

---

## 5. Extraction order

Work in this order so the constructor keeps compiling after each step. Cut/paste; do not rewrite bodies.

1. Create `src/main/runtime/orchestration/db/`.
2. Move pures + constants (`contract-constants`, `schema-version`, `orchestration-id`, `pane-key-match`, `dispatch-capability-hash`, `lifecycle-rejection-marker`, `utc-timestamp`, `run-list-cursor`, `legacy-question-identity`, `database-file-permissions`, `federated-worker-report-outcome`). Leave `import` stubs in `db.ts` temporarily if needed.
3. Add `orchestration-db.ts` with fields + constructor. Temporarily keep methods on the original class until they move, **or** do the remaining steps in one commit so there is never a second `export class OrchestrationDb`.
4. Extract schema SQL constants, then `schema-create-tables`, `schema-column-probes`, migrate slices, legacy schema modules. Attach immediately. Constructor can now live in the shell.
5. Extract remaining method groups in source order (mutation → legacy → runs → messages → questions/tasks → worker start → federation → stop → terminal → dispatch context → gates/reset). After each file: add the `*Api` interface to the `export interface OrchestrationDb extends …` list and a barrel `import './db/<file>'`.
6. Replace `db.ts` with the barrel. Delete leftover method bodies and the file-level `eslint-disable max-lines`.
7. Delete `inline src/main/runtime/orchestration/db.ts` from `config/max-lines-baseline.txt`.
8. Add characterization tests only for uncovered pures (§6).
9. Run verification (§7).

Per-file cut/paste checklist:

- Copy the method body unchanged, including Why-comments and SQL.
- Change `methodName(` to `export function methodName(this: OrchestrationDb,`.
- Drop `private`.
- Add the Api interface + `OrchestrationDb.prototype.methodName = methodName`.
- Import sibling pures used by the body (`generateId`, `isEquivalentPaneKey`, `exposeUtcTimestamp`, …).
- Import types from `../types` (same set the method already needs). Keep existing imports of `OrchestrationError`, `ensureMutationReceiptCapacity`, `releaseContextOnlyDispatch`, `deriveWorkerTerminalListState`, `parsePaneKey`, crypto, etc., pointing at their current modules.
- Do not reformat SQL.

`createTables` SQL concat must be checked by comparing the concatenated template to the original exec string (whitespace-sensitive). If concat is risky, keep one `this.db.exec(\`...\`)` whose body is three `${SCHEMA_CREATE_SQL_*}` interpolations with no extra characters.

---

## 6. Characterization tests (uncovered pures only)

Existing suites already cover `exposeUtcTimestamp` (`db-message-timestamp.test.ts`), `hardenOrchestrationDatabaseFiles` (`orchestration-db-permissions.test.ts`), run-list cursors (`orchestration-db-retention-pagination.test.ts`), pane-key equivalence via `getCurrentRunForPane` (`orchestration-adopted-run-binding.test.ts`), and lifecycle rejection markers via payload assertions (`lifecycle-reconciliation.test.ts`). **Do not add tests for those.**

Add tests only for pures that have no current assertion after extract. Import from the dest file, not the barrel. Pin current behavior; do not invent cases the old private functions did not handle.

| Test file | Symbol | Pins |
| --- | --- | --- |
| `db/orchestration-id.test.ts` | `generateId` | prefix + `_` + 12 hex chars (`randomBytes(6)`) |
| `db/pane-key-match.test.ts` | `paneKeyMatchSuffix`, `parseWorkerTerminalPriorOwnerIds` | suffix after first `:`; no-colon returns whole string; JSON string array vs invalid/non-array/throw → `null` |
| `db/dispatch-capability-hash.test.ts` | `hashDispatchCapability` | SHA-256 hex of a fixed string |
| `db/federated-worker-report-outcome.test.ts` | `parseFederatedWorkerReportOutcome` | nested `{ payload: '{"outcome":"succeeded"}' }` / `failed`; missing/invalid/non-json → `undefined` |

No new tests that construct `OrchestrationDb` and re-exercise already-covered public methods.

---

## 7. Verification

```bash
pnpm test -- src/main/runtime/orchestration
pnpm run typecheck:node
pnpm run check:max-lines-ratchet
wc -l src/main/runtime/orchestration/db.ts src/main/runtime/orchestration/db/**/*.ts
```

Ignore unrelated suite / node-pty load failures.

`wc -l` must show `db.ts` ≤ 400 and every dest ≤ 400. If oxlint `max-lines` fires on a dest, split at the next method listed above — do not disable the rule.

Do not push. Do not open a PR.

---

## 8. Risks

- **`db.ts` + `db/` coexistence.** TS resolves `from './db'` to the file. Do not add `db/index.ts`. Internal imports must be `./db/<file>` from the barrel and `./<file>` from siblings.
- **Constructor before attach.** Anyone importing `./db/orchestration-db` and calling `new OrchestrationDb()` gets missing methods. Public path is the barrel only.
- **`createTables` SQL concat.** Extra/missing newlines change the executed SQL. Prefer `${A}${B}${C}` with constants that already include the original interstitial whitespace.
- **`migrate` transaction.** Slices must not `BEGIN`/`COMMIT`. Only `migrate()` owns the txn.
- **Interface merge drift.** Forgetting a method on `export interface OrchestrationDb extends …` makes `this.other()` fail typecheck. Add the Api to the merge in the same edit as the attach.
- **`getTask` overloads.** Losing the two-call-site overloads is a type-level break. Copy all three signatures.
- **Oxlint 300 vs user 400.** A 380-line SQL file will fail oxlint even if it meets the user cap. Stay under ~280 counted.
- **Ratchet stale entry.** Leaving `inline src/main/runtime/orchestration/db.ts` in the baseline after removing the disable fails `check:max-lines-ratchet`.
- **Test `db` casts.** Keep `(db as unknown as { db }).db`. Changing tests is out of scope.
- **SSH / folder workspaces / remote wire / GitLab.** No logic change. Federation relay, pane-key leaf match, and contract versions stay byte-identical so mixed client/host versions keep working.
- **Cross-file `this`.** `commitLegacyLifecycleOperation` calls `this.settleWorkerReportInTransaction`; `migrate` calls `this.backfillWorkerTerminalResources`; `createDispatchContext` writes `this.hasAnyDispatchContextsCache`. Prototype attach preserves those calls. Do not rewrite them as free-function calls.

---

## Public API (must remain importable from `./db`)

- `export class OrchestrationDb`
- `export const LEGACY_RUN_ID`, `LEGACY_CONTRACT_VERSION`, `CURRENT_CONTRACT_VERSION`
- `export type RunListPage`, `TaskRuntimeLineageRow`
- type re-exports currently at lines 102–131 (from `./types`)
