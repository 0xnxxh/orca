import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../shared/protocol-version'
import type { OrchestrationCompatibilityEvidence } from '../../../shared/orchestration-compatibility-evidence'
import Database from '../../sqlite/sync-database'
import { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationDb } from '../orchestration/db'
import type { RpcRequest, RpcResponse } from './core'
import { RpcDispatcher } from './dispatcher'
import { ORCHESTRATION_METHODS } from './methods/orchestration'

const WORKER_HANDLE = 'term_legacy_worker'
const WORKER_PANE = 'tab_worker:33333333-3333-4333-8333-333333333333'
const COORDINATOR_HANDLE = 'term_legacy_coord'
const COORDINATOR_PANE = 'tab_coord:44444444-4444-4444-8444-444444444444'

type Transport = 'dispatch' | 'websocket'

type Harness = {
  db: OrchestrationDb
  dispatcher: RpcDispatcher
  runtime: OrcaRuntimeService
  adoptedRunId: string
  taskId: string
  dispatchId: string
  notify: ReturnType<typeof vi.spyOn>
  verify: ReturnType<typeof vi.spyOn>
}

const tempDirs: string[] = []
const databases: OrchestrationDb[] = []

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close()
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'orca-legacy-dispatcher-'))
  tempDirs.push(dir)
  const dbPath = join(dir, 'orchestration.db')
  const before = new OrchestrationDb(dbPath)
  const task = before.createTask({
    spec: 'legacy assignment',
    createdByTerminalHandle: COORDINATOR_HANDLE
  })
  const dispatch = before.createDispatchContext(task.id, WORKER_HANDLE, WORKER_PANE)
  before.close()

  const raw = new Database(dbPath)
  raw.exec(`
    UPDATE dispatch_contexts SET process_incarnation = 'process-1';
    DROP INDEX IF EXISTS idx_messages_delivery_contract;
    DROP TABLE legacy_mail_receipts;
    DROP TABLE legacy_operation_receipts;
    DROP TABLE legacy_compatibility_principals;
    DROP TABLE legacy_adoptions;
  `)
  raw.pragma('user_version = 18')
  raw.close()

  const db = new OrchestrationDb(dbPath)
  databases.push(db)
  const adoptedRunId = db.getLegacyAdoption()?.adopted_run_id as string
  const runtime = new OrcaRuntimeService()
  runtime.setOrchestrationDb(db)
  vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
    handle === COORDINATOR_HANDLE ? COORDINATOR_PANE : handle === WORKER_HANDLE ? WORKER_PANE : null
  )
  const verify = vi
    .spyOn(runtime, 'verifyOrchestrationCompatibilityCaller')
    .mockImplementation((evidence) => {
      const validWorker =
        evidence?.terminalHandle === WORKER_HANDLE && evidence.paneKey === WORKER_PANE
      const validCoordinator =
        evidence?.terminalHandle === COORDINATOR_HANDLE && evidence.paneKey === COORDINATOR_PANE
      if ((!validWorker && !validCoordinator) || !evidence?.launchToken) {
        return null
      }
      return {
        hostScope: { kind: 'local', hostId: 'local' },
        terminalHandle: evidence.terminalHandle as string,
        paneKey: evidence.paneKey as string,
        processIncarnation: 'process-1',
        launchTokenHash: createHash('sha256').update(evidence.launchToken).digest('hex')
      }
    })
  const notify = vi.spyOn(runtime, 'notifyMessageArrived').mockImplementation(() => {})
  return {
    db,
    dispatcher: new RpcDispatcher({ runtime, methods: ORCHESTRATION_METHODS }),
    runtime,
    adoptedRunId,
    taskId: task.id,
    dispatchId: dispatch.id,
    notify,
    verify
  }
}

function evidence(
  role: 'worker' | 'coordinator',
  valid = true
): OrchestrationCompatibilityEvidence {
  const worker = role === 'worker'
  return {
    terminalHandle: worker ? WORKER_HANDLE : COORDINATOR_HANDLE,
    paneKey: valid ? (worker ? WORKER_PANE : COORDINATOR_PANE) : 'tab_wrong:wrong-leaf',
    launchToken: `${role}-token`
  }
}

function request(
  method: string,
  params: unknown,
  proof: OrchestrationCompatibilityEvidence,
  invocationId: string
): RpcRequest {
  return {
    id: `rpc_${invocationId}`,
    authToken: 'caller-token',
    method,
    params,
    orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
    orchestrationRequestId: invocationId,
    compatibilityInvocationId: invocationId,
    orchestrationCompatibilityEvidence: proof
  }
}

