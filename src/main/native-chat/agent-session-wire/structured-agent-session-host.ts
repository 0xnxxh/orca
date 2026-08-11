// The structured agent-session host: one place where the lease, the journal,
// and the provider adapter meet.
//
// Every mutating call takes the same route — recompute the fingerprint, admit
// through the durable operation ledger, check the lease, then act — so no
// method can grow its own admission rules. Calls against one session are
// serialized; the journal's own queue orders writes, but admission has to be
// single-file too or two clients could both read one prompt as pending.

import { randomUUID } from 'node:crypto'
import type { AgentJournalMessageItem } from '../../../shared/agent-session-journal-types'
import type { AgentSessionOwnerProbe } from '../../../shared/agent-session-lease-adjudication'
import type {
  AgentSessionExecutionLocation,
  AgentSessionRecord
} from '../../../shared/agent-session-record'
import type {
  AgentSessionAttachResult,
  AgentSessionCancelResult,
  AgentSessionHistoryRequest,
  AgentSessionHistoryResult,
  AgentSessionHandoffRequest,
  AgentSessionHandoffResult,
  AgentSessionHandoffStatus,
  AgentSessionMutationEnvelope,
  AgentSessionMutationResult,
  AgentSessionOptionResult,
  AgentSessionOptionsResult,
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
import {
  admitAndRunAgentSessionMutation,
  AGENT_SESSION_NOT_ATTACHED,
  refuseAgentSessionMutation
} from './structured-agent-session-mutation-admission'
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
  type AgentSessionSubscribeInput
} from './structured-agent-session-subscribers'
import { StructuredAgentSessionTaskQueue } from './structured-agent-session-task-queue'
import { restoreStructuredAgentSessionsOnRestart } from './structured-agent-session-restart-restore'
import type { StructuredAgentSessionHandoffTransport } from './structured-agent-session-handoff-types'
import {
  createStructuredAgentSessionHostHandoff,
  type StructuredAgentSessionHostHandoff
} from './structured-agent-session-host-handoff'
import { StructuredAgentSessionHostRuntimeState } from './structured-agent-session-host-runtime-state'

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
  /** A journal append the provider streamed that could not be written. Unset
   *  drops it: the alternative is throwing inside the provider's notification
   *  callback, which would take the connection down over one lost row. */
  onEventSinkError?: (input: { sessionId: string; error: unknown }) => void
  handoffTransport?: StructuredAgentSessionHandoffTransport
}

export type StructuredAgentSessionHostSession = {
  journal: AgentSessionJournal
  params: AgentSessionAttachParams
  fence: number
}

export class StructuredAgentSessionHost {
  private readonly sessions = new Map<string, StructuredAgentSessionHostSession>()
  private readonly subscribers = new AgentSessionSubscribers()
  private readonly tasks = new StructuredAgentSessionTaskQueue()
  private readonly runtimeState: StructuredAgentSessionHostRuntimeState
  private readonly reconcileLeases: (sessionId: string) => Promise<AgentSessionWireRefusal | null>
  private readonly handoffs: StructuredAgentSessionHostHandoff

  constructor(readonly deps: StructuredAgentSessionHostDeps) {
    this.runtimeState = new StructuredAgentSessionHostRuntimeState(deps)
    this.reconcileLeases = createRestartReconciler({
      store: deps.store,
      probe: (record) => this.runtimeState.probeRecord(record),
      now: () => this.now()
    })
    this.handoffs = createStructuredAgentSessionHostHandoff(deps, {
      session: (sessionId) => this.requireSession(sessionId),
      eventSink: (sessionId) => this.runtimeState.eventSinkFor(sessionId),
      flush: (sessionId) => this.flushStreamedEvents(sessionId),
      serialize: (sessionId, task) => this.serialize(sessionId, task),
      subscribers: this.subscribers,
      now: this.now
    })
  }

  private now = (): number => this.deps.now?.() ?? Date.now()

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  supportsCreate(location: AgentSessionExecutionLocation, agent: string): boolean {
    return agent === 'codex' && (this.deps.adapter.supportsLocation?.(location) ?? false)
  }

  listSessionTabs(): {
    sessionId: string
    workspaceId: string
    agent: 'codex'
  }[] {
    return [...this.sessions.entries()].map(([sessionId, session]) => ({
      sessionId,
      workspaceId: session.params.location.workspaceId,
      agent: 'codex' as const
    }))
  }

  async restoreReadableSessions(): Promise<void> {
    await restoreStructuredAgentSessionsOnRestart({
      store: this.deps.store,
      journalRoot: this.deps.journalRoot,
      records: this.deps.store.listRecords().filter((record) => record.provider === 'codex'),
      reconcile: this.reconcileLeases,
      operationId: () =>
        `${Math.trunc(this.now()).toString().padStart(13, '0')}-${randomUUID().replaceAll('-', '')}`,
      resume: (params) =>
        this.attach({ callerKey: 'trusted-local:host-restart' }, params).then(
          (result) => result.ok
        ),
      serialize: (sessionId, task) => this.serialize(sessionId, task),
      hasSession: (sessionId) => this.sessions.has(sessionId),
      onReadable: (sessionId, restored) => this.sessions.set(sessionId, restored)
    })
  }

