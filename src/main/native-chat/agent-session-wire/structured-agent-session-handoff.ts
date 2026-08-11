import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type {
  AgentSessionHandoffRequest,
  AgentSessionHandoffResult,
  AgentSessionHandoffStatus,
  AgentSessionMutationResult
} from '../../../shared/agent-session-wire'
import {
  agentSessionFingerprintConflict,
  computeAgentSessionPayloadFingerprint
} from '../../../shared/agent-session-mutation-envelope'
import { activeStructuredAgentSessionTurnId } from '../../../shared/structured-agent-session-projection'
import { setStoredAgentSessionHandoffStage } from '../../runtime/agent-session-handoff-record-transitions'
import { handoffStructuredSessionToTui } from './structured-agent-session-handoff-forward'
import { handoffStructuredSessionToNative } from './structured-agent-session-handoff-reverse'
import { StructuredAgentSessionHandoffQueue } from './structured-agent-session-handoff-queue'
import { StructuredAgentSessionHandoffOperationGuard } from './structured-agent-session-handoff-operation-guard'
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
  private readonly operationGuard = new StructuredAgentSessionHandoffOperationGuard()

  constructor(private readonly deps: StructuredAgentSessionHandoffDeps) {}

  status(sessionId: string): AgentSessionHandoffStatus {
    return (
      this.statuses.get(sessionId) ?? idleStructuredHandoffStatus(this.requireRecord(sessionId))
    )
  }

  request(
    params: AgentSessionHandoffRequest
  ): AgentSessionMutationResult<AgentSessionHandoffResult> {
    const record = this.requireRecord(params.envelope.sessionId)
    const fields = {
      direction: params.direction,
      mode: params.mode,
      action: params.action ?? 'start'
    }
    const fingerprint = computeAgentSessionPayloadFingerprint({
      method: 'agentSession.requestHandoff',
      sessionId: record.sessionId,
      fields
    })
    const conflict = agentSessionFingerprintConflict(params.envelope, fingerprint)
    if (conflict) {
      return { ok: false, refusal: conflict }
    }
    const currentStatus = this.statuses.get(record.sessionId)
    const operationDecision = this.operationGuard.check({
      sessionId: record.sessionId,
      operationId: params.envelope.clientOperationId,
      fingerprint,
      action: fields.action,
      ...(currentStatus ? { status: currentStatus } : {})
    })
    if (operationDecision === 'replay') {
      return this.success(record.sessionId, true)
    }
    if (operationDecision === 'conflict') {
      return {
        ok: false,
        refusal: refusal(
          'agent_session_operation_conflict',
          'This handoff operation is already running with different parameters.'
        )
      }
    }
    if (params.envelope.expectedRuntimeFence !== record.lease.runtimeFence) {
      return {
        ok: false,
        refusal: {
          code: 'agent_session_checkpoint_stale',
          message: 'The session owner changed before the handoff request arrived.',
          currentFence: record.lease.runtimeFence
        }
      }
    }
    if (fields.action === 'cancel-queued') {
      if (currentStatus?.phase !== 'queued' || currentStatus.direction !== params.direction) {
        return {
          ok: false,
          refusal: refusal('agent_session_operation_conflict', 'No matching queued handoff exists.')
        }
      }
      this.queue.cancel(record.sessionId)
      this.setStatus(record.sessionId, idleStructuredHandoffStatus(record))
      return this.success(record.sessionId, false)
    }
    if (!this.deps.transport) {
      return {
        ok: false,
        refusal: refusal(
          'structured_agent_session_unsupported',
          'Agent TUI handoff is unavailable on this host.'
        )
      }
    }
    if (fields.action === 'retry') {
      return this.retry(params)
    }
    const expectedOwner = params.direction === 'to-tui' ? 'native' : 'tui'
    if (record.lease.runtimeKind !== expectedOwner || record.lease.claimStatus !== 'live') {
      return {
        ok: false,
        refusal: refusal(
          'agent_session_conflict',
          `The ${expectedOwner} runtime does not own this session.`
        )
      }
    }
    if (structuredSessionHasPendingPrompt(this.deps.session(record.sessionId).journal)) {
      return {
        ok: false,
        refusal: refusal(
          'agent_session_conflict',
          'Resolve the pending question or approval before switching.'
        )
      }
    }
    const turnId = activeStructuredAgentSessionTurnId(
      this.deps.session(record.sessionId).journal.snapshot().items
    )
    const busy =
      expectedOwner === 'native' ? turnId !== null : this.tuiStatus(record.sessionId) !== 'idle'
    if (busy && params.mode === 'now') {
      return {
        ok: false,
        refusal: refusal('agent_session_conflict', 'The current turn must finish before switching.')
      }
    }
    if (busy && params.mode === 'after-turn') {
      this.queueAfterTurn(params)
      return this.success(record.sessionId, false)
    }
    if (busy && expectedOwner === 'tui' && params.mode === 'stop-turn') {
      return {
        ok: false,
        refusal: refusal(
          'structured_agent_session_unsupported',
          'Exit the agent terminal after this turn to continue in chat.'
        )
      }
    }
    this.begin(params, turnId, fingerprint)
    return this.success(record.sessionId, false)
  }

  private retry(
    params: AgentSessionHandoffRequest
  ): AgentSessionMutationResult<AgentSessionHandoffResult> {
    const status = this.status(params.envelope.sessionId)
    if (
      status?.phase !== 'failed' ||
      status.direction !== params.direction ||
      status.operationId !== params.envelope.clientOperationId ||
      status.error?.recoverableOwner === 'none'
    ) {
      return {
        ok: false,
        refusal: refusal('agent_session_operation_conflict', 'This handoff is no longer retryable.')
      }
    }
    this.begin(params, null, params.envelope.payloadFingerprint)
    return this.success(params.envelope.sessionId, false)
  }

  private success(
    sessionId: string,
    replayed: boolean
  ): AgentSessionMutationResult<AgentSessionHandoffResult> {
    return structuredHandoffSuccess(this.deps, sessionId, replayed, this.status(sessionId))
  }

  private queueAfterTurn(params: AgentSessionHandoffRequest): void {
    const sessionId = params.envelope.sessionId
    this.setStatus(sessionId, {
      owner: params.direction === 'to-tui' ? 'native' : 'tui',
      direction: params.direction,
      phase: 'queued',
      stage: null,
      operationId: params.envelope.clientOperationId,
      hostLabel: this.deps.transport?.hostLabel
    })
    this.queue.enqueue(
      sessionId,
      () =>
        params.direction === 'to-tui'
          ? !activeStructuredAgentSessionTurnId(
              this.deps.session(sessionId).journal.snapshot().items
            )
          : this.tuiStatus(sessionId) === 'idle',
      () => {
        const next = { ...params, mode: 'now' as const }
        this.begin(next, null, params.envelope.payloadFingerprint)
      }
    )
  }

  private begin(
    params: AgentSessionHandoffRequest,
    turnId: string | null,
    fingerprint: string
  ): void {
    const sessionId = params.envelope.sessionId
    this.operationGuard.start(sessionId, {
      operationId: params.envelope.clientOperationId,
      fingerprint
    })
    void this.deps
      .schedule(sessionId, async () => {
        if (turnId && params.mode === 'stop-turn') {
          const stopped = await this.stopNativeTurn(sessionId, turnId)
          if (!stopped) {
            throw new Error('The current turn did not acknowledge cancellation.')
          }
        }
        await (params.direction === 'to-tui'
          ? handoffStructuredSessionToTui(this.flowContext(), params, params.action === 'retry')
          : handoffStructuredSessionToNative(this.flowContext(), params, params.action === 'retry'))
      })
      .catch((error) => this.fail(params, error))
      .finally(() => this.operationGuard.finish(sessionId, params.envelope.clientOperationId))
  }

  private tuiStatus(sessionId: string): 'idle' | 'busy' {
    const owner = this.tuiOwners.get(sessionId)
    return owner ? (this.deps.transport?.tuiStatus(owner) ?? 'busy') : 'busy'
  }

  private flowContext(): StructuredAgentSessionHandoffFlowContext {
    return {
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
    }
  }

  private async stopNativeTurn(sessionId: string, turnId: string): Promise<boolean> {
    const record = this.requireRecord(sessionId)
    if (record.lease.runtimeKind !== 'native') {
      return false
    }
    const session = this.deps.session(sessionId)
    const result = await this.deps.acquireNativeStop?.(sessionId, turnId, session.fence)
    return result ?? false
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
