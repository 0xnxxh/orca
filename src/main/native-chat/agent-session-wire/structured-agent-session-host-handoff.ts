import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { importLegacyTranscriptIntoJournal } from '../agent-session-journal/journal-legacy-import'
import { journalIdentityFor } from './structured-agent-session-attach'
import type { DeferredStructuredAgentSessionEventSink } from './structured-agent-session-event-sink'
import type {
  StructuredAgentSessionHostDeps,
  StructuredAgentSessionHostSession
} from './structured-agent-session-host'
import { StructuredAgentSessionHandoffCoordinator } from './structured-agent-session-handoff'
import type { AgentSessionSubscribers } from './structured-agent-session-subscribers'

type HostHandoffAccess = {
  session: (sessionId: string) => StructuredAgentSessionHostSession
  eventSink: (sessionId: string) => DeferredStructuredAgentSessionEventSink
  flush: (sessionId: string) => Promise<void>
  serialize: (sessionId: string, task: () => Promise<void>) => Promise<void>
  subscribers: AgentSessionSubscribers
  now: () => number
}

export type StructuredAgentSessionHostHandoff = StructuredAgentSessionHandoffCoordinator

export function createStructuredAgentSessionHostHandoff(
  deps: StructuredAgentSessionHostDeps,
  host: HostHandoffAccess
): StructuredAgentSessionHostHandoff {
  return new StructuredAgentSessionHandoffCoordinator({
    store: deps.store,
    claimKeyId: deps.claimKeyId,
    ...(deps.handoffTransport ? { transport: deps.handoffTransport } : {}),
    session: host.session,
    suspendNative: async (sessionId) => {
      await deps.adapter.closeSession?.(sessionId)
      await host.flush(sessionId)
      host.eventSink(sessionId).unbind()
    },
    acquireNative: (input) => acquireNativeHandoffOwner(deps, host, input),
    acquireNativeStop: async (sessionId, turnId, fence) =>
      (await deps.adapter.cancelTurn({ sessionId, turnId, fence })).cancelled,
    importTuiHistory: (input) => importTuiHistory(deps, host, input),
    publish: (sessionId, status) => {
      const session = host.session(sessionId)
      const fence = deps.store.getRecord(sessionId)?.lease.runtimeFence ?? session.fence
      host.subscribers.handoff(sessionId, session.journal, fence, status)
    },
    schedule: host.serialize,
    now: host.now
  })
}

async function importTuiHistory(
  deps: StructuredAgentSessionHostDeps,
  host: HostHandoffAccess,
  input: { sessionId: string; fence: number; transcriptPath?: string }
): Promise<void> {
  const session = host.session(input.sessionId)
  const record = deps.store.getRecord(input.sessionId)
  const head = record?.providerHandleChain.at(-1)
  if (!record || head?.handle.provider !== 'codex') {
    throw new Error('agent_session_identity_required')
  }
  const imported = await importLegacyTranscriptIntoJournal({
    journal: session.journal,
    agent: 'codex',
    sessionId: head.handle.threadId,
    fence: input.fence,
    ...(input.transcriptPath ? { options: { filePath: input.transcriptPath } } : {})
  })
  if (!imported.ok) {
    throw new Error(imported.error)
  }
  host.subscribers.reset(input.sessionId, session.journal, 'epoch_changed', input.fence)
}

async function acquireNativeHandoffOwner(
  deps: StructuredAgentSessionHostDeps,
  host: HostHandoffAccess,
  input: { sessionId: string; fence: number; spawnToken: string }
): Promise<AgentSessionRecord> {
  const session = host.session(input.sessionId)
  const record = deps.store.getRecord(input.sessionId)
  if (!record) {
    throw new Error('agent_session_identity_required')
  }
  const eventSink = host.eventSink(input.sessionId)
  eventSink.unbind()
  await eventSink.drained()
  const acquired = await deps.adapter.acquire({
    identity: journalIdentityFor(record, session.params),
    fence: input.fence,
    spawnToken: input.spawnToken,
    events: eventSink.sink
  })
  let proved: AgentSessionRecord
  try {
    await deps.store.commitProcessIdentity({
      sessionId: input.sessionId,
      fence: input.fence,
      process: acquired.process,
      now: host.now()
    })
    proved = await deps.store.proveOwner({
      sessionId: input.sessionId,
      fence: input.fence,
      link: acquired.link,
      now: host.now()
    })
  } catch (error) {
    await deps.adapter.releaseAcquisition?.({ sessionId: input.sessionId })
    throw error
  }
  session.fence = proved.lease.runtimeFence
  eventSink.bind({
    journal: session.journal,
    fence: proved.lease.runtimeFence,
    publish: () => host.subscribers.publish(input.sessionId, session.journal)
  })
  host.subscribers.snapshot(input.sessionId, session.journal, proved.lease.runtimeFence)
  return proved
}
