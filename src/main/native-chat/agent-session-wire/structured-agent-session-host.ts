// The structured agent-session host: one place where the lease, the journal,
// and the provider adapter meet.
//
// Every mutating call takes the same route — recompute the fingerprint, admit
// through the durable operation ledger, check the lease, then act — so no
// method can grow its own admission rules. Calls against one session are
// serialized; the journal's own queue orders writes, but admission has to be
// single-file too or two clients could both read one prompt as pending.

import { randomUUID } from 'node:crypto'
import type {
  AgentJournalCursor,
  AgentJournalMessageItem
} from '../../../shared/agent-session-journal-types'
import type { AgentSessionOwnerProbe } from '../../../shared/agent-session-lease-adjudication'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import {
  admitAgentSessionMutation,
  agentSessionFingerprintConflict,
  computeAgentSessionPayloadFingerprint
} from '../../../shared/agent-session-mutation-envelope'
import type {
  AgentSessionAttachResult,
  AgentSessionCancelResult,
  AgentSessionHistoryRequest,
  AgentSessionHistoryResult,
  AgentSessionMutationEnvelope,
  AgentSessionMutationResult,
  AgentSessionOptionResult,
  AgentSessionPromptResult,
  AgentSessionSendResult,
  AgentSessionWireRefusal
} from '../../../shared/agent-session-wire'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import { readAgentSessionHistory } from './agent-session-history-page'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import type { AgentSessionAttachParams } from './structured-agent-session-attach'
import { performAttach } from './structured-agent-session-attach-flow'
import { createRestartReconciler } from './structured-agent-session-restart-reconcile'
import {
  cancelPlan,
  promptPlan,
  sendPlan,
  setOptionPlan,
  type MutationPlan
} from './structured-agent-session-mutation-plans'
import {
  AgentSessionSubscribers,
  type AgentSessionSubscriberEmit
} from './structured-agent-session-subscribers'
import type { AgentSessionTurnContext, TurnOutcome } from './structured-agent-session-turns'

export type StructuredAgentSessionCaller = {
  /** Stable per-client identity; scopes the operation ledger and records who
   *  answered a prompt. */
  callerKey: string
}

export type StructuredAgentSessionHostDeps = {
  store: AgentSessionRecordStore
  adapter: StructuredAgentSessionAdapter
  journalRoot: string
  /** Key id the host's claims are minted under. */
  claimKeyId: string
  probeOwner?: (record: AgentSessionRecord) => Promise<AgentSessionOwnerProbe>
  mintSpawnToken?: () => string
  now?: () => number
}

type SessionState = { journal: AgentSessionJournal; params: AgentSessionAttachParams }

function refuse(refusal: AgentSessionWireRefusal): { ok: false; refusal: AgentSessionWireRefusal } {
  return { ok: false, refusal }
}

const NO_SESSION: AgentSessionWireRefusal = {
  code: 'agent_session_ownership_unknown',
  message: 'This host holds no attached session by that id.'
}

export class StructuredAgentSessionHost {
  private readonly sessions = new Map<string, SessionState>()
  private readonly subscribers = new AgentSessionSubscribers()
  private readonly chains = new Map<string, Promise<unknown>>()
  private readonly reconcileLeases: (sessionId: string) => Promise<AgentSessionWireRefusal | null>

  constructor(private readonly deps: StructuredAgentSessionHostDeps) {
    this.reconcileLeases = createRestartReconciler({
      store: deps.store,
      probe: (record) => this.probeRecord(record),
      now: () => this.now()
    })
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /** Per-session single file. A rejected task must not poison the chain. */
  private serialize<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const prior = this.chains.get(sessionId) ?? Promise.resolve()
    const next = prior.then(task, task)
    this.chains.set(
      sessionId,
      next.catch(() => undefined)
    )
    return next
  }

