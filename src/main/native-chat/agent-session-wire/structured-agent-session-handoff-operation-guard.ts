import type { AgentSessionHandoffStatus } from '../../../shared/agent-session-wire'

type ActiveOperation = { operationId: string; fingerprint: string }

export class StructuredAgentSessionHandoffOperationGuard {
  private readonly activeBySession = new Map<string, ActiveOperation>()

  check(input: {
    sessionId: string
    operationId: string
    fingerprint: string
    action: 'start' | 'cancel-queued' | 'retry'
    status?: AgentSessionHandoffStatus
  }): 'new' | 'replay' | 'conflict' {
    const active = this.activeBySession.get(input.sessionId)
    if (
      (input.status?.operationId === input.operationId &&
        input.status.phase !== 'idle' &&
        input.action === 'start') ||
      (active?.operationId === input.operationId && active.fingerprint === input.fingerprint)
    ) {
      return 'replay'
    }
    return active?.operationId === input.operationId ? 'conflict' : 'new'
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
