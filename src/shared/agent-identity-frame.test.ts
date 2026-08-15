import { describe, expect, it } from 'vitest'
import {
  AGENT_IDENTITY_FRAMES,
  buildAgentIdentityFrameRe,
  isAgentIdentityFrameTitleFor,
  resolveAgentIdentityFrameType
} from './agent-identity-frame'
import { getAgentLabel, isClaudeAgent } from './agent-title-identity'
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

// The only Trae title Orca has on record is the one in #11643's repro: a live TRAE CN
// session whose pane title is the bare launcher name `traecli`, undecorated, while the
// session is interactive and already answering. TRAE CN's installer is region locked
// (trae.cn 403s "denied by region block" from outside CN), so nothing beyond that frame
// is observed — hence no glyph or context vocabulary is declared for it.
describe('Trae CLI title visibility (STA-3048 / #11643)', () => {
  it('resolves the launcher-name title to identity, label, and an idle status', () => {
    expect(resolveAgentIdentityFrameType('traecli')).toBe('trae')
    expect(getAgentLabel('traecli')).toBe('Trae')
    expect(resolveTerminalTitleAgentType('traecli')).toBe('trae')
    expect(resolveExplicitTerminalTitleAgentType('traecli')).toBe('trae')
    expect(detectAgentStatusFromTitle('traecli')).toBe('idle')
  })

  // Why: TRAE CN ships a `.cmd` launcher on Windows, so the pane title there surfaces
  // the extension rather than the bare name.
  it('accepts the Windows launcher forms and the multiplexer-wrapped form', () => {
    for (const title of ['traecli.exe', 'traecli.cmd', 'zsh | traecli']) {
      expect(resolveAgentIdentityFrameType(title)).toBe('trae')
      expect(detectAgentStatusFromTitle(title)).toBe('idle')
    }
  })

  // Why: the unrelated open-source bytedance/trae-agent installs a `trae-cli` binary and
  // `trae` is an ordinary word — TUI_AGENT_CONFIG.trae detects on `traecli` for exactly
  // this reason, and the frame must not be looser than the launcher it mirrors.
  it('rejects the bare word, the unrelated trae-agent binary, paths, and task text', () => {
    for (const title of [
      'trae',
      'trae-cli',
      'trae-agent',
      '~/traecli/working',
      'src/traecli/index.ts',
      'traecli-scratch',
      'port the traecli prompt'
    ]) {
      expect(resolveAgentIdentityFrameType(title)).toBeNull()
      expect(detectAgentStatusFromTitle(title)).toBeNull()
      expect(getAgentLabel(title)).not.toBe('Trae')
    }
  })

  // Why: a decorated `traecli` frame resolved to Claude Code before the registry row, so
  // a Trae pane could reach Claude-only behavior (the prompt-cache timer and the parked
  // byte watcher both branch on isClaudeAgent).
  it('stops a decorated traecli title from being attributed to Claude', () => {
    expect(getAgentLabel('⠋ traecli')).toBe('Trae')
    expect(resolveTerminalTitleAgentType('⠋ traecli')).toBe('trae')
    expect(isClaudeAgent('⠋ traecli')).toBe(false)
    expect(isClaudeIdentityFrameTitle('⠋ traecli')).toBe(false)
  })

  it('keeps Claude task text that mentions traecli as Claude', () => {
    expect(getAgentLabel('⠋ fix the traecli mapping')).toBe('Claude Code')
    expect(resolveTerminalTitleAgentType('⠋ fix the traecli mapping')).toBe('claude')
    expect(isClaudeAgent('⠋ fix the traecli mapping')).toBe(true)
  })

  it('never lets the frame swallow trailing prose or a context tail', () => {
    expect(isAgentIdentityFrameTitleFor('traecli fix the parser', 'trae')).toBe(false)
    // Why: Trae has never been seen appending a cwd, so its frame stays anchored on the
    // name alone — a trailing tail is somebody's shell title, not Trae identity.
    expect(isAgentIdentityFrameTitleFor('traecli - orca', 'trae')).toBe(false)
  })

  // Why: the registry is shared — prove the neighbours it already carried still hold.
  it('leaves the agents already in the registry unchanged', () => {
    expect(resolveAgentIdentityFrameType('Cline')).toBe('cline')
    expect(detectAgentStatusFromTitle('Cline')).toBe('idle')
    expect(getAgentLabel('Cline')).toBe('Cline')
    expect(resolveAgentIdentityFrameType('Claude Code')).toBe('claude')
    expect(isClaudeIdentityFrameTitle('zsh | ⠋ Claude Code')).toBe(true)
    expect(getAgentLabel('⠋ use cline for the sidebar fix')).toBe('Claude Code')
    expect(AGENT_IDENTITY_FRAMES.amp).toBeUndefined()
  })
})
