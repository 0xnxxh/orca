import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import type { AgentSessionAttachParams } from './structured-agent-session-attach'

export type StructuredAgentSessionCaller = { callerKey: string }

export type StructuredAgentSessionHostSession = {
  journal: AgentSessionJournal
  params: AgentSessionAttachParams
  fence: number
}
