import { describe, expect, it } from 'vitest'
import {
  detectKiloTitleStatus,
  isKiloNativeTitle,
  parseKiloTitleIndicator
} from './kilo-terminal-title'
import { detectAgentStatusFromTitle } from './agent-title-status'
import { getAgentLabel as getIdentityAgentLabel, isClaudeAgent } from './agent-title-identity'
import {
  getAgentLabel,
  isClaudeAgent as isClaudeAgentFromTitleType,
  resolveTerminalTitleAgentType
} from './terminal-title-agent-type'
import { isOpenCodeNativeTitle } from './opencode-terminal-title'

// Titles below are the shapes `@kilocode/cli` 7.4.22 actually emits: the bare
// base `Kilo CLI` on the home screen (captured from its raw OSC 0 stream) and
// `${glyph} Kilo CLI | ${session title}` in a session, with the glyph drawn from
// Kilo's `unicode` (◔ ⚠ ✓) or `emojis` (💭 🔶 ✅) `title_icon` tables.
const HOME = 'Kilo CLI'
const SESSION = 'Kilo CLI | fix the flaky pty test'
const WORKING = '◔ Kilo CLI | fix the flaky pty test'
const ATTENTION = '⚠ Kilo CLI | fix the flaky pty test'
const FINISHED = '✓ Kilo CLI | fix the flaky pty test'

describe('parseKiloTitleIndicator', () => {
  it('reads every indicator Kilo can emit, in both of its glyph tables', () => {
    expect(parseKiloTitleIndicator(HOME)).toBe('none')
    expect(parseKiloTitleIndicator(SESSION)).toBe('none')
    expect(parseKiloTitleIndicator(WORKING)).toBe('working')
    expect(parseKiloTitleIndicator(ATTENTION)).toBe('attention')
    expect(parseKiloTitleIndicator(FINISHED)).toBe('finished')
    expect(parseKiloTitleIndicator('💭 Kilo CLI | ship it')).toBe('working')
    expect(parseKiloTitleIndicator('🔶 Kilo CLI | ship it')).toBe('attention')
    expect(parseKiloTitleIndicator('✅ Kilo CLI | ship it')).toBe('finished')
    // Fonts and terminals may round-trip ⚠ with a variation selector.
    expect(parseKiloTitleIndicator('⚠️ Kilo CLI | ship it')).toBe('attention')
  })

  it('accepts a multiplexer or SSH wrapper prefix, and tolerates padding', () => {
    expect(parseKiloTitleIndicator('tmux | Kilo CLI | ses_123')).toBe('none')
    expect(parseKiloTitleIndicator('ssh build-host | ◔ Kilo CLI | ses_123')).toBe('working')
    expect(parseKiloTitleIndicator('user@host: ~/code | Kilo CLI')).toBe('none')
    expect(parseKiloTitleIndicator('  Kilo CLI  ')).toBe('none')
    expect(parseKiloTitleIndicator('Kilo CLI |\tses_123')).toBe('none')
    // Kilo's own non-session route still frames the base marker.
    expect(parseKiloTitleIndicator('Kilo CLI | KiloClaw')).toBe('none')
  })

  it('rejects prose that merely mentions the CLI, and non-Kilo titles', () => {
    // Kilo's own docs/pager text — a trailing word is not Kilo's ` | ` tail.
    expect(isKiloNativeTitle('Kilo CLI Configuration Reference')).toBe(false)
    expect(isKiloNativeTitle('installing Kilo CLI')).toBe(false)
    expect(isKiloNativeTitle('kilo cli | ses_123')).toBe(false) // case-sensitive marker
    expect(isKiloNativeTitle('Kilo CLI |')).toBe(false) // empty session tail
    expect(isKiloNativeTitle('Kilo CLI|ses_123')).toBe(false) // no spaces around the pipe
    expect(isKiloNativeTitle('kilo')).toBe(false)
    expect(isKiloNativeTitle('OC | ses_123')).toBe(false)
    expect(isKiloNativeTitle('')).toBe(false)
    expect(isKiloNativeTitle(undefined)).toBe(false)
    // A glyph-led segment belongs to whoever emitted it; it is not a wrapper.
    expect(isKiloNativeTitle('◔ build step | Kilo CLI')).toBe(false)
  })
})

describe('detectKiloTitleStatus', () => {
  it('maps Kilo indicators onto Orca title status', () => {
    expect(detectKiloTitleStatus(WORKING)).toBe('working')
    // attention covers permission / question / suggestion / network / plan approval.
    expect(detectKiloTitleStatus(ATTENTION)).toBe('permission')
    expect(detectKiloTitleStatus(FINISHED)).toBe('idle')
    expect(detectKiloTitleStatus(HOME)).toBe('idle')
    expect(detectKiloTitleStatus('a plain shell')).toBeNull()
  })
})

describe('Kilo panes in the title-detection vocabulary', () => {
  it('gives every Kilo frame an identity, a type and a status', () => {
    for (const title of [HOME, SESSION, WORKING, ATTENTION, FINISHED]) {
      expect(getAgentLabel(title)).toBe('Kilocode')
      expect(getIdentityAgentLabel(title)).toBe('Kilocode')
      expect(resolveTerminalTitleAgentType(title)).toBe('kilo')
    }
    expect(detectAgentStatusFromTitle(HOME)).toBe('idle')
    expect(detectAgentStatusFromTitle(WORKING)).toBe('working')
    expect(detectAgentStatusFromTitle(ATTENTION)).toBe('permission')
    expect(detectAgentStatusFromTitle(FINISHED)).toBe('idle')
  })

  it('keeps a Kilo pane out of Claude-only behavior even when its session text carries a spinner', () => {
    // Why: `⠋` inside free-form session text is the task's, not Claude's. Both
    // isClaudeAgent copies gate Claude's prompt-cache timer and parked-terminal
    // byte watcher, so both must reject the frame.
    const spinnerInTask = '⚠ Kilo CLI | ⠋ run the flaky suite'
    expect(isClaudeAgent(spinnerInTask)).toBe(false)
    expect(isClaudeAgentFromTitleType(spinnerInTask)).toBe(false)
    expect(getAgentLabel(spinnerInTask)).toBe('Kilocode')
    // The declared indicator wins over the borrowed spinner: Kilo needs input.
    expect(detectAgentStatusFromTitle(spinnerInTask)).toBe('permission')
  })

  it('leaves the other native-title families untouched', () => {
    // Why: Kilo is an OpenCode fork sharing this title shape; adding it must not
    // move OpenCode, MiMo Code or Claude panes.
    expect(isKiloNativeTitle('OC | ses_123')).toBe(false)
    expect(isOpenCodeNativeTitle('Kilo CLI | ses_123')).toBe(false)
    expect(getAgentLabel('OC | ses_123')).toBe('OpenCode')
    expect(detectAgentStatusFromTitle('⠋ OC | ses_123')).toBe('working')
    expect(detectAgentStatusFromTitle('OC | ses_123')).toBe('idle')
    expect(getAgentLabel('✳ Fix the auth bug')).toBe('Claude Code')
    expect(detectAgentStatusFromTitle('✳ Fix the auth bug')).toBe('idle')
    expect(isClaudeAgent('✳ Fix the auth bug')).toBe(true)
    expect(isClaudeAgentFromTitleType('✳ Fix the auth bug')).toBe(true)
    expect(getAgentLabel('⠋ Codex')).toBe('Codex')
    expect(resolveTerminalTitleAgentType('MiMo Code')).toBe('mimo-code')
  })
})
