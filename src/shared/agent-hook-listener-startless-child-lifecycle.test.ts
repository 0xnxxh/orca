import { describe, expect, it } from 'vitest'
import {
  createHookListenerState,
  normalizeHookPayload,
  seedClaudeSubagentRosterFromSnapshots,
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
  it('makes no status claim from an unknown start-less SubagentStop', () => {
    const state = createHookListenerState()
    const paneKey = makePaneKey('startless-stop', LEAF_ID)

    const stopped = claudeEvent(state, paneKey, {
      hook_event_name: 'SubagentStop',
      agent_id: 'achild-0000000000000001'
    })

    expect(stopped).toBeNull()
    expect(state.claudeSubagentRosterByPaneKey.size).toBe(0)
  })

  it('makes no status claim from an unknown start-less TeammateIdle', () => {
    const state = createHookListenerState()
    const paneKey = makePaneKey('startless-idle', LEAF_ID)

    const idled = claudeEvent(state, paneKey, {
      hook_event_name: 'TeammateIdle',
      teammate_name: 'reviewer'
    })

    expect(idled).toBeNull()
    expect(state.claudeSubagentRosterByPaneKey.size).toBe(0)
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

  it('resolves an identity-matched child drain to done with no cached lead', () => {
    const state = createHookListenerState()
    const paneKey = makePaneKey('startless-known-stop', LEAF_ID)

    claudeEvent(state, paneKey, {
      hook_event_name: 'SubagentStart',
      agent_id: 'a0000000000000006',
      agent_type: 'reviewer'
    })
    state.claudeLeadStateByPaneKey.delete(paneKey)

    const stopped = claudeEvent(state, paneKey, {
      hook_event_name: 'SubagentStop',
      agent_id: 'a0000000000000006'
    })

    expect(stopped?.payload.state).toBe('done')
    expect(state.claudeSubagentRosterByPaneKey.size).toBe(0)
  })

  it('resolves an exact-name teammate idle to done with no cached lead', () => {
    const state = createHookListenerState()
    const paneKey = makePaneKey('startless-known-idle', LEAF_ID)

    claudeEvent(state, paneKey, {
      hook_event_name: 'SubagentStart',
      agent_id: 'areviewer-6d3cb5b5',
      agent_type: 'reviewer'
    })
    state.claudeLeadStateByPaneKey.delete(paneKey)

    const idled = claudeEvent(state, paneKey, {
      hook_event_name: 'TeammateIdle',
      teammate_name: 'reviewer'
    })

    expect(idled?.payload.state).toBe('done')
    expect(idled?.payload.subagents).toEqual([
      expect.objectContaining({ id: 'areviewer-6d3cb5b5', state: 'idle' })
    ])
  })

  it('keeps a restored teammate after its exact idle proves the live identity', () => {
    const state = createHookListenerState()
    const paneKey = makePaneKey('restored-known-idle', LEAF_ID)
    seedClaudeSubagentRosterFromSnapshots(state, paneKey, [
      {
        id: 'areviewer-8f5dc7d7',
        state: 'working',
        startedAt: 100,
        agentType: 'reviewer'
      }
    ])

    expect(
      claudeEvent(state, paneKey, {
        hook_event_name: 'TeammateIdle',
        teammate_name: 'reviewer'
      })?.payload.state
    ).toBe('done')

    const leadStop = claudeEvent(state, paneKey, {
      hook_event_name: 'Stop',
      background_tasks: [{ id: 'treviewer', type: 'teammate', status: 'running' }]
    })

    expect(leadStop?.payload.subagents).toEqual([
      expect.objectContaining({ id: 'areviewer-8f5dc7d7', state: 'idle' })
    ])
  })

  it('resolves a known teammate-shaped stop to done with no cached lead', () => {
    const state = createHookListenerState()
    const paneKey = makePaneKey('startless-known-teammate-stop', LEAF_ID)

    claudeEvent(state, paneKey, {
      hook_event_name: 'SubagentStart',
      agent_id: 'areviewer-7e4cb6c6',
      agent_type: 'reviewer'
    })
    state.claudeLeadStateByPaneKey.delete(paneKey)

    const stopped = claudeEvent(state, paneKey, {
      hook_event_name: 'SubagentStop',
      agent_id: 'areviewer-7e4cb6c6'
    })

    expect(stopped?.payload.state).toBe('done')
    expect(stopped?.payload.subagents).toEqual([
      expect.objectContaining({ id: 'areviewer-7e4cb6c6', state: 'idle' })
    ])
  })

  it('does not reconfirm an unrelated restored child after runtime work drains', () => {
    const state = createHookListenerState()
    const paneKey = makePaneKey('restored-sibling-after-runtime-drain', LEAF_ID)
    seedClaudeSubagentRosterFromSnapshots(state, paneKey, [
      {
        id: 'a0000000000000008',
        state: 'working',
        startedAt: 100,
        agentType: 'reviewer'
      }
    ])

    expect(
      claudeEvent(state, paneKey, {
        hook_event_name: 'SubagentStart',
        agent_id: 'a0000000000000009',
        agent_type: 'reviewer'
      })?.payload.state
    ).toBe('working')

    const stopped = claudeEvent(state, paneKey, {
      hook_event_name: 'SubagentStop',
      agent_id: 'a0000000000000009'
    })

    expect(stopped?.payload.state).toBe('done')
    expect(stopped?.payload.subagents).toBeUndefined()
    expect(state.claudeSubagentRosterByPaneKey.size).toBe(0)
  })

  it('keeps a restored sibling gated when a current lead is still working', () => {
    const state = createHookListenerState()
    const paneKey = makePaneKey('restored-sibling-with-live-lead', LEAF_ID)
    seedClaudeSubagentRosterFromSnapshots(state, paneKey, [
      { id: 'a0000000000000010', state: 'working', startedAt: 100 }
    ])
    claudeEvent(state, paneKey, { hook_event_name: 'UserPromptSubmit', prompt: 'continue' })
    claudeEvent(state, paneKey, {
      hook_event_name: 'SubagentStart',
      agent_id: 'a0000000000000011'
    })

    const stopped = claudeEvent(state, paneKey, {
      hook_event_name: 'SubagentStop',
      agent_id: 'a0000000000000011'
    })

    expect(stopped?.payload.state).toBe('working')
    expect(stopped?.payload.subagents).toEqual([
      expect.objectContaining({ id: 'a0000000000000010', state: 'working' })
    ])
  })

  it('resolves a first-event child wait when that child stops', () => {
    const state = createHookListenerState()
    const paneKey = makePaneKey('startless-wait-stop', LEAF_ID)

    expect(
      claudeEvent(state, paneKey, {
        hook_event_name: 'PermissionRequest',
        agent_id: 'a0000000000000007',
        tool_name: 'Bash'
      })?.payload.state
    ).toBe('waiting')

    const stopped = claudeEvent(state, paneKey, {
      hook_event_name: 'SubagentStop',
      agent_id: 'a0000000000000007'
    })

    expect(stopped?.payload.state).toBe('done')
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
