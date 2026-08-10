import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { loadJournal } from '../agent-session-journal/journal-open'
import { journalDirectoryFor } from '../agent-session-journal/journal-paths'
import {
  openAgentSessionJournal,
  type AgentSessionJournal
} from '../agent-session-journal/journal-store'
import {
  journalIdentityFor,
  type AgentSessionAttachParams
} from './structured-agent-session-attach'

export type RestoredStructuredAgentSessionRead = {
  journal: AgentSessionJournal
  params: AgentSessionAttachParams
  fence: number
}

export async function restoreStructuredAgentSessionRead(
  store: AgentSessionRecordStore,
  journalRoot: string,
  sessionId: string
): Promise<RestoredStructuredAgentSessionRead | null> {
  const record = store.getRecord(sessionId)
  if (!record || record.provider !== 'codex') {
    return null
  }
  const params = attachParamsForReadableRestore(record)
  const journalDir = journalDirectoryFor(journalRoot, {
    workspaceId: record.location.workspaceId,
    sessionId
  })
  const loaded = await loadJournal(journalDir, sessionId)
  if (!loaded || loaded.corrupt) {
    return null
  }
  const journal = await openAgentSessionJournal({
    identity: journalIdentityFor(record, params),
    journalDir
  })
  return { journal, params, fence: record.lease.runtimeFence }
}

function attachParamsForReadableRestore(record: AgentSessionRecord): AgentSessionAttachParams {
  return {
    envelope: {
      sessionId: record.sessionId,
      clientOperationId: `read-restore:${record.sessionId}`,
      expectedRuntimeFence: record.lease.runtimeFence,
      payloadFingerprint: ''
    },
    location: record.location,
    provider: 'codex',
    agent: 'codex',
    accountHome: record.accountHome,
    runtimeKind: record.lease.runtimeKind
  }
}
