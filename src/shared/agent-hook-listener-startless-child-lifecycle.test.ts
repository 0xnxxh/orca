import { describe, expect, it } from 'vitest'
import {
  createHookListenerState,
  normalizeHookPayload,
  type HookListenerState
} from './agent-hook-listener'
import { makePaneKey } from './stable-pane-id'

const LEAF_ID = '22222222-2222-4222-8222-222222222222'

function claudeEvent(
  state: HookListenerState,
  paneKey: string,
  payload: Record<string, unknown>
): ReturnType<typeof normalizeHookPayload> {
  return normalizeHookPayload(state, 'claude', { paneKey, payload }, 'production')
}

// A fresh listener state is what Orca has after a restart: the lead-turn cache is in-memory only,
// so a session that outlived the app reports its next child event with no cached lead.
describe('Claude child lifecycle events with no cached lead state', () => {
  it('does not mint working from a start-less SubagentStop', () => {
    const state = createHookListenerState()
    const paneKey = makePaneKey('startless-stop', LEAF_ID)

    const stopped = claudeEvent(state, paneKey, {
      hook_event_name: 'SubagentStop',
      agent_id: 'achild-0000000000000001'
    })

    expect(stopped?.payload.state).not.toBe('working')
    expect(stopped?.payload.state).toBe('done')
  })

  it('does not mint working from a start-less TeammateIdle', () => {
    const state = createHookListenerState()
    const paneKey = makePaneKey('startless-idle', LEAF_ID)

    const idled = claudeEvent(state, paneKey, {
      hook_event_name: 'TeammateIdle',
      teammate_name: 'reviewer'
    })

    expect(idled?.payload.state).not.toBe('working')
    expect(idled?.payload.state).toBe('done')
  })

  it('still reports working for a start-less SubagentStart, which proves activity', () => {
    const state = createHookListenerState()
    const paneKey = makePaneKey('startless-start', LEAF_ID)

    const started = claudeEvent(state, paneKey, {
      hook_event_name: 'SubagentStart',
      agent_id: 'achild-0000000000000002',
      agent_type: 'reviewer'
    })

    expect(started?.payload.state).toBe('working')
  })

  it('still gates a start-less SubagentStop up to working while another child runs', () => {
    const state = createHookListenerState()
    const paneKey = makePaneKey('startless-stop-sibling', LEAF_ID)

    claudeEvent(state, paneKey, {
      hook_event_name: 'SubagentStart',
      agent_id: 'achild-0000000000000003',
      agent_type: 'reviewer'
    })
    claudeEvent(state, paneKey, {
      hook_event_name: 'SubagentStart',
      agent_id: 'achild-0000000000000004',
      agent_type: 'reviewer'
    })
    state.claudeLeadStateByPaneKey.delete(paneKey)

    const stopped = claudeEvent(state, paneKey, {
      hook_event_name: 'SubagentStop',
      agent_id: 'achild-0000000000000003'
    })

    expect(stopped?.payload.state).toBe('working')
  })

  it('keeps a live lead working when its child stops', () => {
    const state = createHookListenerState()
    const paneKey = makePaneKey('live-lead-stop', LEAF_ID)

    claudeEvent(state, paneKey, { hook_event_name: 'UserPromptSubmit', prompt: 'spawn reviewer' })
    claudeEvent(state, paneKey, {
      hook_event_name: 'SubagentStart',
      agent_id: 'achild-0000000000000005',
      agent_type: 'reviewer'
    })

    const stopped = claudeEvent(state, paneKey, {
      hook_event_name: 'SubagentStop',
      agent_id: 'achild-0000000000000005'
    })

    expect(stopped?.payload.state).toBe('working')
  })
})
