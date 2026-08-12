import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../../shared/agent-session-record.test-fixture'
import type {
  AgentSessionHandoffRequest,
  AgentSessionHandoffStatus
} from '../../../shared/agent-session-wire'
import { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { queuedStructuredHandoffCanBegin } from './structured-agent-session-handoff-queue'
import { StructuredAgentSessionHandoffOperationGuard } from './structured-agent-session-handoff-operation-guard'

const NOW = 1_800_000_000_000
const SESSION = 'session-alpha-1'
const OPERATION_A = `${NOW}-00000000000000000000000000000001`
const OPERATION_B = `${NOW}-00000000000000000000000000000002`

let root: string | null = null

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true })
    root = null
  }
})

async function createGuard() {
  root = await mkdtemp(join(tmpdir(), 'orca-handoff-operation-guard-'))
  const store = await AgentSessionRecordStore.open({ directory: root, hostId: 'local' })
  return { guard: new StructuredAgentSessionHandoffOperationGuard(store), store }
}

function status(phase: 'switching' | 'queued' | 'idle'): AgentSessionHandoffStatus {
  return {
    owner: phase === 'idle' ? 'native' : 'none',
    direction: phase === 'idle' ? null : 'to-tui',
    phase,
    stage: phase === 'switching' ? 'preparing' : null,
    operationId: phase === 'idle' ? null : OPERATION_A
  }
}

describe('structured handoff operation ownership', () => {
  it('reserves one winner across concurrent admissions', async () => {
    const { guard } = await createGuard()
    const check = (operationId: string) =>
      guard.check({
        callerKey: operationId,
        sessionId: SESSION,
        operationId,
        fingerprint: operationId,
        action: 'start',
        now: NOW
      })

    const decisions = await Promise.all([check(OPERATION_A), check(OPERATION_B)])

    expect(decisions.map(({ decision }) => decision).sort()).toEqual(['new', 'refused'])
  })

  it.each(['switching', 'queued'] as const)(
    'durably refuses a distinct operation while the %s operation owns the session',
    async (phase) => {
      const { guard } = await createGuard()
      guard.start(SESSION, {
        callerKey: 'client-a',
        operationId: OPERATION_A,
        fingerprint: 'fingerprint-a'
      })

      expect(
        await guard.check({
          callerKey: 'client-b',
          sessionId: SESSION,
          operationId: OPERATION_B,
          fingerprint: 'fingerprint-b',
          action: 'start',
          status: status(phase),
          now: NOW
        })
      ).toEqual({ decision: 'refused', code: 'agent_session_operation_conflict' })

      guard.finish(SESSION, OPERATION_A)
      expect(
        await guard.check({
          callerKey: 'client-b',
          sessionId: SESSION,
          operationId: OPERATION_B,
          fingerprint: 'fingerprint-b',
          action: 'start',
          status: status('idle'),
          now: NOW
        })
      ).toMatchObject({
        decision: 'replay',
        outcome: { status: 'failed', code: 'agent_session_operation_conflict' }
      })
    }
  )

  it('admits only cancellation beside a queued operation', async () => {
    const { guard } = await createGuard()
    guard.start(SESSION, {
      callerKey: 'client-a',
      operationId: OPERATION_A,
      fingerprint: 'fingerprint-a'
    })

    await expect(
      guard.check({
        callerKey: 'client-b',
        sessionId: SESSION,
        operationId: OPERATION_B,
        fingerprint: 'fingerprint-b',
        action: 'cancel-queued',
        status: status('queued'),
        now: NOW
      })
    ).resolves.toEqual({ decision: 'new' })
  })
})

describe('queued handoff fence revalidation', () => {
  const params: AgentSessionHandoffRequest = {
    envelope: {
      sessionId: SESSION,
      clientOperationId: OPERATION_A,
      expectedRuntimeFence: 7,
      payloadFingerprint: 'fingerprint'
    },
    direction: 'to-tui',
    mode: 'after-turn',
    action: 'start'
  }
  const queued = status('queued')

  it('accepts the same live owner and fence', () => {
    const record = agentSessionRecordFixture(
      agentSessionLeaseFixture({ runtimeKind: 'native', ownerProcess: null })
    )
    expect(queuedStructuredHandoffCanBegin(record, queued, params)).toBe(true)
  })

  it.each([
    agentSessionLeaseFixture({ runtimeKind: 'native', runtimeFence: 8, ownerProcess: null }),
    agentSessionLeaseFixture({ runtimeKind: 'tui' }),
    agentSessionLeaseFixture({
      runtimeKind: 'native',
      ownerProcess: null,
      handoffStage: 'preparing'
    })
  ])('refuses a changed durable owner or fence', (lease) => {
    expect(queuedStructuredHandoffCanBegin(agentSessionRecordFixture(lease), queued, params)).toBe(
      false
    )
  })
})