  private serialize<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    return this.tasks.serialize(sessionId, task)
  }

  /**
   * `create` and `ensure` in one: a null expected fence means the session must
   * not exist yet, any other value is a compare-and-swap against the lease.
   */
  attach(
    caller: StructuredAgentSessionCaller,
    params: AgentSessionAttachParams
  ): Promise<AgentSessionMutationResult<AgentSessionAttachResult>> {
    const attaching = this.serialize(params.envelope.sessionId, async () => {
      const sessionId = params.envelope.sessionId
      const unreconciled = await this.reconcileLeases(sessionId)
      if (unreconciled) {
        return refuseAgentSessionMutation(unreconciled)
      }
      const eventSink = this.runtimeState.eventSinkFor(sessionId)
      const attached = await performAttach({
        store: this.deps.store,
        adapter: this.deps.adapter,
        journalRoot: this.deps.journalRoot,
        eventSink: eventSink.sink,
        onAcquiring: () => eventSink.unbind(),
        beforeJournalOpen: async () => {
          eventSink.unbind()
          await eventSink.drained()
        },
        authority: {
          spawnToken: this.deps.mintSpawnToken?.() ?? randomUUID(),
          claimKeyId: this.deps.claimKeyId,
          handoffOperationId: params.envelope.clientOperationId,
          probe: await this.runtimeState.probeOwner(sessionId)
        },
        callerKey: caller.callerKey,
        params,
        now: () => this.now(),
        onAttached: (attached) => {
          const fence = this.deps.store.getRecord(sessionId)?.lease.runtimeFence ?? 0
          const previousFence = this.sessions.get(sessionId)?.fence
          this.sessions.set(sessionId, { journal: attached.journal, params, fence })
          if (attached.recovery) {
            this.subscribers.reset(sessionId, attached.journal, attached.recovery.reset, fence)
          } else if (previousFence !== undefined && previousFence !== fence) {
            this.subscribers.snapshot(sessionId, attached.journal, fence)
          } else {
            this.subscribers.publish(sessionId, attached.journal)
          }
          // Bound last: everything the provider streamed while the journal was
          // opening lands after the attach result the client is about to read,
          // never interleaved with it.
          eventSink.bind({
            journal: attached.journal,
            fence,
            publish: () => this.subscribers.publish(sessionId, attached.journal)
          })
        }
      })
      // A refused attach that never reached a journal leaves the sink holding
      // writes nothing will ever drain.
      if (!attached.ok && !this.sessions.has(sessionId)) {
        eventSink.close()
        this.runtimeState.discardEventSink(sessionId)
      }
      return attached
    })
    return this.tasks.trackAttach(attaching)
  }

  /** Settles every row the provider streamed. Callers that must read the
   *  journal immediately after provider activity await this first. */
  flushStreamedEvents(sessionId: string): Promise<void> {
    return this.runtimeState.flushEventSink(sessionId)
  }

  /** Settles final provider rows after every child has stopped producing them. */
  async flushAllStreamedEvents(): Promise<void> {
    // An acquired provider can still be opening its journal; bind before draining.
    await this.tasks.drainAttaches()
    await this.runtimeState.flushAllEventSinks()
  }

  send(
    caller: StructuredAgentSessionCaller,
    params: {
      envelope: AgentSessionMutationEnvelope
      body: AgentJournalMessageItem
      retryUnknown?: true
      beforeRun?: () => void
    }
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

  readOptions(sessionId: string): Promise<AgentSessionOptionsResult> {
    return this.serialize(sessionId, async () => {
      const session = this.requireSession(sessionId)
      if (!this.deps.adapter.readOptions) {
        throw new Error('structured_agent_session_options_unsupported')
      }
      return this.deps.adapter.readOptions({ sessionId, fence: session.fence })
    })
  }

  private mutate<TValue>(
    caller: StructuredAgentSessionCaller,
    envelope: AgentSessionMutationEnvelope,
    plan: MutationPlan<TValue>
  ): Promise<AgentSessionMutationResult<TValue>> {
    return this.serialize(envelope.sessionId, () =>
      admitAndRunAgentSessionMutation({
        store: this.deps.store,
        adapter: this.deps.adapter,
        callerKey: caller.callerKey,
        envelope,
        plan,
        journal: this.sessions.get(envelope.sessionId)?.journal,
        publish: (journal) => this.subscribers.publish(envelope.sessionId, journal),
        now: () => this.now()
      })
    )
  }

  requestHandoff(
    params: AgentSessionHandoffRequest
  ): AgentSessionMutationResult<AgentSessionHandoffResult> {
    this.requireSession(params.envelope.sessionId)
    return this.handoffs.request(params)
  }

  handoffStatus(sessionId: string): AgentSessionHandoffStatus {
    this.requireSession(sessionId)
    return this.handoffs.status(sessionId)
  }

  /**
   * Paged read. Throws `agent_session_ownership_unknown` for a session this host
   * has not attached — a reset would tell the client to reload something that
   * does not exist here.
   */
  history(request: AgentSessionHistoryRequest): AgentSessionHistoryResult {
    const result = readAgentSessionHistory(this.requireSession(request.sessionId).journal, request)
    const fence = this.deps.store.getRecord(request.sessionId)?.lease.runtimeFence
    if (fence === undefined) {
      return result
    }
    return result.ok ? { ...result, page: { ...result.page, fence } } : { ...result, fence }
  }

  subscribe(input: AgentSessionSubscribeInput): () => void {
    const session = this.requireSession(input.sessionId)
    const fence = this.deps.store.getRecord(input.sessionId)?.lease.runtimeFence ?? 0
    return this.subscribers.open({
      ...input,
      journal: session.journal,
      fence,
      handoff: this.handoffs.status(input.sessionId)
    })
  }

  unsubscribe = (sessionId: string, id: string): void => this.subscribers.close(sessionId, id)

  private requireSession(sessionId: string): StructuredAgentSessionHostSession {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(AGENT_SESSION_NOT_ATTACHED.code)
    }
    return session
  }
}