  /**
   * `create` and `ensure` in one: a null expected fence means the session must
   * not exist yet, any other value is a compare-and-swap against the lease.
   */
  attach(
    caller: StructuredAgentSessionCaller,
    params: AgentSessionAttachParams
  ): Promise<AgentSessionMutationResult<AgentSessionAttachResult>> {
    return this.serialize(params.envelope.sessionId, async () => {
      const sessionId = params.envelope.sessionId
      const unreconciled = await this.reconcileLeases(sessionId)
      if (unreconciled) {
        return refuse(unreconciled)
      }
      return performAttach({
        store: this.deps.store,
        adapter: this.deps.adapter,
        journalRoot: this.deps.journalRoot,
        authority: {
          spawnToken: this.deps.mintSpawnToken?.() ?? randomUUID(),
          claimKeyId: this.deps.claimKeyId,
          handoffOperationId: params.envelope.clientOperationId,
          probe: await this.probeOwner(sessionId)
        },
        callerKey: caller.callerKey,
        params,
        now: () => this.now(),
        onAttached: (attached) => {
          this.sessions.set(sessionId, { journal: attached.journal, params })
          if (attached.recovery) {
            this.subscribers.reset(sessionId, attached.journal, attached.recovery.reset)
          } else {
            this.subscribers.publish(sessionId, attached.journal)
          }
        }
      })
    })
  }

  /**
   * Liveness of whatever currently owns the session. Never client-asserted: a
   * client that could claim the owner is gone could evict a live one. Without a
   * host prober the answer is `indeterminate`, which routes to manual recovery
   * rather than a silent takeover.
   */
  private probeOwner(sessionId: string): Promise<AgentSessionOwnerProbe> {
    const record = this.deps.store.getRecord(sessionId)
    if (!record || record.lease.ownerProcess === null) {
      return Promise.resolve({ outcome: 'reservation-unused' })
    }
    return this.probeRecord(record)
  }

  private probeRecord(record: AgentSessionRecord): Promise<AgentSessionOwnerProbe> {
    return (
      this.deps.probeOwner?.(record) ??
      Promise.resolve({
        outcome: 'indeterminate',
        reason: 'This host cannot probe structured session owners.'
      })
    )
  }

  send(
    caller: StructuredAgentSessionCaller,
    params: { envelope: AgentSessionMutationEnvelope; body: AgentJournalMessageItem }
  ): Promise<AgentSessionMutationResult<AgentSessionSendResult>> {
    return this.mutate(caller, params.envelope, sendPlan(params))
  }

  cancel(
    caller: StructuredAgentSessionCaller,
    params: { envelope: AgentSessionMutationEnvelope; turnId: string }
  ): Promise<AgentSessionMutationResult<AgentSessionCancelResult>> {
    return this.mutate(caller, params.envelope, cancelPlan(params))
  }

  respondToPrompt(
    caller: StructuredAgentSessionCaller,
    params: {
      envelope: AgentSessionMutationEnvelope
      kind: 'approval' | 'question'
      itemId: string
      expectedRevision: number
      optionId: string
    }
  ): Promise<AgentSessionMutationResult<AgentSessionPromptResult>> {
    return this.mutate(caller, params.envelope, promptPlan(params))
  }

  setOption(
    caller: StructuredAgentSessionCaller,
    params: { envelope: AgentSessionMutationEnvelope; key: string; value: string }
  ): Promise<AgentSessionMutationResult<AgentSessionOptionResult>> {
    return this.mutate(caller, params.envelope, setOptionPlan(params))
  }

  private mutate<TValue>(
    caller: StructuredAgentSessionCaller,
    envelope: AgentSessionMutationEnvelope,
    plan: MutationPlan<TValue>
  ): Promise<AgentSessionMutationResult<TValue>> {
    return this.serialize(envelope.sessionId, () => this.runMutation(caller, envelope, plan))
  }

