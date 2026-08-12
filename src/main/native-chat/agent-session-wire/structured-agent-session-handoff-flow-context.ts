import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type { AgentSessionHandoffStatus } from '../../../shared/agent-session-wire'
import type {
  StructuredAgentSessionHandoffDeps,
  StructuredAgentSessionHandoffFlowContext,
  StructuredTuiOwner
} from './structured-agent-session-handoff-types'

export function createStructuredHandoffFlowContext(input: {
  deps: StructuredAgentSessionHandoffDeps
  owner: (sessionId: string) => StructuredTuiOwner | undefined
  retainOwner: (sessionId: string, owner: StructuredTuiOwner) => void
  releaseOwner: (sessionId: string) => void
  setStatus: (sessionId: string, status: AgentSessionHandoffStatus) => void
  enterPreparing: StructuredAgentSessionHandoffFlowContext['enterPreparing']
  publishStage: StructuredAgentSessionHandoffFlowContext['publishStage']
  requireRecord: (sessionId: string) => AgentSessionRecord
}): StructuredAgentSessionHandoffFlowContext {
  return input
}

export async function stopStructuredNativeTurn(
  deps: StructuredAgentSessionHandoffDeps,
  sessionId: string,
  turnId: string
): Promise<boolean> {
  const record = deps.store.getRecord(sessionId)
  if (!record || record.lease.runtimeKind !== 'native') {
    return false
  }
  const session = deps.session(sessionId)
  return (await deps.acquireNativeStop?.(sessionId, turnId, session.fence)) ?? false
}
