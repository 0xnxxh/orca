import { describe, expect, it } from 'vitest'
import type { AgentJournalRenderItem } from './agent-session-journal-types'
import { parsePaneKey } from './stable-pane-id'
import {
  activeStructuredAgentSessionTurnId,
  projectStructuredItemToNativeChat,
  projectStructuredAgentSessionStatus,
  structuredAgentSessionPaneKey
} from './structured-agent-session-projection'

function item(
  itemId: string,
  sequence: number,
  body: AgentJournalRenderItem['body']
): AgentJournalRenderItem {
  return { itemId, sequence, revision: 1, observedAt: sequence, body }
}

describe('structured agent session status projection', () => {
  it('projects running, attention, and completed lifecycle states', () => {
    const running = item('running', 1, {
      kind: 'status',
      text: 'Working',
      turnLifecycle: { turnId: 'turn-1', state: 'running' }
    })
    const prompt = item('prompt', 2, {
      kind: 'approval',
      title: 'Run command?',
      detail: null,
      options: [{ id: 'yes', label: 'Allow' }],
      resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
    })
    const completed = item('completed', 3, {
      kind: 'status',
      text: 'Done',
      turnLifecycle: { turnId: 'turn-1', state: 'completed' }
    })

    expect(activeStructuredAgentSessionTurnId([running])).toBe('turn-1')
    expect(projectStructuredAgentSessionStatus([running])).toBe('working')
    expect(projectStructuredAgentSessionStatus([running, prompt])).toBe('attention')
    expect(activeStructuredAgentSessionTurnId([running, completed])).toBeNull()
    expect(projectStructuredAgentSessionStatus([running, completed])).toBe('idle')
  })

  it('creates a deterministic pane identity for status stores', () => {
    const paneKey = structuredAgentSessionPaneKey('structured-agent-session-1', 'session-1')

    expect(structuredAgentSessionPaneKey('structured-agent-session-1', 'session-1')).toBe(paneKey)
    expect(parsePaneKey(paneKey)).toMatchObject({ tabId: 'structured-agent-session-1' })
  })

  it('preserves provider-frame detail on the backward-compatible status line', () => {
    const projected = projectStructuredItemToNativeChat(
      item('frame', 1, {
        kind: 'status',
        text: 'codex · notification:new/event',
        providerFrame: {
          provider: 'codex',
          kind: 'notification:new/event',
          payload: { head: '{}', byteLength: 2, digest: 'digest', truncated: false }
        }
      })
    )

    expect(projected?.blocks).toEqual([
      expect.objectContaining({
        type: 'text',
        text: 'codex · notification:new/event',
        providerFrame: expect.objectContaining({ kind: 'notification:new/event' })
      })
    ])
  })
})
