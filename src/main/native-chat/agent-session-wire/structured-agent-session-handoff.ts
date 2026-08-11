import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type {
  AgentSessionHandoffRequest,
  AgentSessionHandoffResult,
  AgentSessionHandoffStatus,
  AgentSessionMutationResult,
  AgentSessionWireRefusal
} from '../../../shared/agent-session-wire'
import { activeStructuredAgentSessionTurnId } from '../../../shared/structured-agent-session-projection'
import { setStoredAgentSessionHandoffStage } from '../../runtime/agent-session-handoff-record-transitions'
import {
  admitStructuredHandoffRequest,
  refuseAdmittedStructuredHandoff,
  replayedStructuredHandoffRefusal,
  structuredHandoffRetryIsAdmissible
} from './structured-agent-session-handoff-admission'
import { createStructuredHandoffFlowContext } from './structured-agent-session-handoff-flow-context'
import { StructuredAgentSessionHandoffFlowRunner } from './structured-agent-session-handoff-flow-runner'
import { StructuredAgentSessionHandoffQueue } from './structured-agent-session-handoff-queue'
import { StructuredAgentSessionHandoffOperationGuard } from './structured-agent-session-handoff-operation-guard'
import { restoreStructuredAgentSessionHandoff } from './structured-agent-session-handoff-restart'
import {
  structuredHandoffRefusal as refusal,
  structuredHandoffSuccess
} from './structured-agent-session-handoff-result'
import {
  failedStructuredHandoffStatus,
  idleStructuredHandoffStatus,
  structuredSessionHasPendingPrompt,
  switchingStructuredHandoffStatus
} from './structured-agent-session-handoff-status'
import type {
  StructuredAgentSessionHandoffDeps,
  StructuredAgentSessionHandoffFlowContext,
  StructuredTuiOwner
} from './structured-agent-session-handoff-types'

export class StructuredAgentSessionHandoffCoordinator {
  private readonly statuses = new Map<string, AgentSessionHandoffStatus>()
  private readonly queue = new StructuredAgentSessionHandoffQueue()
  private readonly tuiOwners = new Map<string, StructuredTuiOwner>()
  private readonly operationGuard: StructuredAgentSessionHandoffOperationGuard
  private readonly flowRunner: StructuredAgentSessionHandoffFlowRunner

  constructor(private readonly deps: StructuredAgentSessionHandoffDeps) {
    this.operationGuard = new StructuredAgentSessionHandoffOperationGuard(deps.store)
    this.flowRunner = new StructuredAgentSessionHandoffFlowRunner({
      deps,
      operationGuard: this.operationGuard,
      flowContext: () => this.flowContext(),
      fail: (params, error) => this.fail(params, error)
    })
  }

  status(sessionId: string): AgentSessionHandoffStatus {
    return (
      this.statuses.get(sessionId) ?? idleStructuredHandoffStatus(this.requireRecord(sessionId))
    )
  }

  async drain(): Promise<void> {
    await this.flowRunner.drain()
  }

  async restore(sessionId: string): Promise<void> {
    await restoreStructuredAgentSessionHandoff(
      {
        deps: this.deps,
        requireRecord: (id) => this.requireRecord(id),
        flowContext: () => this.flowContext(),
        retainOwner: (id, owner) => this.tuiOwners.set(id, owner),
        setStatus: (id, status) => this.setStatus(id, status)
      },
      sessionId
    )
  }

  async request(
    callerKey: string,
    params: AgentSessionHandoffRequest
  ): Promise<AgentSessionMutationResult<AgentSessionHandoffResult>> {
    const record = this.requireRecord(params.envelope.sessionId)
    const currentStatus = this.statuses.get(record.sessionId)
    const admission = await admitStructuredHandoffRequest({
      deps: this.deps,
      operationGuard: this.operationGuard,
      callerKey,
      params,
      record,
      ...(currentStatus ? { status: currentStatus } : {})
    })
    if (admission.decision === 'replay') {
      const replayedRefusal = replayedStructuredHandoffRefusal(admission.outcome)
      if (replayedRefusal) {
        return { ok: false, refusal: replayedRefusal }
      }
      return this.success(record.sessionId, true)
    }
    if (admission.decision === 'refused') {
      return { ok: false, refusal: admission.refusal }
    }
    const { fingerprint } = admission
    const action = params.action ?? 'start'
    if (action === 'cancel-queued') {
      if (currentStatus?.phase !== 'queued' || currentStatus.direction !== params.direction) {
        return this.refuseAdmitted(
          callerKey,
          params,
          'agent_session_operation_conflict',
          'No matching queued handoff exists.'
        )
      }
      this.queue.cancel(record.sessionId)
      this.setStatus(record.sessionId, idleStructuredHandoffStatus(record))
      await this.deps.store.recordOperationOutcome({
        callerKey,
        operationId: params.envelope.clientOperationId,
        outcome: { status: 'succeeded', sessionId: record.sessionId }
      })
      return this.success(record.sessionId, false)
    }
    if (!this.deps.transport) {
      return this.refuseAdmitted(
        callerKey,
        params,
        'structured_agent_session_unsupported',
        'Agent TUI handoff is unavailable on this host.'
      )
    }
    if (action === 'retry') {
      if (!structuredHandoffRetryIsAdmissible(this.status(record.sessionId), params)) {
        return this.refuseAdmitted(
          callerKey,
          params,
          'agent_session_operation_conflict',
          'This handoff is no longer retryable.'
        )
      }
      this.begin(callerKey, params, null, fingerprint)
      return this.success(record.sessionId, false)
    }
    const expectedOwner = params.direction === 'to-tui' ? 'native' : 'tui'
    if (record.lease.runtimeKind !== expectedOwner || record.lease.claimStatus !== 'live') {
      return this.refuseAdmitted(
        callerKey,
        params,
        'agent_session_conflict',
        `The ${expectedOwner} runtime does not own this session.`
      )
    }
    if (structuredSessionHasPendingPrompt(this.deps.session(record.sessionId).journal)) {
      return this.refuseAdmitted(
        callerKey,
        params,
        'agent_session_conflict',
        'Resolve the pending question or approval before switching.'
      )
    }
    const turnId = activeStructuredAgentSessionTurnId(
      this.deps.session(record.sessionId).journal.snapshot().items
    )
    const busy =
      expectedOwner === 'native' ? turnId !== null : this.tuiStatus(record.sessionId) !== 'idle'
    if (busy && params.mode === 'now') {
      return this.refuseAdmitted(
        callerKey,
        params,
        'agent_session_conflict',
        'The current turn must finish before switching.'
      )
    }
    if (busy && params.mode === 'after-turn') {
      this.queueAfterTurn(callerKey, params, fingerprint)
      return this.success(record.sessionId, false)
    }
    if (busy && expectedOwner === 'tui' && params.mode === 'stop-turn') {
      return this.refuseAdmitted(
        callerKey,
        params,
        'structured_agent_session_unsupported',
        'Exit the agent terminal after this turn to continue in chat.'
      )
    }
    this.begin(callerKey, params, turnId, fingerprint)
    return this.success(record.sessionId, false)
  }

