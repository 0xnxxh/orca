import { describe, expect, it } from 'vitest'
import {
  clearClaudeAnsweredQuestionWait,
  createHookListenerState,
  normalizeHookPayload,
  seedClaudeSubagentRosterFromSnapshots,
  type HookListenerState
} from './agent-hook-listener'
import { isBackgroundOnlyAgentActivity } from './agent-background-only-activity'
import {
  normalizeAgentStatusPayload,
  pickParsedAgentStatusPayload,
  type ParsedAgentStatusPayload
} from './agent-status-types'
import { makePaneKey } from './stable-pane-id'

// STA-4119 / #14253. Claude sits at its idle `❯` prompt (so `orca terminal wait
// --for tui-idle` is satisfied) while a background shell / subagent / monitor is
// still registered. `resolveClaudePaneState` keeps the pane `working` so
// liveness, keep-awake, hibernation and teardown stay correct — the pane really
// is live. These pin that the emitted row also carries `backgroundOnly`, which
// is the only thing presentation surfaces can use to stop drawing a finished
// turn as active foreground work.

const PANE_KEY = makePaneKey('tab-4119', '11111111-1111-4111-8111-111111111111')

function claudeEvent(
  state: HookListenerState,
  payload: Record<string, unknown>
): ParsedAgentStatusPayload | undefined {
  return normalizeHookPayload(state, 'claude', { paneKey: PANE_KEY, payload }, 'production')
    ?.payload
}

function runningTurn(state: HookListenerState, prompt = 'do the thing'): void {
  claudeEvent(state, { hook_event_name: 'UserPromptSubmit', prompt })
}

const RUNNING_MONITOR = { id: 'monitor-1', type: 'monitor', status: 'running' }
const RUNNING_SHELL = {
  id: 'shell-1',
  type: 'shell',
  status: 'running',
  command: 'npm run dev'
}

describe('Claude foreground-idle pane with live background work', () => {
  it('marks the lead Stop background-only while a monitor is still running', () => {
    const state = createHookListenerState()
    runningTurn(state)

    const stop = claudeEvent(state, {
      hook_event_name: 'Stop',
      background_tasks: [RUNNING_MONITOR]
    })

    // Why: the pane stays `working` on purpose — every liveness/keep-awake/
    // hibernation gate reads `state`, and the monitor is genuinely running.
    expect(stop?.state).toBe('working')
    expect(stop?.backgroundOnly).toBe(true)
    expect(isBackgroundOnlyAgentActivity(stop)).toBe(true)
  })

  it('marks the lead Stop background-only for a long-lived background shell', () => {
    const state = createHookListenerState()
    runningTurn(state, 'start the dev server')

    const stop = claudeEvent(state, {
      hook_event_name: 'Stop',
      background_tasks: [RUNNING_SHELL]
    })

    expect(stop).toMatchObject({ state: 'working', backgroundOnly: true })
  })

  it('marks the lead Stop background-only for a background subagent and keeps its row working', () => {
    const state = createHookListenerState()
    runningTurn(state, 'spawn a child')
    claudeEvent(state, {
      hook_event_name: 'SubagentStart',
      agent_id: 'a1',
      agent_type: 'explore'
    })

    const stop = claudeEvent(state, {
      hook_event_name: 'Stop',
      background_tasks: [{ id: 'a1', type: 'subagent', status: 'running' }]
    })

    expect(stop).toMatchObject({ state: 'working', backgroundOnly: true })
    // Why: the child is the background work; muting the parent must not hide it.
    expect(stop?.subagents).toEqual([expect.objectContaining({ id: 'a1', state: 'working' })])
  })

  it('marks the lead Stop background-only for an active session cron', () => {
    const state = createHookListenerState()
    runningTurn(state)

    const stop = claudeEvent(state, {
      hook_event_name: 'Stop',
      background_tasks: [],
      session_crons: [{ id: 'cron-1' }]
    })

    expect(stop).toMatchObject({ state: 'working', backgroundOnly: true })
  })

  it('drops the marker on the later all-clear', () => {
    const state = createHookListenerState()
    runningTurn(state, 'spawn a child')
    claudeEvent(state, { hook_event_name: 'SubagentStart', agent_id: 'a1' })
    claudeEvent(state, {
      hook_event_name: 'Stop',
      background_tasks: [{ id: 'a1', type: 'subagent', status: 'running' }]
    })

    const allClear = claudeEvent(state, { hook_event_name: 'SubagentStop', agent_id: 'a1' })

    expect(allClear?.state).toBe('done')
    expect(allClear?.backgroundOnly).toBeUndefined()
  })

  it('clears the marker when a new foreground turn starts while background work persists', () => {
    const state = createHookListenerState()
    runningTurn(state)
    const stop = claudeEvent(state, {
      hook_event_name: 'Stop',
      background_tasks: [RUNNING_SHELL]
    })
    expect(stop?.backgroundOnly).toBe(true)

    const nextTurn = claudeEvent(state, {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'now do the next thing'
    })

    // Why: the shell is still registered, but the user is watching a live turn again —
    // the pane must spin, not sit in the muted background presentation.
    expect(nextTurn?.state).toBe('working')
    expect(nextTurn?.backgroundOnly).toBeUndefined()

    const secondStop = claudeEvent(state, {
      hook_event_name: 'Stop',
      background_tasks: [RUNNING_SHELL]
    })
    expect(secondStop).toMatchObject({ state: 'working', backgroundOnly: true })
  })

  it('never marks an interrupted turn — the interrupt already retires background work', () => {
    const state = createHookListenerState()
    runningTurn(state)

    const interrupted = claudeEvent(state, {
      hook_event_name: 'Stop',
      is_interrupt: true,
      background_tasks: [RUNNING_SHELL]
    })

    expect(interrupted?.state).toBe('done')
    expect(interrupted?.backgroundOnly).toBeUndefined()
  })

  it('marks the restored lead when an answered child question resumes background work', () => {
    const state = createHookListenerState()
    runningTurn(state)
    claudeEvent(state, { hook_event_name: 'SubagentStart', agent_id: 'a1' })
    claudeEvent(state, { hook_event_name: 'Stop' })
    claudeEvent(state, {
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      agent_id: 'a1',
      tool_input: { questions: [{ question: 'Continue?' }] }
    })

    expect(clearClaudeAnsweredQuestionWait(state, PANE_KEY)).toEqual({
      state: 'working',
      backgroundOnly: true
    })
  })

  it('marks a hydrated roster gated back up to working after a restart', () => {
    const state = createHookListenerState()
    seedClaudeSubagentRosterFromSnapshots(state, PANE_KEY, [
      { id: 'a1', state: 'working', startedAt: 1, agentType: 'explore' }
    ])

    // Why: a restart empties the lead cache; the pane's next real turn boundary is
    // still gated up by the restored child, so it must present as background work.
    const stop = claudeEvent(state, { hook_event_name: 'Stop' })

    expect(stop).toMatchObject({ state: 'working', backgroundOnly: true })
  })
})