async function invoke(
  dispatcher: RpcDispatcher,
  rpcRequest: RpcRequest,
  transport: Transport
): Promise<RpcResponse> {
  if (transport === 'dispatch') {
    return await dispatcher.dispatch(rpcRequest)
  }
  const replies: string[] = []
  await dispatcher.dispatchStreaming(rpcRequest, (reply) => replies.push(reply))
  expect(replies).toHaveLength(1)
  return JSON.parse(replies[0]) as RpcResponse
}

function counts(db: OrchestrationDb): Record<string, number> {
  const sqlite = (db as unknown as { db: Database.Database }).db
  return Object.fromEntries(
    [
      'messages',
      'legacy_compatibility_principals',
      'legacy_operation_receipts',
      'legacy_mail_receipts',
      'mutation_receipts'
    ].map((table) => [
      table,
      (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
    ])
  )
}

function escalationParams(harness: Harness) {
  return {
    from: WORKER_HANDLE,
    to: COORDINATOR_HANDLE,
    subject: 'Blocked',
    type: 'escalation',
    payload: JSON.stringify({ taskId: harness.taskId, dispatchId: harness.dispatchId })
  }
}

describe('legacy compatibility through RpcDispatcher', () => {
  it('rejects malformed current-contract input before compatibility attestation', async () => {
    const harness = createHarness()
    const before = counts(harness.db)
    const response = await harness.dispatcher.dispatch(
      request(
        'orchestration.send',
        { from: WORKER_HANDLE, type: 'escalation' },
        evidence('worker'),
        'malformed'
      )
    )

    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(harness.verify).not.toHaveBeenCalled()
    expect(counts(harness.db)).toEqual(before)
  })

  it.each([
    ['dispatch', true],
    ['dispatch', false],
    ['websocket', true],
    ['websocket', false]
  ] as const)(
    '%s routes task-only escalation with valid proof=%s and zero partial effects',
    async (transport, valid) => {
      const harness = createHarness()
      const before = counts(harness.db)
      const response = await invoke(
        harness.dispatcher,
        request(
          'orchestration.send',
          escalationParams(harness),
          evidence('worker', valid),
          `${transport}-${valid}`
        ),
        transport
      )

      if (!valid) {
        expect(response).toMatchObject({
          ok: false,
          error: { code: 'legacy_read_only' }
        })
        expect(counts(harness.db)).toEqual(before)
        expect(harness.notify).not.toHaveBeenCalled()
        return
      }

      expect(response).toMatchObject({
        ok: true,
        result: {
          message: { type: 'escalation', delivery_contract: 'legacy_direct' },
          legacyCompatibility: { replayed: false }
        }
      })
      expect(counts(harness.db)).toEqual({
        ...before,
        messages: before.messages + 1,
        legacy_compatibility_principals: before.legacy_compatibility_principals + 1,
        legacy_operation_receipts: before.legacy_operation_receipts + 1
      })
      expect(harness.notify).toHaveBeenCalledOnce()
    }
  )

  it('validates, infers, settles, and replays legacy worker completion exactly once', async () => {
    const harness = createHarness()
    const baseParams = {
      from: WORKER_HANDLE,
      to: COORDINATOR_HANDLE,
      type: 'worker_done',
      body: 'legacy result',
      payload: JSON.stringify({ taskId: harness.taskId, dispatchId: harness.dispatchId })
    }
    const before = counts(harness.db)
    const invalid = await harness.dispatcher.dispatch(
      request(
        'orchestration.send',
        { ...baseParams, subject: 'Completed', payload: JSON.stringify({ outcome: 'maybe' }) },
        evidence('worker'),
        'invalid-outcome'
      )
    )

    expect(invalid).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(counts(harness.db)).toEqual(before)

    const firstRequest = request(
      'orchestration.send',
      { ...baseParams, subject: 'Completed' },
      evidence('worker'),
      'completion'
    )
    const first = await harness.dispatcher.dispatch(firstRequest)
    const replay = await harness.dispatcher.dispatch({ ...firstRequest, id: 'rpc_replay' })
    const mismatch = await harness.dispatcher.dispatch({
      ...firstRequest,
      id: 'rpc_mismatch',
      params: { ...baseParams, subject: 'Changed completion' }
    })

    expect(first).toMatchObject({
      ok: true,
      result: {
        lifecycle: { action: 'settled', outcome: 'succeeded' },
        legacyCompatibility: { replayed: false }
      }
    })
    expect(replay).toMatchObject({
      ok: true,
      result: { legacyCompatibility: { replayed: true } }
    })
    expect(mismatch).toMatchObject({ ok: false, error: { code: 'request_mismatch' } })
    expect(harness.db.getTask(harness.taskId)?.status).toBe('completed')
    expect(harness.db.getDispatchContextById(harness.dispatchId)?.status).toBe('completed')
    expect(counts(harness.db)).toEqual({
      ...before,
      messages: before.messages + 1,
      legacy_compatibility_principals: before.legacy_compatibility_principals + 1,
      legacy_operation_receipts: before.legacy_operation_receipts + 1
    })
    expect(harness.notify).toHaveBeenCalledOnce()
  })

  it('rejects a legacy lifecycle recipient outside the adopted Run with zero effects', async () => {
    const harness = createHarness()
    const before = counts(harness.db)
    const response = await harness.dispatcher.dispatch(
      request(
        'orchestration.send',
        {
          ...escalationParams(harness),
          to: 'term_unrelated'
        },
        evidence('worker'),
        'wrong-recipient'
      )
    )

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'request_mismatch' }
    })
    expect(counts(harness.db)).toEqual(before)
    expect(harness.verify).not.toHaveBeenCalled()
    expect(harness.notify).not.toHaveBeenCalled()
  })

  it('rejects a reused pane whose live process incarnation is not the legacy worker', async () => {
    const harness = createHarness()
    const sqlite = (harness.db as unknown as { db: Database.Database }).db
    sqlite
      .prepare('UPDATE dispatch_contexts SET process_incarnation = ? WHERE id = ?')
      .run('different-process', harness.dispatchId)
    const before = counts(harness.db)

    const response = await harness.dispatcher.dispatch(
      request('orchestration.send', escalationParams(harness), evidence('worker'), 'reused-pane')
    )

    expect(response).toMatchObject({ ok: false, error: { code: 'legacy_read_only' } })
    expect(counts(harness.db)).toEqual(before)
    expect(harness.notify).not.toHaveBeenCalled()
  })

  it('rejects a legacy question recipient outside the adopted Run with zero effects', async () => {
    const harness = createHarness()
    const before = counts(harness.db)
    const response = await harness.dispatcher.dispatch(
      request(
        'orchestration.ask',
        {
          from: WORKER_HANDLE,
          to: 'term_unrelated',
          question: 'Proceed?',
          timeoutMs: 1
        },
        evidence('worker'),
        'wrong-question-recipient'
      )
    )

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'request_mismatch' }
    })
    expect(counts(harness.db)).toEqual(before)
    expect(harness.verify).not.toHaveBeenCalled()
    expect(harness.notify).not.toHaveBeenCalled()
  })

  it('does not infer an outcome for a current Dispatch when legacy adoption exists', async () => {
    const harness = createHarness()
    const run = harness.db.createRun({
      objective: 'current work',
      coordinatorHandle: 'term_current_coord',
      coordinatorPaneKey: 'tab_current_coord:55555555-5555-4555-8555-555555555555'
    })
    const task = harness.db.createTask({ spec: 'current assignment', runId: run.id })
    const dispatch = harness.db.createDispatchContext(
      task.id,
      'term_current_worker',
      'tab_current_worker:66666666-6666-4666-8666-666666666666',
      'current-launch-hash'
    )
    const before = counts(harness.db)
    const response = await harness.dispatcher.dispatch(
      request(
        'orchestration.send',
        {
          from: 'term_current_worker',
          to: COORDINATOR_HANDLE,
          subject: 'Completed',
          type: 'worker_done',
          payload: JSON.stringify({ taskId: task.id, dispatchId: dispatch.id })
        },
        {
          terminalHandle: 'term_current_worker',
          paneKey: 'tab_current_worker:66666666-6666-4666-8666-666666666666',
          launchToken: 'current-token'
        },
        'current-missing-outcome'
      )
    )

    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(harness.db.getTask(task.id)?.status).toBe('dispatched')
    expect(harness.db.getDispatchContextById(dispatch.id)?.status).toBe('dispatched')
    expect(counts(harness.db)).toEqual(before)
  })

  it('rejects invalid typed ACKs and consumes only the filtered legacy page', async () => {
    const harness = createHarness()
    await harness.dispatcher.dispatch(
      request(
        'orchestration.send',
        {
          ...escalationParams(harness),
          type: 'worker_done',
          subject: 'Completed',
          payload: JSON.stringify({ taskId: harness.taskId, dispatchId: harness.dispatchId })
        },
        evidence('worker'),
        'settle-for-mail'
      )
    )
    const status = harness.db.insertMessage({
      runId: harness.adoptedRunId,
      from: COORDINATOR_HANDLE,
      to: WORKER_HANDLE,
      subject: 'status first',
      type: 'status',
      deliveryContract: 'legacy_direct'
    })
    const question = harness.db.insertMessage({
      runId: harness.adoptedRunId,
      from: COORDINATOR_HANDLE,
      to: WORKER_HANDLE,
      subject: 'question second',
      type: 'question',
      deliveryContract: 'legacy_direct'
    })
    const check = await harness.dispatcher.dispatch(
      request(
        'orchestration.check',
        { terminal: WORKER_HANDLE, types: 'question' },
        evidence('worker'),
        'question-check'
      )
    )
    expect(check).toMatchObject({
      ok: true,
      result: {
        messages: [{ id: question.id }],
        legacyCompatibility: { ackMessageIds: [question.id] }
      }
    })

    const invalid = await harness.dispatcher.dispatch(
      request(
        'orchestration.check',
        {
          terminal: WORKER_HANDLE,
          compatibilityAck: JSON.stringify({
            messageIds: [question.id],
            types: ['not-a-message-type']
          })
        },
        evidence('worker'),
        'invalid-ack'
      )
    )
    expect(invalid).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(harness.db.getMessageById(status.id)?.read).toBe(0)
    expect(harness.db.getMessageById(question.id)?.read).toBe(0)

    const acknowledged = await harness.dispatcher.dispatch(
      request(
        'orchestration.check',
        {
          terminal: WORKER_HANDLE,
          compatibilityAck: JSON.stringify({
            messageIds: [question.id],
            types: ['question']
          })
        },
        evidence('worker'),
        'valid-ack'
      )
    )
    expect(acknowledged).toMatchObject({
      ok: true,
      result: { acknowledged: [question.id], legacyCompatibility: { acknowledged: true } }
    })
    expect(harness.db.getMessageById(status.id)?.read).toBe(0)
    expect(harness.db.getMessageById(question.id)?.read).toBe(1)
  })

  it('rejects invalid legacy check types before attestation or mail consumption', async () => {
    const harness = createHarness()
    const message = harness.db.insertMessage({
      runId: harness.adoptedRunId,
      from: COORDINATOR_HANDLE,
      to: WORKER_HANDLE,
      subject: 'retained status',
      type: 'status',
      deliveryContract: 'legacy_direct'
    })
    const before = counts(harness.db)
    const response = await harness.dispatcher.dispatch(
      request(
        'orchestration.check',
        { terminal: WORKER_HANDLE, types: 'status,not-a-message-type' },
        evidence('worker'),
        'invalid-types'
      )
    )

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument', message: 'Invalid --types: not-a-message-type' }
    })
    expect(counts(harness.db)).toEqual(before)
    expect(harness.db.getMessageById(message.id)?.read).toBe(0)
    expect(harness.verify).not.toHaveBeenCalled()
    expect(harness.notify).not.toHaveBeenCalled()
  })

  it.each(['dispatch', 'websocket'] as const)(
    '%s binds an attested coordinator once and rejects contradictory proof before binding',
    async (transport) => {
      const invalidHarness = createHarness()
      const invalidBefore = counts(invalidHarness.db)
      const rejected = await invoke(
        invalidHarness.dispatcher,
        request(
          'orchestration.runUse',
          { id: invalidHarness.adoptedRunId, from: COORDINATOR_HANDLE },
          evidence('coordinator', false),
          `run-use-invalid-${transport}`
        ),
        transport
      )
      expect(rejected).toMatchObject({ ok: false, error: { code: 'legacy_read_only' } })
      expect(invalidHarness.db.getRun(invalidHarness.adoptedRunId)?.consumer_generation).toBe(0)
      expect(counts(invalidHarness.db)).toEqual(invalidBefore)

      const harness = createHarness()
      const runUse = request(
        'orchestration.runUse',
        { id: harness.adoptedRunId, from: COORDINATOR_HANDLE },
        evidence('coordinator'),
        `run-use-${transport}`
      )
      const first = await invoke(harness.dispatcher, runUse, transport)
      const replay = await invoke(
        harness.dispatcher,
        { ...runUse, id: 'rpc_run-use-replay' },
        transport
      )
      expect(first).toMatchObject({
        ok: true,
        result: { binding: { consumerGeneration: 1 }, mutation: { replayed: false } }
      })
      expect(replay).toMatchObject({
        ok: true,
        result: { binding: { consumerGeneration: 1 }, mutation: { replayed: true } }
      })
      expect(harness.db.getRun(harness.adoptedRunId)?.consumer_generation).toBe(1)
    }
  )

  it('passes trusted coordinator scope to a failing handler without binding or receipts', async () => {
    const harness = createHarness()
    const before = counts(harness.db)
    const response = await harness.dispatcher.dispatch(
      request(
        'orchestration.taskUpdate',
        {
          id: 'task_missing',
          status: 'completed',
          callerTerminalHandle: COORDINATOR_HANDLE
        },
        evidence('coordinator'),
        'missing-task'
      )
    )

    expect(response).toMatchObject({ ok: false, error: { code: 'task_not_found' } })
    expect(harness.db.getRun(harness.adoptedRunId)?.consumer_generation).toBe(0)
    expect(counts(harness.db)).toEqual(before)
  })
})
