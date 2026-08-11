import type {
  AgentSessionOwnerRuntimeKind,
  AgentSessionRecord
} from '../../shared/agent-session-record'
import { assertFence, reserveAgentSessionOwner, withLease } from './agent-session-lease-transitions'

export function stopAgentSessionOwnerForHandoff(args: {
  record: AgentSessionRecord
  expectedFence: number
  operationId: string
  now: number
}): AgentSessionRecord {
  const { record } = args
  assertFence(record.lease, args.expectedFence)
  if (
    record.lease.handoffStage !== 'preparing' ||
    record.lease.handoffOperationId !== args.operationId ||
    record.lease.ownerProcess === null
  ) {
    throw new Error('agent_session_ownership_unknown')
  }
  return withLease(record, {
    ...record.lease,
    runtimeFence: record.lease.runtimeFence + 1,
    handoffStage: 'old-owner-stopped',
    ownerProcess: null,
    reservedSpawnToken: null,
    processlessAt: null,
    claimStatus: 'released',
    lastRenewedAt: args.now,
    deathEvidence: {
      kind: 'exit-observed',
      detail: 'observed process exit',
      observedAt: args.now
    }
  })
}

export function reserveAgentSessionHandoffOwner(args: {
  record: AgentSessionRecord
  expectedFence: number
  runtimeKind: AgentSessionOwnerRuntimeKind
  spawnToken: string
  operationId: string
  claimKeyId: string
  now: number
  leaseTtlMs: number
}): AgentSessionRecord {
  return reserveAgentSessionOwner({
    record: args.record,
    expectedFence: args.expectedFence,
    probe: { outcome: 'reservation-unused' },
    reservation: {
      runtimeKind: args.runtimeKind,
      spawnToken: args.spawnToken,
      claimKeyId: args.claimKeyId,
      handoffOperationId: args.operationId,
      leaseTtlMs: args.leaseTtlMs,
      now: args.now
    }
  }).record
}

export function abandonAgentSessionHandoffAttempt(args: {
  record: AgentSessionRecord
  expectedFence: number
  operationId: string
  recoverableRuntimeKind: AgentSessionOwnerRuntimeKind
  now: number
}): AgentSessionRecord {
  const { record } = args
  assertFence(record.lease, args.expectedFence)
  if (
    record.lease.handoffStage !== 'new-owner-proving' ||
    record.lease.handoffOperationId !== args.operationId
  ) {
    throw new Error('agent_session_ownership_unknown')
  }
  return withLease(record, {
    ...record.lease,
    runtimeKind: args.recoverableRuntimeKind,
    runtimeFence: record.lease.runtimeFence + 1,
    handoffStage: 'old-owner-stopped',
    ownerProcess: null,
    reservedSpawnToken: null,
    processlessAt: null,
    claimStatus: 'released',
    lastRenewedAt: args.now,
    deathEvidence: {
      kind: 'exit-observed',
      detail: 'handoff launch attempt stopped',
      observedAt: args.now
    }
  })
}
