import { describe, expect, it } from 'vitest'
import { requiresKillConfirmation } from './resource-session-kill-confirmation'
import type { UnifiedSessionRow } from './resource-usage-merge-types'

function row(overrides: Partial<UnifiedSessionRow> = {}): UnifiedSessionRow {
  return {
    sessionId: 'sess-1',
    paneKey: null,
    pid: 0,
    label: 'zsh',
    bound: false,
    hasAgentOwner: false,
    tabId: null,
    cpu: null,
    memory: null,
    hasLocalSamples: false,
    ...overrides
  }
}

describe('resource session kill confirmation', () => {
  it('confirms before killing a session with a visible tab', () => {
    expect(requiresKillConfirmation(row({ bound: true, tabId: 'tab-1' }))).toBe(true)
  })

  it('confirms before killing an agent-owned session that has no binding', () => {
    expect(requiresKillConfirmation(row({ bound: false, hasAgentOwner: true }))).toBe(true)
  })

  it('skips the prompt only when the session is both unbound and unclaimed', () => {
    expect(requiresKillConfirmation(row())).toBe(false)
  })
})
