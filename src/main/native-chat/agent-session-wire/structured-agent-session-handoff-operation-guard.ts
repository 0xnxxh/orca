import type { AgentSessionHandoffStatus } from '../../../shared/agent-session-wire'
import type { AgentSessionOperationOutcome } from '../../../shared/agent-session-operation-ledger'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'

type ActiveOperation = { callerKey: string; operationId: string; fingerprint: string }

export type HandoffOperationDecision =
  | { decision: 'new' }
  | { decision: 'replay'; outcome: AgentSessionOperationOutcome }
  | { decision: 'retry' }
  | { decision: 'refused'; code: 'agent_session_operation_conflict' | string }

export class StructuredAgentSessionHandoffOperationGuard {
  private readonly activeBySession = new Map<string, ActiveOperation>()

  constructor(private readonly store: AgentSessionRecordStore) {}

  async check(input: {
    callerKey: string
    sessionId: string
    operationId: string
    fingerprint: string
    action: 'start' | 'cancel-queued' | 'retry'
    status?: AgentSessionHandoffStatus
    now: number
  }): Promise<HandoffOperationDecision> {
    const active = this.activeBySession.get(input.sessionId)
    if (
      active?.operationId === input.operationId &&
      (active.fingerprint !== input.fingerprint || active.callerKey !== input.callerKey)
    ) {
      return { decision: 'refused', code: 'agent_session_operation_conflict' }
    }
    const ledger = await this.store.admitOperation({
      callerKey: input.callerKey,
      operationId: input.operationId,
      fingerprint: input.fingerprint,
      now: input.now
    })
    if (ledger.decision === 'refused') {
      return { decision: 'refused', code: ledger.code }
    }
    if (ledger.decision === 'admit') {
      return { decision: 'new' }
    }
    if (input.action === 'retry' && ledger.row.outcome.status === 'failed') {
      await this.store.recordOperationOutcome({
        callerKey: input.callerKey,
        operationId: input.operationId,
        outcome: { status: 'pending' }
      })
      return { decision: 'retry' }
    }
    if (
      ledger.row.outcome.status === 'pending' &&
      !active &&
      input.status?.operationId !== input.operationId
    ) {
      return { decision: 'new' }
    }
    return { decision: 'replay', outcome: ledger.row.outcome }
  }

  start(sessionId: string, operation: ActiveOperation): void {
    this.activeBySession.set(sessionId, operation)
  }

  finish(sessionId: string, operationId: string): void {
    if (this.activeBySession.get(sessionId)?.operationId === operationId) {
      this.activeBySession.delete(sessionId)
    }
  }
}
