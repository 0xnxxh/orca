import { describe, expect, it } from 'vitest'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../shared/agent-session-record.test-fixture'
import { applyAgentSessionRestartAdjudication } from './agent-session-lease-transitions'

describe('agent session handoff restart transitions', () => {
  it('preserves the stopped owner and operation for durable retry', () => {
    const handoffOperationId = '1800000000000-00000000000000000000000000000001'
    const record = agentSessionRecordFixture(
      agentSessionLeaseFixture({
        runtimeKind: 'native',
        runtimeFence: 4,
        handoffStage: 'old-owner-stopped',
        handoffOperationId,
        claimStatus: 'released',
        ownerProcess: null,
        reservedSpawnToken: null,
        unreconciled: true
      })
    )

    const next = applyAgentSessionRestartAdjudication({
      record,
      probe: { outcome: 'reservation-unused' },
      now: 1_800_000_001_000
    })

    expect(next.lease).toMatchObject({
      runtimeKind: 'native',
      runtimeFence: 4,
      handoffStage: 'old-owner-stopped',
      handoffOperationId,
      claimStatus: 'released',
      ownerProcess: null,
      unreconciled: false
    })
  })
})
