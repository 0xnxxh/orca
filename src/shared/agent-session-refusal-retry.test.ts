import { describe, expect, it } from 'vitest'
import {
  AGENT_SESSION_WIRE_REFUSAL_CODES,
  type AgentSessionWireRefusalCode
} from './agent-session-wire'
import { agentSessionRefusalOperationState } from './agent-session-refusal-retry'
import type { AgentSessionRefusalOperationState } from './agent-session-refusal-retry'

const METHODS = [
  'agentSession.requestHandoff',
  'agentSession.setOption',
  'agentSession.send'
] as const

const PENDING: AgentSessionRefusalOperationState = 'pending-admission'
const SETTLED: AgentSessionRefusalOperationState = 'settled-rejected'
const UNKNOWN: AgentSessionRefusalOperationState = 'unknown'

const EXPECTED = {
  'agentSession.requestHandoff': {
    structured_agent_session_unsupported: SETTLED,
    agent_session_checkpoint_stale: SETTLED,
    agent_session_conflict: SETTLED,
    agent_session_ownership_unknown: PENDING,
    agent_session_operation_conflict: SETTLED,
    agent_session_operation_expired: SETTLED,
    agent_session_operation_capacity: PENDING,
    agent_session_operation_invalid: SETTLED,
    agent_session_operation_unknown: UNKNOWN,
    agent_session_item_revision_stale: SETTLED,
    agent_session_already_resolved: SETTLED,
    agent_session_identity_required: PENDING,
    agent_session_journal_unreadable: PENDING,
    execution_owner_reconciling: PENDING
  },
  'agentSession.setOption': {
    structured_agent_session_unsupported: PENDING,
    agent_session_checkpoint_stale: PENDING,
    agent_session_conflict: PENDING,
    agent_session_ownership_unknown: PENDING,
    agent_session_operation_conflict: SETTLED,
    agent_session_operation_expired: SETTLED,
    agent_session_operation_capacity: PENDING,
    agent_session_operation_invalid: SETTLED,
    agent_session_operation_unknown: UNKNOWN,
    agent_session_item_revision_stale: SETTLED,
    agent_session_already_resolved: SETTLED,
    agent_session_identity_required: PENDING,
    agent_session_journal_unreadable: PENDING,
    execution_owner_reconciling: PENDING
  },
  'agentSession.send': {
    structured_agent_session_unsupported: PENDING,
    agent_session_checkpoint_stale: PENDING,
    agent_session_conflict: PENDING,
    agent_session_ownership_unknown: PENDING,
    agent_session_operation_conflict: SETTLED,
    agent_session_operation_expired: SETTLED,
    agent_session_operation_capacity: PENDING,
    agent_session_operation_invalid: SETTLED,
    agent_session_operation_unknown: UNKNOWN,
    agent_session_item_revision_stale: SETTLED,
    agent_session_already_resolved: SETTLED,
    agent_session_identity_required: PENDING,
    agent_session_journal_unreadable: PENDING,
    execution_owner_reconciling: PENDING
  }
} as const satisfies Record<
  (typeof METHODS)[number],
  Record<AgentSessionWireRefusalCode, AgentSessionRefusalOperationState>
>

describe('agentSessionRefusalOperationState', () => {
  it.each(METHODS)('matches the host ledger for every %s refusal', (method) => {
    for (const code of AGENT_SESSION_WIRE_REFUSAL_CODES) {
      expect(agentSessionRefusalOperationState(method, code), code).toBe(EXPECTED[method][code])
    }
  })
})
