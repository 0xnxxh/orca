import { beforeEach, describe, expect, it } from 'vitest'
import { createHookListenerState, normalizeHookPayload } from './agent-hook-listener'
import { makePaneKey } from './stable-pane-id'

const PANE_KEY = makePaneKey('tab-1', '11111111-1111-4111-8111-111111111111')
let state: ReturnType<typeof createHookListenerState>

function codexEvent(payload: Record<string, unknown>) {
  return normalizeHookPayload(state, 'codex', { paneKey: PANE_KEY, payload }, 'production')
}

function withBlockedChild() {
  codexEvent({ hook_event_name: 'SessionStart' })
  codexEvent({ hook_event_name: 'SubagentStart', agent_id: 'child-1', agent_type: 'explore' })
  codexEvent({ hook_event_name: 'PermissionRequest', agent_id: 'child-1' })
}

// Why: the roster reap and the effective-state read must stay in this order. Swapping them
// breaks one of the two contracts below, and each was a shipped bug at some point (#4375).
describe('Codex lead state vs. a live subagent roster', () => {
  beforeEach(() => {
    state = createHookListenerState()
  })

  it('holds the pane at waiting on a non-Stop lead event while a child is blocked', () => {
    withBlockedChild()
    // Read pre-reap: a lead that keeps working must not paper over a child's permission prompt,
    // or the pane looks busy and the user never sees what it is blocked on.
    expect(codexEvent({ hook_event_name: 'PostToolUse', tool_name: 'read' })?.payload.state).toBe(
      'waiting'
    )
  })

  it('still reports done on a lead Stop, flagging that children were live', () => {
    withBlockedChild()
    const stopped = codexEvent({ hook_event_name: 'Stop' })
    // Read post-reap: agent-hooks/server.ts retires child rows on a root Stop and reports 'done'.
    // The pre-reap flag carries the "children were live" signal instead of downgrading the state.
    expect(stopped?.payload.state).toBe('done')
    expect(stopped?.payload.leadStopWithLiveSubagents).toBe(true)
  })

  it('omits the flag on a lead Stop with no live children', () => {
    codexEvent({ hook_event_name: 'SessionStart' })
    codexEvent({ hook_event_name: 'SubagentStart', agent_id: 'child-1', agent_type: 'explore' })
    codexEvent({ hook_event_name: 'SubagentStop', agent_id: 'child-1' })
    const stopped = codexEvent({ hook_event_name: 'Stop' })
    expect(stopped?.payload.state).toBe('done')
    expect(stopped?.payload.leadStopWithLiveSubagents).toBeUndefined()
  })
})
