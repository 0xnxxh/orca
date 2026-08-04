import { describe, expect, it } from 'vitest'
import {
  isAgentRenamedTerminalTitle,
  readClaudeSessionRenamedTitle
} from './agent-session-rename-title'

// Records copied from a real Claude transcript for a session that answered one
// prompt and was then renamed with `/rename billing-fix`.
const AI_TITLE_LINE = JSON.stringify({
  type: 'ai-title',
  aiTitle: 'Answer simple arithmetic question',
  sessionId: 'ac1a3f53-82b1-41ab-8db8-028c1fc15c48'
})
const CUSTOM_TITLE_LINE = JSON.stringify({
  type: 'custom-title',
  customTitle: 'billing-fix',
  sessionId: 'ac1a3f53-82b1-41ab-8db8-028c1fc15c48'
})

describe('readClaudeSessionRenamedTitle', () => {
  it('reads the deliberate rename and ignores auto-generated titles', () => {
    expect(readClaudeSessionRenamedTitle([AI_TITLE_LINE, CUSTOM_TITLE_LINE])).toBe('billing-fix')
  })

  it('returns null for a session that was never renamed', () => {
    expect(readClaudeSessionRenamedTitle([AI_TITLE_LINE])).toBeNull()
  })

  it('keeps the newest rename', () => {
    const laterRename = JSON.stringify({ type: 'custom-title', customTitle: 'intake-flow' })
    expect(readClaudeSessionRenamedTitle([CUSTOM_TITLE_LINE, AI_TITLE_LINE, laterRename])).toBe(
      'intake-flow'
    )
  })

  it('treats a cleared rename as no rename', () => {
    const cleared = JSON.stringify({ type: 'custom-title', customTitle: '  ' })
    expect(readClaudeSessionRenamedTitle([CUSTOM_TITLE_LINE, cleared])).toBeNull()
  })

  it('skips truncated and unrelated lines', () => {
    const truncated = CUSTOM_TITLE_LINE.slice(10)
    expect(readClaudeSessionRenamedTitle([truncated, 'not json', '', CUSTOM_TITLE_LINE])).toBe(
      'billing-fix'
    )
  })

  it('ignores a message that merely quotes the record type', () => {
    const userTurn = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'what does "custom-title" mean?' }
    })
    expect(readClaudeSessionRenamedTitle([userTurn])).toBeNull()
  })
})

describe('isAgentRenamedTerminalTitle', () => {
  it('matches the live OSC title through the agent status glyph', () => {
    expect(isAgentRenamedTerminalTitle('✳ billing-fix', 'billing-fix')).toBe(true)
    expect(isAgentRenamedTerminalTitle('⠂ billing-fix', 'billing-fix')).toBe(true)
    expect(isAgentRenamedTerminalTitle('billing-fix', 'billing-fix')).toBe(true)
  })

  it('stops matching once the agent moves its title elsewhere', () => {
    expect(isAgentRenamedTerminalTitle('✳ Fix the intake flow', 'billing-fix')).toBe(false)
  })

  it('is false without a recorded rename', () => {
    expect(isAgentRenamedTerminalTitle('✳ billing-fix', null)).toBe(false)
    expect(isAgentRenamedTerminalTitle('', 'billing-fix')).toBe(false)
  })
})
