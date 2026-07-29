import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import {
  CURRENT_CONTRACT_VERSION,
  LEGACY_CONTRACT_VERSION,
  LEGACY_RUN_ID,
  OrchestrationDb
} from './db'

type CutoverFixture = {
  dbPath: string
  currentRunId: string
  currentDispatchId: string
  legacyTaskId: string
  legacyDispatchId: string
  legacyGateId: string
  legacyMessageIds: string[]
  legacyQuestionId: string
  legacyDeliveryId: string
  rejectionMessageId: string
}

describe('OrchestrationDb legacy contract storage', () => {
  let db: OrchestrationDb | undefined
  let tempDir: string | undefined

  afterEach(() => {
    db?.close()
    db = undefined
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  function createCutoverFixture(): CutoverFixture {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-legacy-storage-'))
    const dbPath = join(tempDir, 'orchestration.db')
    const first = new OrchestrationDb(dbPath)
    const currentRun = first.createRun({
      objective: 'Current work',
      coordinatorHandle: 'term_current_coord',
      coordinatorPaneKey: 'tab_current:11111111-1111-4111-8111-111111111111'
    })
    const currentTask = first.createTask({ spec: 'current', runId: currentRun.id })
    const currentDispatch = first.createDispatchContext(
      currentTask.id,
      'term_current_worker',
      'tab_current:22222222-2222-4222-9222-222222222222',
      'current_launch_hash'
    )
    first.insertMessage({
      runId: currentRun.id,
      from: 'term_current_worker',
      to: `run:${currentRun.id}`,
      subject: 'current mail'
    })

    const legacyTask = first.createTask({
      spec: 'legacy',
      createdByTerminalHandle: 'term_legacy_coord'
    })
    first.createDispatchContext(
      legacyTask.id,
      'term_legacy_worker',
      'tab_legacy:33333333-3333-4333-8333-333333333333'
    )
    const legacyGate = first.createGate({
      taskId: legacyTask.id,
      question: 'Retained gate?'
    })
    first.resolveGate(legacyGate.id, 'continue')
    const retryDispatch = first.createDispatchContext(
      legacyTask.id,
      'term_legacy_worker',
      'tab_legacy:33333333-3333-4333-8333-333333333333'
    )
    const legacyMessages = [
      first.insertMessage({
        from: 'term_legacy_coord',
        to: 'term_legacy_worker',
        subject: 'read worker mail'
      }),
      first.insertMessage({
        from: 'term_legacy_worker',
        to: 'term_legacy_coord',
        subject: 'read coordinator mail'
      }),
      first.insertMessage({
        from: 'term_legacy_coord',
        to: 'term_legacy_worker',
        subject: 'second worker page'
      })
    ]
    first.markAsRead(legacyMessages.map((message) => message.id))
    const question = first.createQuestion({
      runId: LEGACY_RUN_ID,
      dispatchId: retryDispatch.id,
      askerHandle: 'term_legacy_worker',
      question: 'Retained question?'
    })
    const rejection = first.insertMessage({
      from: 'term_legacy_worker',
      to: 'term_legacy_coord',
      subject: 'Rejected heartbeat',
      type: 'heartbeat',
      payload: JSON.stringify({ _orcaLifecycleRejection: { code: 'migration', reason: 'cutover' } })
    })
    first.close()

    const raw = new Database(dbPath)
    const legacyDeliveryId = 'delivery_legacy_outstanding'
    raw
      .prepare(
        `INSERT INTO deliveries (
           id, run_id, consumer_generation, message_ids, status
         ) VALUES (?, ?, 0, ?, 'outstanding')`
      )
      .run(legacyDeliveryId, LEGACY_RUN_ID, JSON.stringify([legacyMessages[0].id]))
    raw.exec(`
      DROP INDEX IF EXISTS idx_messages_delivery_contract;
      DROP TABLE legacy_mail_receipts;
      DROP TABLE legacy_operation_receipts;
      DROP TABLE legacy_compatibility_principals;
      DROP TABLE legacy_adoptions;
    `)
    raw.pragma('user_version = 18')
    raw.close()

    return {
      dbPath,
      currentRunId: currentRun.id,
      currentDispatchId: currentDispatch.id,
      legacyTaskId: legacyTask.id,
      legacyDispatchId: retryDispatch.id,
      legacyGateId: legacyGate.id,
      legacyMessageIds: legacyMessages.map((message) => message.id),
      legacyQuestionId: question.message.id,
      legacyDeliveryId,
      rejectionMessageId: rejection.id
    }
  }

  function openAdoptedFixture(): {
    fixture: CutoverFixture
    adoptedRunId: string
    workerPrincipalId: string
    coordinatorPrincipalId: string
  } {
    const fixture = createCutoverFixture()
    db = new OrchestrationDb(fixture.dbPath)
    const adoptedRunId = db.getLegacyAdoption()?.adopted_run_id as string
    const worker = db.commitLegacyCompatibilityPrincipal({
      runId: adoptedRunId,
      dispatchId: fixture.legacyDispatchId,
      role: 'worker',
      hostScope: 'local:runtime_1',
      terminalHandle: 'term_legacy_worker',
      paneKey: 'tab_legacy:33333333-3333-4333-8333-333333333333',
      launchTokenHash: 'legacy_launch_hash',
      processIncarnation: 'process_1'
    })
    const coordinator = db.commitLegacyCompatibilityPrincipal({
      runId: adoptedRunId,
      role: 'coordinator',
      hostScope: 'local:runtime_1',
      terminalHandle: 'term_legacy_coord',
      paneKey: 'tab_coord:44444444-4444-4444-8444-444444444444',
      launchTokenHash: 'coord_launch_hash',
      processIncarnation: 'process_coord'
    })
    return {
      fixture,
      adoptedRunId,
      workerPrincipalId: worker.principal.id,
      coordinatorPrincipalId: coordinator.principal.id
    }
  }

  it('atomically rehomes the full graph, fences legacy Delivery, and preserves current rows', () => {
    const fixture = createCutoverFixture()
    db = new OrchestrationDb(fixture.dbPath)
    const adoption = db.getLegacyAdoption()
    const adoptedRunId = adoption?.adopted_run_id as string
    const sqlite = (db as unknown as { db: Database.Database }).db

    expect(adoption).toMatchObject({
      source_run_id: LEGACY_RUN_ID,
      scheduler_state_lost: 1
    })
    expect(db.getRun(adoptedRunId)).toMatchObject({ legacy: 0, consumer_generation: 0 })
    expect(db.listTasks({ runId: LEGACY_RUN_ID })).toEqual([])
    expect(db.getDispatchContextById(fixture.legacyDispatchId)).toMatchObject({
      run_id: adoptedRunId,
      contract_version: LEGACY_CONTRACT_VERSION,
      launch_token_hash: null
    })
    expect(db.getGate(fixture.legacyGateId)).toMatchObject({ run_id: adoptedRunId })
    expect(db.getQuestion(fixture.legacyQuestionId)).toMatchObject({ run_id: adoptedRunId })
    expect(db.getMessageById(fixture.legacyMessageIds[0])).toMatchObject({
      run_id: adoptedRunId,
      delivery_contract: 'legacy_direct'
    })
    expect(db.getMessageById(fixture.rejectionMessageId)).toMatchObject({
      run_id: adoptedRunId,
      delivery_contract: 'audit_only'
    })
    expect(
      sqlite.prepare('SELECT * FROM deliveries WHERE id = ?').get(fixture.legacyDeliveryId)
    ).toMatchObject({ run_id: adoptedRunId, status: 'fenced' })
    expect(db.getDispatchContextById(fixture.currentDispatchId)).toMatchObject({
      run_id: fixture.currentRunId,
      contract_version: CURRENT_CONTRACT_VERSION,
      launch_token_hash: 'current_launch_hash'
    })

    db.close()
    const partial = new Database(fixture.dbPath)
    partial
      .prepare('UPDATE tasks SET run_id = ? WHERE id = ?')
      .run(LEGACY_RUN_ID, fixture.legacyTaskId)
    partial.pragma('user_version = 19')
    partial.close()
    db = new OrchestrationDb(fixture.dbPath)
    expect(db.getLegacyAdoption()?.adopted_run_id).toBe(adoptedRunId)
    expect(db.getTask(fixture.legacyTaskId)?.run_id).toBe(adoptedRunId)
    expect(db.getDispatchContextById(fixture.currentDispatchId)?.contract_version).toBe(
      CURRENT_CONTRACT_VERSION
    )
    expect(db.listTasks({ runId: LEGACY_RUN_ID })).toEqual([])
  })

  it('does not synthesize an adopted Run or compatibility authority for a fresh database', () => {
    db = new OrchestrationDb(':memory:')

    expect(db.getLegacyAdoption()).toBeUndefined()
    expect(db.listLegacyCompatibilityPrincipals(LEGACY_RUN_ID)).toEqual([])
    expect(db.listRuns()).toEqual([expect.objectContaining({ id: LEGACY_RUN_ID, legacy: 1 })])
  })

  it('keeps current Delivery disjoint from adopted direct and audit-only mail', () => {
    const state = openAdoptedFixture()
    const run = db!.getRun(state.adoptedRunId) as NonNullable<ReturnType<OrchestrationDb['getRun']>>
    db!.insertMessage({
      runId: state.adoptedRunId,
      from: 'current_worker',
      to: `run:${state.adoptedRunId}`,
      subject: 'current retry mail'
    })

    const delivery = db!.getOrCreateRunDelivery({
      runId: state.adoptedRunId,
      consumerGeneration: run.consumer_generation
    })

    expect(delivery?.messages.map((message) => message.subject)).toEqual(['current retry mail'])
  })

  it('drains a durable recovery cohort in bounded replaying pages before unread mail', () => {
    const state = openAdoptedFixture()
    const first = db!.getLegacyMailPage({ principalId: state.workerPrincipalId, limit: 1 })
    const replay = db!.getLegacyMailPage({ principalId: state.workerPrincipalId, limit: 1 })

    expect(first.recovery).toBe(true)
    expect(replay.messages.map((message) => message.id)).toEqual(
      first.messages.map((message) => message.id)
    )
    expect(() =>
      db!.acknowledgeLegacyMail({
        principalId: state.workerPrincipalId,
        messageIds: [state.fixture.legacyMessageIds[2]]
      })
    ).toThrow(/current replay page/)
    db!.acknowledgeLegacyMail({
      principalId: state.workerPrincipalId,
      messageIds: first.messages.map((message) => message.id)
    })
    const second = db!.getLegacyMailPage({ principalId: state.workerPrincipalId, limit: 1 })
    expect(second.recovery).toBe(true)
    expect(second.messages[0].id).not.toBe(first.messages[0].id)
    db!.acknowledgeLegacyMail({
      principalId: state.workerPrincipalId,
      messageIds: second.messages.map((message) => message.id)
    })
    expect(db!.getLegacyMailPage({ principalId: state.workerPrincipalId, limit: 1 }).recovery).toBe(
      false
    )
  })

  it('returns complete addressed legacy history without changing read state', () => {
    const state = openAdoptedFixture()
    const unread = db!.insertMessage({
      runId: state.adoptedRunId,
      deliveryContract: 'legacy_direct',
      from: 'term_legacy_coord',
      to: 'term_legacy_worker',
      subject: 'unread history'
    })
    db!.insertMessage({
      runId: state.adoptedRunId,
      deliveryContract: 'legacy_direct',
      from: 'other',
      to: 'other',
      subject: 'not addressed'
    })

    const history = db!.getLegacyMailHistory({ principalId: state.workerPrincipalId })

    expect(history.recovery).toBe(false)
    expect(history.messages.map((message) => message.subject)).toEqual([
      'read worker mail',
      'second worker page',
      'unread history'
    ])
    expect(db!.getMessageById(unread.id)?.read).toBe(0)
  })

  it('resolves legacy principals and completion evidence only within exact assignments', () => {
    const state = openAdoptedFixture()
    const taskId = db!.getDispatchContextById(state.fixture.legacyDispatchId)!.task_id
    const payload = JSON.stringify({ taskId, dispatchId: state.fixture.legacyDispatchId })
    const completion = db!.insertMessage({
      runId: state.adoptedRunId,
      deliveryContract: 'legacy_direct',
      from: 'term_legacy_worker',
      to: 'term_legacy_coord',
      subject: 'Completed',
      body: 'done',
      type: 'worker_done',
      payload
    })

    expect(
      db!.resolveLegacyWorkerCandidate({
        runId: state.adoptedRunId,
        terminalHandle: 'term_legacy_worker',
        paneKey: 'tab_reminted:33333333-3333-4333-8333-333333333333',
        taskId
      })
    ).toMatchObject({ dispatch: { id: state.fixture.legacyDispatchId } })
    expect(
      db!.resolveLegacyWorkerCandidate({
        runId: state.adoptedRunId,
        terminalHandle: 'term_legacy_worker',
        paneKey: 'tab_wrong:99999999-9999-4999-8999-999999999999',
        taskId
      })
    ).toBeUndefined()
    expect(
      db!.resolveLegacyCoordinatorCandidate({
        runId: state.adoptedRunId,
        terminalHandle: 'term_legacy_coord',
        paneKey: 'tab_coord:44444444-4444-4444-8444-444444444444'
      })
    ).toMatchObject({ terminalHandle: 'term_legacy_coord' })
    expect(
      db!.findLegacyWorkerCompletion({
        principalId: state.workerPrincipalId,
        taskId,
        recipientHandle: 'term_legacy_coord',
        subject: 'Completed',
        body: 'done',
        payload
      })
    ).toMatchObject({ id: completion.id })
  })

  it('prevents an unproven coordinator from taking over an active adopted Run', () => {
    const state = openAdoptedFixture()
    expect(() =>
      db!.bindRun({
        runId: state.adoptedRunId,
        coordinatorHandle: 'term_other',
        coordinatorPaneKey: 'tab_other:55555555-5555-4555-8555-555555555555'
      })
    ).toThrow(/only its attested coordinator/)

    const bound = db!.bindRun({
      runId: state.adoptedRunId,
      coordinatorHandle: 'term_legacy_coord',
      coordinatorPaneKey: 'tab_coord:44444444-4444-4444-8444-444444444444',
      allowLegacyCompatibility: true
    })
    expect(bound).toMatchObject({ coordinator_handle: 'term_legacy_coord' })
    expect(
      db!.bindRun({
        runId: state.adoptedRunId,
        coordinatorHandle: 'term_legacy_coord',
        coordinatorPaneKey: 'tab_coord:44444444-4444-4444-8444-444444444444'
      })
    ).toMatchObject({ coordinator_handle: 'term_legacy_coord' })
  })

  it('commits legacy messages, lifecycle effects, and invocation receipts exactly once', () => {
    const state = openAdoptedFixture()
    const params = {
      principalId: state.workerPrincipalId,
      operationKey: 'invocation_1',
      method: 'orchestration.send',
      payloadHash: 'payload_1',
      message: {
        to: 'term_legacy_coord',
        subject: 'alive',
        type: 'heartbeat' as const
      },
      lifecycle: { kind: 'heartbeat' as const, at: '2026-07-28T12:00:00.000Z' }
    }

    const first = db!.commitLegacyLifecycleOperation(params)
    const replay = db!.commitLegacyLifecycleOperation(params)

    expect(replay).toMatchObject({
      duplicate: true,
      message: { id: first.message.id },
      receipt: { effect_id: first.message.id }
    })
    expect(db!.getDispatchContextById(state.fixture.legacyDispatchId)?.last_heartbeat_at).toBe(
      '2026-07-28T12:00:00.000Z'
    )
    expect(db!.getUnreadMessages('term_legacy_coord')).toEqual([])
    expect(db!.getUndeliveredUnreadMessages('term_legacy_coord')).toEqual([])
    expect(() =>
      db!.commitLegacyLifecycleOperation({ ...params, payloadHash: 'different' })
    ).toThrow(/different input/)
  })

  it('reconstructs a matching pre-receipt settlement without changing its persisted outcome', () => {
    const state = openAdoptedFixture()
    const accepted = db!.insertMessage({
      runId: state.adoptedRunId,
      deliveryContract: 'legacy_direct',
      from: 'term_legacy_worker',
      to: 'term_legacy_coord',
      subject: 'Completed',
      type: 'worker_done'
    })
    expect(
      db!.settleWorkerReport({
        taskId: db!.getDispatchContextById(state.fixture.legacyDispatchId)!.task_id,
        dispatchId: state.fixture.legacyDispatchId,
        outcome: 'succeeded',
        result: 'accepted by A'
      })
    ).toMatchObject({ action: 'settled', duplicate: false })

    const reconstructed = db!.commitLegacyLifecycleOperation({
      principalId: state.workerPrincipalId,
      operationKey: `settlement:${state.fixture.legacyDispatchId}`,
      method: 'orchestration.send',
      payloadHash: 'settlement_payload',
      message: {
        existingId: accepted.id,
        to: 'term_legacy_coord',
        subject: 'Completed',
        type: 'worker_done'
      },
      lifecycle: {
        kind: 'worker_report',
        taskId: db!.getDispatchContextById(state.fixture.legacyDispatchId)!.task_id,
        outcome: 'succeeded',
        result: 'accepted by A'
      }
    })

    expect(reconstructed).toMatchObject({
      duplicate: false,
      message: { id: accepted.id },
      settlement: { action: 'settled', outcome: 'succeeded', duplicate: true }
    })
    expect(db!.getLegacyCompatibilityPrincipal(state.workerPrincipalId)?.status).toBe('settled')
  })

  it('rejects cross-cutover completion reconstruction for another recipient', () => {
    const state = openAdoptedFixture()
    const taskId = db!.getDispatchContextById(state.fixture.legacyDispatchId)!.task_id
    const payload = JSON.stringify({ taskId, dispatchId: state.fixture.legacyDispatchId })
    const foreign = db!.insertMessage({
      runId: state.adoptedRunId,
      deliveryContract: 'legacy_direct',
      from: 'term_legacy_worker',
      to: 'term_other_coord',
      subject: 'Completed',
      body: 'accepted elsewhere',
      type: 'worker_done',
      payload
    })
    db!.settleWorkerReport({
      taskId,
      dispatchId: state.fixture.legacyDispatchId,
      outcome: 'succeeded',
      result: 'accepted elsewhere'
    })
    const beforeIds = db!.getInbox(100).map((message) => message.id)

    expect(
      db!.findLegacyWorkerCompletion({
        principalId: state.workerPrincipalId,
        taskId,
        recipientHandle: 'term_legacy_coord',
        subject: 'Completed',
        body: 'accepted elsewhere',
        payload
      })
    ).toBeUndefined()
    expect(() =>
      db!.commitLegacyLifecycleOperation({
        principalId: state.workerPrincipalId,
        operationKey: 'wrong_recipient_retry',
        method: 'orchestration.send',
        payloadHash: 'wrong_recipient_retry_payload',
        message: {
          to: 'term_legacy_coord',
          subject: 'Completed',
          body: 'accepted elsewhere',
          type: 'worker_done',
          payload
        },
        lifecycle: {
          kind: 'worker_report',
          taskId,
          outcome: 'succeeded',
          result: 'accepted elsewhere'
        }
      })
    ).toThrow(/settled/)
    expect(() =>
      db!.commitLegacyLifecycleOperation({
        principalId: state.workerPrincipalId,
        operationKey: 'wrong_recipient_reconstruction',
        method: 'orchestration.send',
        payloadHash: 'wrong_recipient_payload',
        message: {
          existingId: foreign.id,
          to: 'term_legacy_coord',
          subject: 'Completed',
          body: 'accepted elsewhere',
          type: 'worker_done',
          payload
        },
        lifecycle: {
          kind: 'worker_report',
          taskId,
          outcome: 'succeeded',
          result: 'accepted elsewhere'
        }
      })
    ).toThrow(/does not match this principal/)
    expect(db!.getInbox(100).map((message) => message.id)).toEqual(beforeIds)
    expect(
      db!.getLegacyOperationReceipt(state.workerPrincipalId, 'wrong_recipient_reconstruction')
    ).toBeUndefined()
    expect(
      db!.getLegacyOperationReceipt(state.workerPrincipalId, 'wrong_recipient_retry')
    ).toBeUndefined()
    expect(db!.getTask(taskId)).toMatchObject({
      status: 'completed',
      result: 'accepted elsewhere'
    })
  })

  it('uses invocation identity for repeated asks and atomically conflicts divergent replies', () => {
    const state = openAdoptedFixture()
    const ask = {
      principalId: state.workerPrincipalId,
      operationKey: 'ask_invocation_1',
      method: 'orchestration.ask',
      payloadHash: 'ask_payload',
      question: 'Same text?',
      options: ['yes', 'no'],
      recipientHandle: 'term_legacy_coord'
    }
    const first = db!.commitLegacyAskOperation(ask)
    const replay = db!.commitLegacyAskOperation(ask)
    const repeated = db!.commitLegacyAskOperation({
      ...ask,
      operationKey: 'ask_invocation_2'
    })

    expect(replay).toMatchObject({ duplicate: true, question: { message_id: first.message.id } })
    expect(repeated.message.id).not.toBe(first.message.id)
    expect(db!.findPendingLegacyQuestions(ask)).toHaveLength(2)
    expect(
      db!.findPendingLegacyQuestions({
        ...ask,
        question: '  Same text?\r\n',
        options: ['yes ', ' no']
      })
    ).toHaveLength(2)

    const reply = {
      principalId: state.coordinatorPrincipalId,
      operationKey: 'reply_invocation_1',
      method: 'orchestration.reply',
      payloadHash: 'reply_payload',
      questionId: first.message.id,
      body: 'yes'
    }
    const answered = db!.commitLegacyReplyOperation(reply)
    const answerReplay = db!.commitLegacyReplyOperation(reply)
    expect(answerReplay).toMatchObject({
      duplicate: true,
      message: { id: answered.message.id }
    })
    expect(
      db!
        .findLegacyQuestionsBySemanticIdentity(ask)
        .find((row) => row.question.message_id === first.message.id)
    ).toMatchObject({ question: { status: 'answered' }, answerAcknowledged: false })
    db!.acknowledgeLegacyQuestionAnswer({
      principalId: state.workerPrincipalId,
      questionId: first.message.id,
      answerMessageId: answered.message.id
    })
    expect(
      db!
        .findLegacyQuestionsBySemanticIdentity(ask)
        .find((row) => row.question.message_id === first.message.id)
    ).toMatchObject({ answerAcknowledged: true })
    expect(() =>
      db!.commitLegacyReplyOperation({
        ...reply,
        operationKey: 'reply_invocation_2',
        payloadHash: 'different_reply',
        body: 'no'
      })
    ).toThrow(/different answer/)

    const currentTask = db!.createTask({ runId: state.adoptedRunId, spec: 'current retry' })
    const currentDispatch = db!.createDispatchContext(currentTask.id, 'term_current_retry')
    const currentQuestion = db!.createQuestion({
      runId: state.adoptedRunId,
      dispatchId: currentDispatch.id,
      askerHandle: 'term_current_retry',
      question: 'Current question?'
    })
    expect(() =>
      db!.commitLegacyReplyOperation({
        ...reply,
        operationKey: 'reply_current_question',
        payloadHash: 'current_question',
        questionId: currentQuestion.message.id
      })
    ).toThrow(/not actionable/)
  })
})
