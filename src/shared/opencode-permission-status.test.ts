import { beforeEach, describe, expect, it } from 'vitest'
import { createHookListenerState, normalizeHookPayload } from './agent-hook-listener'
import { makePaneKey } from './stable-pane-id'

const PANE_KEY = makePaneKey('tab-1', '11111111-1111-4111-8111-111111111111')

/**
 * OpenCode reports an approval prompt as `permission.asked`; the status plugin forwards
 * that event's `properties` under `hook_event_name: 'PermissionRequest'`. The shape is
 * fixed by @opencode-ai/sdk 1.18.18 (`EventPermissionAsked`): `permission` names what is
 * being requested, `patterns` carries the concrete commands/paths it applies to, and
 * `metadata` holds tool-specific detail.
 *
 * `normalizeOpenCodeFamilyEvent` serves opencode and mimo-code from one path, so every
 * case here runs for both.
 */
describe('OpenCode-family permission request status', () => {
  let state: ReturnType<typeof createHookListenerState>

  beforeEach(() => {
    state = createHookListenerState()
  })

  const SOURCES = ['opencode', 'mimo-code'] as const

  function permissionEvent(
    source: (typeof SOURCES)[number],
    properties: Record<string, unknown>
  ): ReturnType<typeof normalizeHookPayload> {
    return normalizeHookPayload(
      state,
      source,
      {
        paneKey: PANE_KEY,
        payload: { hook_event_name: 'PermissionRequest', ...properties }
      },
      'production'
    )
  }

  const BASH_PERMISSION = {
    id: 'per_01',
    sessionID: 'ses_root',
    permission: 'bash',
    patterns: ['rm -rf build/'],
    metadata: { command: 'rm -rf build/' },
    always: []
  }

  it.each(SOURCES)('reports a permission request as waiting for %s', (source) => {
    const event = permissionEvent(source, BASH_PERMISSION)

    expect(event?.payload.state).toBe('waiting')
    expect(event?.payload.agentType).toBe(source)
  })

  it.each(SOURCES)('names the requested permission as the tool for %s', (source) => {
    const event = permissionEvent(source, BASH_PERMISSION)

    // Why: a bare `waiting` row cannot tell the user what is blocked; the permission
    // name is the only field that always identifies it (STA-3160).
    expect(event?.payload.toolName).toBe('bash')
  })

  it.each(SOURCES)('surfaces the blocked command as tool input for %s', (source) => {
    const event = permissionEvent(source, BASH_PERMISSION)

    expect(event?.payload.toolInput).toBe('rm -rf build/')
  })

  it.each(SOURCES)('falls back to patterns when metadata carries no command for %s', (source) => {
    const event = permissionEvent(source, {
      id: 'per_02',
      sessionID: 'ses_root',
      permission: 'edit',
      patterns: ['src/main/**'],
      metadata: {},
      always: []
    })

    expect(event?.payload.toolName).toBe('edit')
    expect(event?.payload.toolInput).toBe('src/main/**')
  })

  it.each(SOURCES)('joins multiple patterns for %s', (source) => {
    const event = permissionEvent(source, {
      id: 'per_03',
      sessionID: 'ses_root',
      permission: 'edit',
      patterns: ['src/a.ts', 'src/b.ts'],
      metadata: {},
      always: []
    })

    expect(event?.payload.toolInput).toBe('src/a.ts, src/b.ts')
  })

  it.each(SOURCES)(
    'still reports waiting when the payload names no permission for %s',
    (source) => {
      // Why: an unrecognized/absent permission must not downgrade the blocked state — the
      // user still has to answer, they just get less detail.
      const event = permissionEvent(source, { id: 'per_04', sessionID: 'ses_root' })

      expect(event?.payload.state).toBe('waiting')
      expect(event?.payload.toolName).toBeUndefined()
    }
  )

  it.each(SOURCES)('leaves the AskUserQuestion route untouched for %s', (source) => {
    const properties = { questions: [{ question: 'Choose', options: ['x', 'y'] }] }
    const event = normalizeHookPayload(
      state,
      source,
      {
        paneKey: PANE_KEY,
        payload: { hook_event_name: 'AskUserQuestion', ...properties }
      },
      'production'
    )

    expect(event?.payload.state).toBe('waiting')
    expect(event?.payload.interactivePrompt).toBe(JSON.stringify(properties))
  })

  it.each(SOURCES)('clears permission metadata once the turn resumes for %s', (source) => {
    permissionEvent(source, BASH_PERMISSION)
    const resumed = normalizeHookPayload(
      state,
      source,
      { paneKey: PANE_KEY, payload: { hook_event_name: 'SessionBusy' } },
      'production'
    )

    // Why: a stale approval card must not outlive the approval — once work resumes the
    // row is working again and the blocked command is no longer what the pane is on.
    expect(resumed?.payload.state).toBe('working')
  })
})