  private async runMutation<TValue>(
    caller: StructuredAgentSessionCaller,
    envelope: AgentSessionMutationEnvelope,
    plan: MutationPlan<TValue>
  ): Promise<AgentSessionMutationResult<TValue>> {
    const session = this.sessions.get(envelope.sessionId)
    const record = this.deps.store.getRecord(envelope.sessionId)
    if (!session || !record) {
      return refuse(NO_SESSION)
    }
    const hostFingerprint = computeAgentSessionPayloadFingerprint({
      method: plan.method,
      sessionId: envelope.sessionId,
      fields: plan.fields
    })
    const conflict = agentSessionFingerprintConflict(envelope, hostFingerprint)
    if (conflict) {
      return refuse(conflict)
    }
    const admission = admitAgentSessionMutation({
      envelope,
      hostFingerprint,
      ledger: await this.deps.store.admitOperation({
        callerKey: caller.callerKey,
        operationId: envelope.clientOperationId,
        fingerprint: hostFingerprint,
        now: this.now()
      }),
      lease: record.lease
    })
    if (admission.decision === 'refused') {
      return refuse(admission.refusal)
    }

    const fence = record.lease.runtimeFence
    const ctx = this.contextFor(caller, session, envelope.sessionId, fence)
    if (admission.decision === 'replay') {
      const recorded = plan.replay(ctx)
      if (recorded) {
        return { ok: true, replayed: true, fence, cursor: ctx.journal.cursor(), value: recorded }
      }
      // Nothing durable landed, so this id is about to run for the first time.
      // A refused call leaves its ledger row behind, and replaying past the
      // lease and the fence would let a resend act under an owner that has since
      // changed — so a first run pays the full admission price either way.
      const rerun = admitAgentSessionMutation({
        envelope,
        hostFingerprint,
        ledger: { decision: 'admit', row: admission.row },
        lease: record.lease
      })
      if (rerun.decision === 'refused') {
        return refuse(rerun.refusal)
      }
    }

    const outcome = await this.finish(caller, envelope, plan, ctx)
    return outcome.ok
      ? { ok: true, replayed: false, fence, cursor: ctx.journal.cursor(), value: outcome.value }
      : refuse(outcome.refusal)
  }

  private contextFor(
    caller: StructuredAgentSessionCaller,
    session: SessionState,
    sessionId: string,
    fence: number
  ): AgentSessionTurnContext {
    return {
      sessionId,
      journal: session.journal,
      fence,
      adapter: this.deps.adapter,
      resolvedBy: caller.callerKey,
      publish: () => this.subscribers.publish(sessionId, session.journal),
      now: () => this.now()
    }
  }

  /** Runs the effect and settles its ledger row, including on a throw — a row
   *  left `pending` would replay as unresolvable forever. */
  private async finish<TValue>(
    caller: StructuredAgentSessionCaller,
    envelope: AgentSessionMutationEnvelope,
    plan: MutationPlan<TValue>,
    ctx: AgentSessionTurnContext
  ): Promise<TurnOutcome<TValue>> {
    const settle = (
      outcome: Parameters<AgentSessionRecordStore['recordOperationOutcome']>[0]['outcome']
    ) =>
      this.deps.store.recordOperationOutcome({
        callerKey: caller.callerKey,
        operationId: envelope.clientOperationId,
        outcome
      })
    try {
      const outcome = await plan.run(ctx)
      await settle(
        outcome.ok
          ? { status: 'succeeded', sessionId: envelope.sessionId }
          : { status: 'failed', code: outcome.refusal.code }
      )
      return outcome
    } catch (error) {
      await settle({ status: 'unknown' })
      throw error
    }
  }

  /**
   * Paged read. Throws `agent_session_ownership_unknown` for a session this host
   * has not attached — a reset would tell the client to reload something that
   * does not exist here.
   */
  history(request: AgentSessionHistoryRequest): AgentSessionHistoryResult {
    return readAgentSessionHistory(this.requireSession(request.sessionId).journal, request)
  }

  subscribe(input: {
    id: string
    sessionId: string
    emit: AgentSessionSubscriberEmit
    cursor?: AgentJournalCursor
  }): () => void {
    const session = this.requireSession(input.sessionId)
    const fence = this.deps.store.getRecord(input.sessionId)?.lease.runtimeFence ?? 0
    return this.subscribers.open({ ...input, journal: session.journal, fence })
  }

  unsubscribe(sessionId: string, id: string): void {
    this.subscribers.close(sessionId, id)
  }

  private requireSession(sessionId: string): SessionState {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(NO_SESSION.code)
    }
    return session
  }
}