  private async refuseAdmitted(
    callerKey: string,
    params: AgentSessionHandoffRequest,
    code: AgentSessionWireRefusal['code'],
    message: string
  ): Promise<AgentSessionMutationResult<AgentSessionHandoffResult>> {
    return refuseAdmittedStructuredHandoff({
      deps: this.deps,
      callerKey,
      params,
      refusal: refusal(code, message)
    })
  }

  private success(sessionId: string, replayed: boolean) {
    return structuredHandoffSuccess(this.deps, sessionId, replayed, this.status(sessionId))
  }

  private queueAfterTurn(
    callerKey: string,
    params: AgentSessionHandoffRequest,
    fingerprint: string
  ): void {
    const sessionId = params.envelope.sessionId
    this.setStatus(sessionId, {
      owner: params.direction === 'to-tui' ? 'native' : 'tui',
      direction: params.direction,
      phase: 'queued',
      stage: null,
      operationId: params.envelope.clientOperationId,
      hostLabel: this.deps.transport?.hostLabel
    })
    const tuiOwner = this.tuiOwners.get(sessionId)
    this.queue.enqueue(
      sessionId,
      (signal) =>
        params.direction === 'to-tui'
          ? !activeStructuredAgentSessionTurnId(
              this.deps.session(sessionId).journal.snapshot().items
            )
          : tuiOwner
            ? (this.deps.transport?.waitForTuiIdle(tuiOwner, signal) ?? false)
            : false,
      () => {
        const next = { ...params, mode: 'now' as const }
        this.begin(callerKey, next, null, fingerprint)
      }
    )
  }

  private begin(
    callerKey: string,
    params: AgentSessionHandoffRequest,
    turnId: string | null,
    fingerprint: string
  ): void {
    this.flowRunner.begin({
      callerKey,
      params,
      turnId,
      fingerprint
    })
  }

  private tuiStatus(sessionId: string): 'idle' | 'busy' {
    const owner = this.tuiOwners.get(sessionId)
    return owner ? (this.deps.transport?.tuiStatus(owner) ?? 'busy') : 'busy'
  }

  private flowContext(): StructuredAgentSessionHandoffFlowContext {
    return createStructuredHandoffFlowContext({
      deps: this.deps,
      owner: (sessionId) => this.tuiOwners.get(sessionId),
      retainOwner: (sessionId, owner) => this.tuiOwners.set(sessionId, owner),
      releaseOwner: (sessionId) => {
        this.tuiOwners.delete(sessionId)
      },
      setStatus: (sessionId, status) => this.setStatus(sessionId, status),
      enterPreparing: (record, operationId, direction) =>
        this.enterPreparing(record, operationId, direction),
      publishStage: (record, direction) => this.publishStage(record, direction),
      requireRecord: (sessionId) => this.requireRecord(sessionId)
    })
  }

  private async enterPreparing(
    record: AgentSessionRecord,
    operationId: string,
    direction: 'to-tui' | 'to-native'
  ): Promise<void> {
    const prepared = await setStoredAgentSessionHandoffStage(this.deps.store, {
      sessionId: record.sessionId,
      fence: record.lease.runtimeFence,
      stage: 'preparing',
      handoffOperationId: operationId,
      now: this.deps.now()
    })
    this.publishStage(prepared, direction)
  }

  private publishStage(record: AgentSessionRecord, direction: 'to-tui' | 'to-native'): void {
    this.setStatus(
      record.sessionId,
      switchingStructuredHandoffStatus(record, direction, this.deps.transport?.hostLabel)
    )
  }

  private fail(params: AgentSessionHandoffRequest, error: unknown): void {
    const record = this.requireRecord(params.envelope.sessionId)
    this.setStatus(
      record.sessionId,
      failedStructuredHandoffStatus(record, params, error, this.deps.transport?.hostLabel)
    )
  }

  private setStatus(sessionId: string, status: AgentSessionHandoffStatus): void {
    this.statuses.set(sessionId, status)
    this.deps.publish(sessionId, status)
  }

  private requireRecord(sessionId: string): AgentSessionRecord {
    const record = this.deps.store.getRecord(sessionId)
    if (!record) {
      throw new Error('agent_session_identity_required')
    }
    return record
  }
}
