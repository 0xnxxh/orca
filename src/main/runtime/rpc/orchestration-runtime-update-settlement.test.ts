import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../shared/protocol-version'
import Database from '../../sqlite/sync-database'
import { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationDb } from '../orchestration/db'
import type { RpcRequest, RpcResponse } from './core'
import { RpcDispatcher } from './dispatcher'
import { ORCHESTRATION_METHODS } from './methods/orchestration'

const WORKER_HANDLE = 'term_pre_update_worker'
const WORKER_PANE = 'tab_pre_update:33333333-3333-4333-8333-333333333333'
const COORDINATOR_HANDLE = 'term_pre_update_coordinator'
const CURRENT_COORDINATOR_HANDLE = 'term_current_coordinator'
const CURRENT_COORDINATOR_PANE = 'tab_current:44444444-4444-4444-8444-444444444444'
const PROCESS_INCARNATION = 'pty-stable:incarnation-stable'
const WORK_BYTES = Buffer.from('preserved filesystem work\n', 'utf8')

type Harness = {
  db: OrchestrationDb
  dispatcher: RpcDispatcher
  taskId: string
  dispatchId: string
  capability: string
  adoptedRunId: string
  markerPath: string
}

type UpdateRpcRequest = RpcRequest & {
  compatibilityInvocationId?: string
  orchestrationCompatibilityEvidence?: {
    terminalHandle?: string
    paneKey?: string
    launchToken?: string
  }
}

const harnesses: Harness[] = []
const tempDirs: string[] = []

afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.db.close()
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createUpdateHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'orca-update-settlement-'))
  tempDirs.push(dir)
  const markerPath = join(dir, 'worker-result.txt')
  const dbPath = join(dir, 'orchestration.db')
  writeFileSync(markerPath, WORK_BYTES)

  const oldRuntimeDb = new OrchestrationDb(dbPath)
  const task = oldRuntimeDb.createTask({
    spec: 'finish work across an app update',
    createdByTerminalHandle: COORDINATOR_HANDLE
  })
  const dispatch = oldRuntimeDb.createDispatchContext(task.id, WORKER_HANDLE, WORKER_PANE)
  const capability = oldRuntimeDb.mintDispatchCapability({
    dispatchId: dispatch.id,
    paneKey: WORKER_PANE,
    processIncarnation: PROCESS_INCARNATION
  })
  oldRuntimeDb.close()

  const raw = new Database(dbPath)
  raw.exec(`
    DROP INDEX IF EXISTS idx_messages_delivery_contract;
    DROP TABLE IF EXISTS legacy_mail_receipts;
    DROP TABLE IF EXISTS legacy_operation_receipts;
    DROP TABLE IF EXISTS legacy_compatibility_principals;
    DROP TABLE IF EXISTS legacy_adoptions;
  `)
  raw.pragma('user_version = 18')
  raw.close()

  const db = new OrchestrationDb(dbPath)
  const adoptedRunId = db.getTask(task.id)?.run_id
  expect(adoptedRunId).toBeTruthy()
  const runtime = new OrcaRuntimeService()
  runtime.setOrchestrationDb(db)
  vi.spyOn(runtime, 'getTerminalPaneKey').mockReturnValue(null)
  vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockImplementation((handle) =>
    handle === WORKER_HANDLE ? PROCESS_INCARNATION : null
  )
  Object.defineProperty(runtime, 'verifyOrchestrationCompatibilityCaller', {
    value: vi.fn((evidence: UpdateRpcRequest['orchestrationCompatibilityEvidence']) => {
      if (
        !evidence?.launchToken ||
        !evidence.terminalHandle ||
        !evidence.paneKey ||
        ![
          `${WORKER_HANDLE}:${WORKER_PANE}`,
          `${CURRENT_COORDINATOR_HANDLE}:${CURRENT_COORDINATOR_PANE}`
        ].includes(`${evidence.terminalHandle}:${evidence.paneKey}`)
      ) {
        return null
      }
      return {
        hostScope: { kind: 'local', hostId: 'local' },
        terminalHandle: evidence.terminalHandle,
        paneKey: evidence.paneKey,
        processIncarnation: PROCESS_INCARNATION,
        launchTokenHash: createHash('sha256').update(evidence.launchToken).digest('hex')
      }
    })
  })
  vi.spyOn(runtime, 'notifyMessageArrived').mockImplementation(() => {})
  const harness = {
    db,
    dispatcher: new RpcDispatcher({ runtime, methods: ORCHESTRATION_METHODS }),
    taskId: task.id,
    dispatchId: dispatch.id,
    capability,
    adoptedRunId: adoptedRunId as string,
    markerPath
  }
  harnesses.push(harness)
  return harness
}

function request(
  method: string,
  params: Record<string, unknown>,
  role: 'worker' | 'current-coordinator',
  invocationId: string
): UpdateRpcRequest {
  const worker = role === 'worker'
  return {
    id: `rpc_${invocationId}`,
    authToken: 'caller-token',
    method,
    params,
    orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
    orchestrationRequestId: invocationId,
    compatibilityInvocationId: invocationId,
    orchestrationCompatibilityEvidence: {
      terminalHandle: worker ? WORKER_HANDLE : CURRENT_COORDINATOR_HANDLE,
      paneKey: worker ? WORKER_PANE : CURRENT_COORDINATOR_PANE,
      launchToken: `${role}-launch-token`
    }
  } as unknown as UpdateRpcRequest
}

