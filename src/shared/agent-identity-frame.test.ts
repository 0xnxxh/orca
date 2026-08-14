import { describe, expect, it } from 'vitest'
import {
  AGENT_IDENTITY_FRAMES,
  buildAgentIdentityFrameRe,
  isAgentIdentityFrameTitleFor,
  resolveAgentIdentityFrameType
} from './agent-identity-frame'
import { getAgentLabel } from './agent-title-identity'
import { detectAgentStatusFromTitle } from './agent-title-status'
import {
  isClaudeIdentityFrameTitle,
  resolveExplicitTerminalTitleAgentType,
  resolveTerminalTitleAgentType
} from './terminal-title-agent-type'

describe('agent identity frames', () => {
  it('claims a title that is only the agent name, decorated or multiplexer-wrapped', () => {
    for (const title of ['Cline', 'cline', 'cline.cmd', 'cline.exe', '⠋ Cline', 'zsh | Cline']) {
      expect(resolveAgentIdentityFrameType(title)).toBe('cline')
      expect(isAgentIdentityFrameTitleFor(title, 'cline')).toBe(true)
    }
  })

  it('rejects the name inside task text, a path, or a hyphenated compound', () => {
    for (const title of [
      '⠋ use cline for the sidebar fix',
      'port the cline prompt',
      '~/cline-scratch',
      'cline-rules',
      'src/cline/index.ts',
      'clinent'
    ]) {
      expect(resolveAgentIdentityFrameType(title)).not.toBe('cline')
      expect(isAgentIdentityFrameTitleFor(title, 'cline')).toBe(false)
    }
  })

  it('accepts at most one status word, never free-form trailing text', () => {
    expect(isAgentIdentityFrameTitleFor('Cline ready', 'cline')).toBe(true)
    expect(isAgentIdentityFrameTitleFor('Cline - action required', 'cline')).toBe(true)
    expect(isAgentIdentityFrameTitleFor('Cline working on the parser', 'cline')).toBe(false)
    expect(isAgentIdentityFrameTitleFor('Cline ready idle', 'cline')).toBe(false)
  })

  it('is not declared for agents whose names are too common to anchor on', () => {
    // Why: `amp`/`pi`/`cn` would claim ordinary shell titles; the registry stays observed-only.
    expect(AGENT_IDENTITY_FRAMES.amp).toBeUndefined()
    expect(resolveAgentIdentityFrameType('amp')).toBeNull()
    expect(resolveAgentIdentityFrameType('crush')).toBeNull()
  })

  // Why: this is the whole point of the registry — a new runtime is data, not five call sites.
  it('builds the same frame shape for any declared name', () => {
    const re = buildAgentIdentityFrameRe({ names: ['widgetcli'], executableSuffix: true })
    expect(re.test('widgetcli')).toBe(true)
    expect(re.test('widgetcli.exe')).toBe(true)
    expect(re.test('widgetcli - action required')).toBe(true)
    expect(re.test('use widgetcli here')).toBe(false)
  })
})

describe('Cline title visibility (STA-3906 / #13823)', () => {
  // Observed against cline 3.0.55: the CLI emits OSC 0 `Cline` and never varies it.
  it('resolves the live Cline title to identity, label, and an idle status', () => {
    expect(getAgentLabel('Cline')).toBe('Cline')
    expect(resolveTerminalTitleAgentType('Cline')).toBe('cline')
    expect(resolveExplicitTerminalTitleAgentType('Cline')).toBe('cline')
    expect(detectAgentStatusFromTitle('Cline')).toBe('idle')
  })

  it('maps decorated Cline frames to status without inventing status from mentions', () => {
    expect(detectAgentStatusFromTitle('Cline ready')).toBe('idle')
    expect(detectAgentStatusFromTitle('Cline working')).toBe('working')
    expect(detectAgentStatusFromTitle('Cline - action required')).toBe('permission')
    expect(detectAgentStatusFromTitle('⠋ Cline')).toBe('working')
    for (const title of ['port the cline prompt', '~/cline-scratch', 'cline-rules']) {
      expect(detectAgentStatusFromTitle(title)).toBeNull()
    }
  })

  it('keeps Claude task text that mentions cline as Claude', () => {
    expect(getAgentLabel('⠋ use cline for the sidebar fix')).toBe('Claude Code')
    expect(resolveTerminalTitleAgentType('⠋ use cline for the sidebar fix')).toBe('claude')
    // Why: the spinner still proves activity; the mention must not rebrand the pane.
    expect(detectAgentStatusFromTitle('⠋ use cline for the sidebar fix')).toBe('working')
  })
})

// Why: the Claude frame moved onto the shared builder — pin the behavior it had before.
describe('isClaudeIdentityFrameTitle after the shared-builder move', () => {
  it('accepts Claude frames and rejects Claude mentions', () => {
    for (const title of [
      'Claude',
      'claude code',
      'Claude Code',
      '✳ Claude Code',
      'Claude ready',
      'Claude Code - action required',
      'zsh | ⠋ Claude Code'
    ]) {
      expect(isClaudeIdentityFrameTitle(title)).toBe(true)
    }
    for (const title of [
      '⠋ ask claude about the parser',
      'claude-scratch',
      '~/claude/worktrees',
      'Claude Code review the diff'
    ]) {
      expect(isClaudeIdentityFrameTitle(title)).toBe(false)
    }
  })
})
