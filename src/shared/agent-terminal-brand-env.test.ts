import { describe, expect, it } from 'vitest'
import {
  applyAgentTerminalBrandEnv,
  getAgentTerminalBrandOverride
} from './agent-terminal-brand-env'

describe('agent terminal brand env', () => {
  it('advertises an xterm.js brand to grok so it emits OSC 8 hyperlinks', () => {
    expect(getAgentTerminalBrandOverride('grok')).toBe('vscode')
  })

  it.each([['claude' as const], ['codex' as const], ['gemini' as const], ['aider' as const]])(
    'keeps Orca’s own identity for %s',
    (agent) => {
      expect(getAgentTerminalBrandOverride(agent)).toBeNull()
    }
  )

  it.each([[null], [undefined]])('keeps Orca’s own identity for a plain shell (%s)', (agent) => {
    expect(getAgentTerminalBrandOverride(agent)).toBeNull()
  })

  it('preserves the true brand under ORCA_TERM_PROGRAM', () => {
    const env: Record<string, string> = { TERM_PROGRAM: 'Orca', TERM: 'xterm-256color' }

    applyAgentTerminalBrandEnv(env, 'grok')

    expect(env.TERM_PROGRAM).toBe('vscode')
    expect(env.ORCA_TERM_PROGRAM).toBe('Orca')
    expect(env.TERM).toBe('xterm-256color')
  })

  it('leaves the environment untouched for other agents', () => {
    const env: Record<string, string> = { TERM_PROGRAM: 'Orca' }

    applyAgentTerminalBrandEnv(env, 'claude')

    expect(env).toEqual({ TERM_PROGRAM: 'Orca' })
  })

  it('records a fallback identity when no brand was set yet', () => {
    const env: Record<string, string> = {}

    applyAgentTerminalBrandEnv(env, 'grok')

    expect(env.ORCA_TERM_PROGRAM).toBe('Orca')
  })
})
