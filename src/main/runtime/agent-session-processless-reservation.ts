import type { AgentSessionRecord } from '../../shared/agent-session-record'

export type AgentSessionReservationProcesslessProof = {
  sessionId: string
  fence: number
  spawnToken: string
  now: number
}

export function markAgentSessionReservationProcessless(
  args: AgentSessionReservationProcesslessProof & { record: AgentSessionRecord }
): AgentSessionRecord {
  const { record } = args
  if (record.lease.runtimeFence !== args.fence || record.lease.unreconciled) {
    throw new Error('agent_session_checkpoint_stale')
  }
  if (
    record.lease.claimStatus !== 'reserved' ||
    record.lease.ownerProcess !== null ||
    record.lease.reservedSpawnToken !== args.spawnToken
  ) {
    throw new Error('agent_session_ownership_unknown')
  }
  return {
    ...record,
    lease: { ...record.lease, processlessAt: args.now },
    updatedAt: args.now
  }
}
