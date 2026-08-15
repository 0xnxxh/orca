import { describe, expect, it } from 'vitest'
import {
  AGENT_IDENTITY_FRAMES,
  buildAgentIdentityFrameRe,
  isAgentIdentityFrameTitleFor,
  resolveAgentIdentityFrameType
} from './agent-identity-frame'
import { getAgentLabel } from './agent-title-identity'
import {
  detectAgentStatusFromTitle,
  isQuarterCircleSpinnerOnlyAgentTitle
} from './agent-title-status'
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

// Observed against qwen-code 0.21.12 under a pty: OSC 0 is `Qwen - <cwd basename>`
// padded to 80 chars, prefixed with `◐︎` while responding and `✳︎` while awaiting
// confirmation. Every literal below is a real captured payload (STA-2840 / #11148).
describe('Qwen Code title visibility (STA-2840 / #11148)', () => {
  const pad = (title: string): string => title.padEnd(80, ' ')
  const IDLE = pad('Qwen - scratchdir')
  const RESPONDING = pad('◐︎ Qwen - scratchdir')
  const CONFIRMING = pad('✳︎ Qwen - scratchdir')

  it('claims the name-plus-cwd frame the CLI actually writes, padding included', () => {
    for (const title of [IDLE, RESPONDING, CONFIRMING]) {
      expect(resolveAgentIdentityFrameType(title)).toBe('qwen-code')
    }
    expect(getAgentLabel(IDLE)).toBe('Qwen Code')
    expect(resolveTerminalTitleAgentType(IDLE)).toBe('qwen-code')
  })

  // Why: this is the whole bug — a responding pane was resolving to Claude because
  // `◐` is a quarter-circle spinner and nothing else claimed the title first.
  it('stops a responding Qwen pane from being attributed to Claude', () => {
    expect(getAgentLabel(RESPONDING)).toBe('Qwen Code')
    expect(resolveTerminalTitleAgentType(RESPONDING)).toBe('qwen-code')
    expect(isClaudeIdentityFrameTitle(RESPONDING)).toBe(false)
  })

  it('maps the declared glyphs to status, including the ✳ that means idle for Claude', () => {
    expect(detectAgentStatusFromTitle(IDLE)).toBe('idle')
    expect(detectAgentStatusFromTitle(RESPONDING)).toBe('working')
    expect(detectAgentStatusFromTitle(CONFIRMING)).toBe('permission')
    // Why: the same glyph must keep meaning idle for the agent that declares no glyphs.
    expect(detectAgentStatusFromTitle('✳ Claude Code')).toBe('idle')
  })

  it('rejects the name in task text, a path, or a hyphenated compound', () => {
    for (const title of [
      'qwen-code-fixtures ready',
      '~/qwen/working',
      'src/qwen/index.ts',
      'port the qwen prompt'
    ]) {
      expect(resolveAgentIdentityFrameType(title)).toBeNull()
      expect(detectAgentStatusFromTitle(title)).toBeNull()
    }
  })

  it('keeps Claude task text that mentions qwen as Claude', () => {
    expect(getAgentLabel('⠋ ask qwen about the parser')).toBe('Claude Code')
    expect(resolveTerminalTitleAgentType('⠋ ask qwen about the parser')).toBe('claude')
  })

  // Why: the context suffix must not swallow arbitrary trailing prose.
  it('accepts only a separated context tail, never free-form trailing text', () => {
    expect(isAgentIdentityFrameTitleFor('Qwen - orca', 'qwen-code')).toBe(true)
    expect(isAgentIdentityFrameTitleFor('Qwen', 'qwen-code')).toBe(true)
    expect(isAgentIdentityFrameTitleFor('Qwen fix the parser', 'qwen-code')).toBe(false)
    expect(isAgentIdentityFrameTitleFor('Qwen-orca', 'qwen-code')).toBe(false)
  })

  // Why: inside a multiplexer Qwen writes OSC 2 only and skips the padding, and a long
  // cwd is truncated at 80 chars mid-name — both must still resolve to the same agent.
  it('resolves the unpadded multiplexer form and an 80-char-truncated cwd', () => {
    expect(resolveAgentIdentityFrameType('zsh | Qwen - orca')).toBe('qwen-code')
    expect(resolveAgentIdentityFrameType(`Qwen - ${'a'.repeat(200)}`.slice(0, 80))).toBe(
      'qwen-code'
    )
    // Why: qwen falls back to its own name when the cwd basename is empty.
    expect(resolveAgentIdentityFrameType('Qwen - qwen')).toBe('qwen-code')
  })

  // Why: `◐` proves activity, not identity — but a title that also carries the agent's own
  // name is not spinner-only, and Qwen must agree with Claude here (STA-4028 / #13925).
  it('does not read a named Qwen frame as spinner-only evidence', () => {
    expect(isQuarterCircleSpinnerOnlyAgentTitle(RESPONDING)).toBe(false)
    expect(isQuarterCircleSpinnerOnlyAgentTitle('◐ Claude Code')).toBe(false)
    expect(isQuarterCircleSpinnerOnlyAgentTitle('◐ building')).toBe(true)
  })

  // Why: the registry is shared — prove the neighbours it already carried still hold.
  it('leaves the agents already in the registry unchanged', () => {
    expect(resolveAgentIdentityFrameType('Cline')).toBe('cline')
    expect(detectAgentStatusFromTitle('Cline')).toBe('idle')
    expect(resolveAgentIdentityFrameType('Claude Code')).toBe('claude')
    expect(isClaudeIdentityFrameTitle('zsh | ⠋ Claude Code')).toBe(true)
    // Why: a context suffix is opt-in; cline must not start accepting `Cline - foo`.
    expect(isAgentIdentityFrameTitleFor('Cline - the parser', 'cline')).toBe(false)
    expect(AGENT_IDENTITY_FRAMES.amp).toBeUndefined()
  })
})
