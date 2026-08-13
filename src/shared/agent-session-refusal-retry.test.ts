import { describe, expect, it } from 'vitest'
import type { AgentSessionWireRefusalCode } from './agent-session-wire'
import { agentSessionRefusalOperationState } from './agent-session-refusal-retry'

const HANDOFF_SETTLED_CODES = [
  'structured_agent_session_unsupported',
  'agent_session_checkpoint_stale',
  'agent_session_conflict',
  'agent_session_operation_conflict'
] as const satisfies readonly AgentSessionWireRefusalCode[]

describe('agentSessionRefusalOperationState', () => {
  it.each(HANDOFF_SETTLED_CODES)('classifies handoff %s as settled', (code) => {
    expect(agentSessionRefusalOperationState('agentSession.requestHandoff', code)).toBe(
      'settled-rejected'
    )
  })

  it.each(['agentSession.setOption', 'agentSession.send'])(
    'keeps %s admission refusals pending',
    (method) => {
      for (const code of HANDOFF_SETTLED_CODES) {
        expect(agentSessionRefusalOperationState(method, code)).toBe('pending-admission')
      }
    }
  )
})