function entityCounts(db: OrchestrationDb): Record<string, number> {
  const sqlite = (db as unknown as { db: Database.Database }).db
  return Object.fromEntries(
    ['tasks', 'dispatch_contexts', 'messages', 'legacy_compatibility_principals'].map((table) => [
      table,
      (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
    ])
  )
}

function resultOf(response: RpcResponse): Record<string, unknown> {
  expect(response.ok).toBe(true)
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return response.result as Record<string, unknown>
}

function expectIdentityAndWorkPreserved(harness: Harness): void {
  expect(harness.db.getDispatchContextById(harness.dispatchId)).toMatchObject({
    id: harness.dispatchId,
    task_id: harness.taskId,
    assignee_handle: WORKER_HANDLE,
    assignee_pane_key: WORKER_PANE,
    process_incarnation: PROCESS_INCARNATION
  })
  expect(readFileSync(harness.markerPath)).toEqual(WORK_BYTES)
}

describe('orchestration runtime update settlement', () => {
  it('settles one retained worker report exactly once after its pane handle is orphaned', async () => {
    const harness = createUpdateHarness()
    const completion = request(
      'orchestration.send',
      {
        from: WORKER_HANDLE,
        to: COORDINATOR_HANDLE,
        type: 'worker_done',
        subject: 'Completed',
        body: 'work survived the update',
        payload: JSON.stringify({
          taskId: harness.taskId,
          dispatchId: harness.dispatchId,
          outcome: 'succeeded',
          filesModified: ['worker-result.txt']
        })
      },
      'worker',
      'retained-worker-done'
    )
    completion.orchestrationCapability = harness.capability

    const first = await harness.dispatcher.dispatch(completion)
    const replay = await harness.dispatcher.dispatch({ ...completion, id: 'rpc_replay' })
    const firstResult = resultOf(first)
    const replayResult = resultOf(replay)

    expect(firstResult).toMatchObject({ message: { type: 'worker_done' } })
    expect(replayResult).toMatchObject({
      message: firstResult.message,
      mutation: { requestId: 'retained-worker-done', replayed: true }
    })
    expect(harness.db.getTask(harness.taskId)).toMatchObject({ status: 'completed' })
    expect(harness.db.getDispatchContextById(harness.dispatchId)).toMatchObject({
      status: 'completed'
    })
    expect(entityCounts(harness.db)).toEqual({
      tasks: 1,
      dispatch_contexts: 1,
      messages: 1,
      legacy_compatibility_principals: 0
    })
    expectIdentityAndWorkPreserved(harness)
  })

  it('allows only the attested current coordinator to take over retained live work', async () => {
    const harness = createUpdateHarness()
    const takeover = request(
      'orchestration.runUse',
      {
        id: harness.adoptedRunId,
        from: CURRENT_COORDINATOR_HANDLE,
        takeoverLegacy: true
      },
      'current-coordinator',
      'authenticated-takeover'
    )

    const spoofed = await harness.dispatcher.dispatch({
      ...takeover,
      id: 'rpc_spoofed',
      params: { ...(takeover.params as Record<string, unknown>), from: COORDINATOR_HANDLE }
    })
    const first = await harness.dispatcher.dispatch(takeover)
    const replay = await harness.dispatcher.dispatch({ ...takeover, id: 'rpc_takeover_replay' })
    const firstResult = resultOf(first)
    const replayResult = resultOf(replay)

    expect(spoofed).toMatchObject({ ok: false, error: { code: 'stable_pane_required' } })
    expect(firstResult).toMatchObject({
      run: {
        id: harness.adoptedRunId,
        coordinator_handle: CURRENT_COORDINATOR_HANDLE,
        coordinator_pane_key: CURRENT_COORDINATOR_PANE
      }
    })
    expect(replayResult).toMatchObject({
      run: firstResult.run,
      mutation: { requestId: 'authenticated-takeover', replayed: true }
    })
    expect(harness.db.getTask(harness.taskId)).toMatchObject({ status: 'dispatched' })
    expect(harness.db.getDispatchContextById(harness.dispatchId)).toMatchObject({
      status: 'dispatched'
    })
    expect(entityCounts(harness.db)).toEqual({
      tasks: 1,
      dispatch_contexts: 1,
      messages: 0,
      legacy_compatibility_principals: 0
    })
    expectIdentityAndWorkPreserved(harness)
  })

  it('rejects a current worker whose claimed pane lacks exact attestation', async () => {
    const harness = createUpdateHarness()
    const completion = request(
      'orchestration.send',
      {
        from: WORKER_HANDLE,
        to: COORDINATOR_HANDLE,
        type: 'worker_done',
        subject: 'Completed',
        body: 'forged completion',
        payload: JSON.stringify({
          taskId: harness.taskId,
          dispatchId: harness.dispatchId,
          outcome: 'succeeded'
        })
      },
      'worker',
      'forged-worker-done'
    )
    completion.orchestrationCapability = harness.capability
    completion.orchestrationCompatibilityEvidence = {
      ...completion.orchestrationCompatibilityEvidence!,
      paneKey: 'tab_foreign:99999999-9999-4999-8999-999999999999'
    }

    const response = await harness.dispatcher.dispatch(completion)

    expect(response).toMatchObject({
      ok: true,
      result: {
        lifecycle: {
          action: 'rejected',
          code: 'dispatch_capability_invalid',
          reason: 'The caller is not the Dispatch pane.'
        }
      }
    })
    expect(harness.db.getTask(harness.taskId)).toMatchObject({ status: 'dispatched' })
    expect(harness.db.getDispatchContextById(harness.dispatchId)).toMatchObject({
      status: 'dispatched'
    })
    expectIdentityAndWorkPreserved(harness)
  })
})