describe('backgroundOnly wire contract', () => {
  it('is clamped to working so it cannot mute a done or waiting row', () => {
    for (const state of ['done', 'waiting', 'blocked'] as const) {
      expect(normalizeAgentStatusPayload({ state, backgroundOnly: true })?.backgroundOnly).toBe(
        undefined
      )
    }
    expect(
      normalizeAgentStatusPayload({ state: 'working', backgroundOnly: true })?.backgroundOnly
    ).toBe(true)
  })

  it('rejects non-boolean values from an untrusted hook payload', () => {
    for (const value of ['true', 1, {}, []]) {
      expect(
        normalizeAgentStatusPayload({ state: 'working', backgroundOnly: value })?.backgroundOnly
      ).toBe(undefined)
    }
  })

  it('survives the paired-client projection', () => {
    const row = normalizeAgentStatusPayload({ state: 'working', backgroundOnly: true })
    expect(row).not.toBeNull()
    expect(pickParsedAgentStatusPayload(row!).backgroundOnly).toBe(true)
  })

  it('reads an older peer that never stamps the field as ordinary foreground work', () => {
    // Why: SSH relays and paired hosts update independently. An old host emits the
    // same gated `working` with no marker, so the receiver renders today's spinner.
    const legacyRow = normalizeAgentStatusPayload({ state: 'working' })
    expect(legacyRow?.backgroundOnly).toBeUndefined()
    expect(isBackgroundOnlyAgentActivity(legacyRow ?? undefined)).toBe(false)
  })

  it('ignores the field on an older receiver by dropping unknown keys', () => {
    // Why: `normalizeAgentStatusObject` rebuilds field-by-field, so a new host's
    // marker cannot corrupt an old receiver — it simply does not survive the parse.
    const { backgroundOnly, ...withoutMarker } = normalizeAgentStatusPayload({
      state: 'working',
      backgroundOnly: true
    })!
    expect(backgroundOnly).toBe(true)
    expect(normalizeAgentStatusPayload(withoutMarker)?.backgroundOnly).toBeUndefined()
  })
})
