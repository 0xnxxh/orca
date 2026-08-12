import { join } from 'node:path'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { importLegacyTranscriptIntoJournal } from '../agent-session-journal/journal-legacy-import'
import { journalIdentityFor } from './structured-agent-session-attach'
import { canRestoreLiveTuiOwner } from './structured-agent-session-handoff-restart'
import type { DeferredStructuredAgentSessionEventSink } from './structured-agent-session-event-sink'
import type { StructuredAgentSessionHostDeps } from './structured-agent-session-host'
import type { StructuredAgentSessionHostSession } from './structured-agent-session-host-types'
import { StructuredAgentSessionHandoffCoordinator } from './structured-agent-session-handoff'
import { readNativeHandoffSessionOptions } from './structured-agent-session-handoff-options'
import type { AgentSessionSubscribers } from './structured-agent-session-subscribers'
import { StructuredTuiTranscriptCatchup } from './structured-tui-transcript-catchup'

type HostHandoffAccess = {
  session: (sessionId: string) => StructuredAgentSessionHostSession
  eventSink: (sessionId: string) => DeferredStructuredAgentSessionEventSink
  flush: (sessionId: string) => Promise<void>
  serialize: (sessionId: string, task: () => Promise<void>) => Promise<void>
  subscribers: AgentSessionSubscribers
  now: () => number
}

export type StructuredAgentSessionHostHandoff = StructuredAgentSessionHandoffCoordinator & {
  stopTuiHistoryCatchup: () => void
}

export async function refreshRecoverableStructuredHandoffStatus(
  handoff: StructuredAgentSessionHostHandoff,
  store: StructuredAgentSessionHostDeps['store'],
  sessionId: string
) {
  const record = store.getRecord(sessionId)
  if (record && canRestoreLiveTuiOwner(record)) {
    await handoff.restore(sessionId)
  }
  return handoff.status(sessionId)
}

export function createStructuredAgentSessionHostHandoff(
  deps: StructuredAgentSessionHostDeps,
  host: HostHandoffAccess
): StructuredAgentSessionHostHandoff {
  const tuiHistoryCatchup = new StructuredTuiTranscriptCatchup({
    store: deps.store,
    session: host.session,
    schedule: host.serialize,
    publish: (sessionId) => {
      const session = host.session(sessionId)
      host.subscribers.publish(sessionId, session.journal)
    },
    reset: (sessionId, fence) => {
      const session = host.session(sessionId)
      host.subscribers.reset(sessionId, session.journal, 'epoch_changed', fence)
    },
    ...(deps.onEventSinkError ? { onError: deps.onEventSinkError } : {})
  })
  const coordinator = new StructuredAgentSessionHandoffCoordinator({
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
    prepareTuiHistoryCatchup: (sessionId, fence) => tuiHistoryCatchup.prepare(sessionId, fence),
    recoverTuiHistoryCatchup: (sessionId, fence) => tuiHistoryCatchup.recover(sessionId, fence),
    activateTuiHistoryCatchup: (sessionId) => tuiHistoryCatchup.activate(sessionId),
    stopTuiHistoryCatchup: (sessionId) => tuiHistoryCatchup.stop(sessionId),
    publish: (sessionId, status) => {
      const session = host.session(sessionId)
      const fence = deps.store.getRecord(sessionId)?.lease.runtimeFence ?? session.fence
      host.subscribers.handoff(sessionId, session.journal, fence, status)
    },
    schedule: host.serialize,
    now: host.now
  })
  return Object.assign(coordinator, { stopTuiHistoryCatchup: () => tuiHistoryCatchup.stopAll() })
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
    options: input.transcriptPath
      ? { filePath: input.transcriptPath }
      : { codexSessionsDirs: [join(record.accountHome.path, 'sessions')] }
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
    const options = await readNativeHandoffSessionOptions({
      adapter: deps.adapter,
      sessionId: input.sessionId,
      fence: input.fence,
      ...(record.options ? { priorOptions: record.options } : {})
    })
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
      now: host.now(),
      ...(options ? { options } : {})
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
