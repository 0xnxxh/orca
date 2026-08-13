import { describe, expect, it } from 'vitest'
import {
  createHookListenerState,
  normalizeHookPayload,
  type HookListenerState
} from './agent-hook-listener'
import { makePaneKey } from './stable-pane-id'

const LEAF_ID = '33333333-3333-4333-8333-333333333333'

function claudeEvent(
  state: HookListenerState,
  paneKey: string,
  payload: Record<string, unknown>
): ReturnType<typeof normalizeHookPayload> {
  return normalizeHookPayload(state, 'claude', { paneKey, payload }, 'production')
}

// A session that exits mid-turn (/exit, Ctrl+D, crash) never emits Stop, so SessionEnd is the
// only event that can retire the pane's row.
describe('Claude SessionEnd', () => {
  it('retires a turn left working by a missing Stop', () => {
    const state = createHookListenerState()
    const paneKey = makePaneKey('session-end-working', LEAF_ID)

    const working = claudeEvent(state, paneKey, {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'do a thing'
    })
    expect(working?.payload.state).toBe('working')

    const ended = claudeEvent(state, paneKey, {
      hook_event_name: 'SessionEnd',
      reason: 'prompt_input_exit'
    })
    expect(ended?.payload.state).toBe('done')
  })

  it('retires a pane still gated up by a live subagent roster', () => {
    const state = createHookListenerState()
    const paneKey = makePaneKey('session-end-roster', LEAF_ID)

    claudeEvent(state, paneKey, { hook_event_name: 'UserPromptSubmit', prompt: 'spawn' })
    claudeEvent(state, paneKey, {
      hook_event_name: 'SubagentStart',
      agent_id: 'achild-0000000000000011',
      agent_type: 'reviewer'
    })

    const ended = claudeEvent(state, paneKey, { hook_event_name: 'SessionEnd', reason: 'other' })

    expect(ended?.payload.state).toBe('done')
    expect(state.claudeSubagentRosterByPaneKey.has(paneKey)).toBe(false)
  })

  it('marks the row a session boundary so it is not read as a turn completion', () => {
    const state = createHookListenerState()
    const paneKey = makePaneKey('session-end-boundary', LEAF_ID)

    claudeEvent(state, paneKey, { hook_event_name: 'UserPromptSubmit', prompt: 'work' })
    const ended = claudeEvent(state, paneKey, { hook_event_name: 'SessionEnd', reason: 'logout' })

    expect(ended?.payload.sessionBoundary).toBe(true)
  })

  it('accepts every reason, including ones Orca does not know', () => {
    for (const reason of ['clear', 'logout', 'prompt_input_exit', 'other', 'some_future_reason']) {
      const state = createHookListenerState()
      const paneKey = makePaneKey(`session-end-${reason}`, LEAF_ID)
      claudeEvent(state, paneKey, { hook_event_name: 'UserPromptSubmit', prompt: 'work' })

      const ended = claudeEvent(state, paneKey, { hook_event_name: 'SessionEnd', reason })

      expect(ended?.payload.state).toBe('done')
    }
  })

  it('ignores a child-attributed SessionEnd so a subagent cannot retire the lead turn', () => {
    const state = createHookListenerState()
    const paneKey = makePaneKey('session-end-child', LEAF_ID)

    claudeEvent(state, paneKey, { hook_event_name: 'UserPromptSubmit', prompt: 'work' })
    const ended = claudeEvent(state, paneKey, {
      hook_event_name: 'SessionEnd',
      reason: 'other',
      agent_id: 'achild-0000000000000012'
    })

    expect(ended).toBeNull()
    expect(state.claudeLeadStateByPaneKey.get(paneKey)?.state).toBe('working')
  })
})
