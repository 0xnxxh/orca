import { LEGACY_RUN_ID } from '../contract-constants'
import type { OrchestrationDb } from '../orchestration-db'

// ── Lifecycle ──

export function runResetTransaction(this: OrchestrationDb, statements: string): void {
  this.db.exec('BEGIN IMMEDIATE')
  try {
    this.db.exec(statements)
    this.db.exec('COMMIT')
  } catch (error) {
    this.db.exec('ROLLBACK')
    throw error
  }
}

export function resetAll(this: OrchestrationDb): void {
  // Why: retain mutation receipts so a lost reset response cannot replay as a new mutation.
  this.runResetTransaction(`
    DELETE FROM coordinator_runs;
    DELETE FROM decision_gates;
    DELETE FROM remote_questions;
    DELETE FROM question_threads;
    DELETE FROM deliveries;
    DELETE FROM legacy_mail_receipts;
    DELETE FROM legacy_operation_receipts;
    DELETE FROM legacy_compatibility_principals;
    DELETE FROM legacy_adoptions;
    DELETE FROM federation_relay_items;
    DELETE FROM remote_dispatch_attachments;
    DELETE FROM federated_dispatches;
    DELETE FROM worker_terminal_archives;
    DELETE FROM worker_terminal_resources;
    DELETE FROM worker_dispatches;
    DELETE FROM dispatch_contexts;
    DELETE FROM tasks;
    DELETE FROM messages;
    DELETE FROM run_coordinator_handles;
    DELETE FROM runs;
    INSERT INTO runs (id, objective, home_database, consumer_generation, legacy)
      VALUES ('${LEGACY_RUN_ID}', 'Legacy orchestration state (inspect only)', 'this_database', 0, 1);
  `)
  this.hasAnyDispatchContextsCache = undefined
}

export function resetTasks(this: OrchestrationDb): void {
  this.runResetTransaction(`
    DELETE FROM coordinator_runs;
    DELETE FROM decision_gates;
    DELETE FROM remote_questions;
    DELETE FROM question_threads;
    DELETE FROM legacy_mail_receipts;
    DELETE FROM legacy_operation_receipts;
    DELETE FROM legacy_compatibility_principals;
    DELETE FROM legacy_adoptions;
    DELETE FROM federation_relay_items;
    DELETE FROM remote_dispatch_attachments;
    DELETE FROM federated_dispatches;
    DELETE FROM worker_terminal_archives;
    DELETE FROM worker_terminal_resources;
    DELETE FROM worker_dispatches;
    DELETE FROM dispatch_contexts;
    DELETE FROM tasks;
  `)
  this.hasAnyDispatchContextsCache = undefined
}

export function resetMessages(this: OrchestrationDb): void {
  // Why: relay rows carry contiguous cross-server cursors, not just inbox history.
  this.runResetTransaction(`
    DELETE FROM legacy_mail_receipts;
    DELETE FROM question_threads;
    DELETE FROM deliveries;
    DELETE FROM messages;
  `)
}

export type OrchestrationResetMethods = {
  runResetTransaction: typeof runResetTransaction
  resetAll: typeof resetAll
  resetTasks: typeof resetTasks
  resetMessages: typeof resetMessages
}

export function attachOrchestrationReset(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    runResetTransaction,
    resetAll,
    resetTasks,
    resetMessages
  })
}
