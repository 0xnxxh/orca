import { describe, expect, it } from 'vitest'
import { buildClaudeResumeLaunchCommand } from './claude-resume-selector-guard'
import { buildAgentResumeStartupPlan, buildAgentStartupPlan } from './tui-agent-startup'
import { tokenizeStartupCommand, type AgentStartupShell } from './tui-agent-startup-shell'

const SESSION_ID = 'claude-session-1'
const RESUME = ['--resume', SESSION_ID] as const
const providerSession = { key: 'session_id', id: SESSION_ID } as const

const SHELLS: { platform: NodeJS.Platform; shell: AgentStartupShell }[] = [
  { platform: 'linux', shell: 'posix' },
  { platform: 'darwin', shell: 'posix' },
  { platform: 'win32', shell: 'powershell' },
  { platform: 'win32', shell: 'cmd' }
]

/** Tokenizes a launch command and asserts exactly one identity-bearing resume. */
function expectSingleAuthoritativeResume(command: string, shell: AgentStartupShell): void {
  const tokenized = tokenizeStartupCommand(command, shell)
  expect(tokenized.ok).toBe(true)
  if (!tokenized.ok) {
    return
  }
  const selectors = tokenized.tokens.filter(
    (token) => token === '--resume' || token === '-r' || token === '--continue' || token === '-c'
  )
  expect(selectors).toEqual(['--resume'])
  const index = tokenized.tokens.indexOf('--resume')
  expect(tokenized.tokens[index + 1]).toBe(SESSION_ID)
}

describe('buildClaudeResumeLaunchCommand', () => {
  it.each(SHELLS)('appends the authoritative selector to a plain base ($shell)', ({ shell }) => {
    const command = buildClaudeResumeLaunchCommand('claude', RESUME, shell)
    expectSingleAuthoritativeResume(command, shell)
    expect(command.startsWith('claude ')).toBe(true)
  })

  it.each(SHELLS)('strips a bare persisted --resume picker default ($shell)', ({ shell }) => {
    const base = shell === 'cmd' ? 'claude "--resume"' : "claude '--resume'"
    const command = buildClaudeResumeLaunchCommand(base, RESUME, shell)
    expectSingleAuthoritativeResume(command, shell)
  })

  it.each([
    'claude --resume stale-session',
    'claude --resume=stale-session',
    'claude -r stale-session',
    'claude -r=stale-session',
    'claude -rstale-session',
    'claude --resume= --model sonnet',
    'claude --continue',
    'claude -c',
    'claude --continue=1',
    'claude -c=1',
    'claude --resume stale -r older --continue -c'
  ])('replaces stale selectors in %s', (base) => {
    const command = buildClaudeResumeLaunchCommand(base, RESUME, 'posix')
    expectSingleAuthoritativeResume(command, 'posix')
  })

  it('keeps surviving options when stripping selectors', () => {
    expect(
      buildClaudeResumeLaunchCommand('claude --resume stale --model sonnet', RESUME, 'posix')
    ).toBe(`claude --model sonnet '--resume' '${SESSION_ID}'`)
  })

  it('never mistakes a dash-leading option value for a selector', () => {
    expect(buildClaudeResumeLaunchCommand('claude --model -recent', RESUME, 'posix')).toBe(
      `claude --model -recent '--resume' '${SESSION_ID}'`
    )
    expect(
      buildClaudeResumeLaunchCommand('claude --append-system-prompt -rules-here', RESUME, 'posix')
    ).toBe(`claude --append-system-prompt -rules-here '--resume' '${SESSION_ID}'`)
    expect(buildClaudeResumeLaunchCommand('claude --add-dir -c', RESUME, 'posix')).toBe(
      `claude --add-dir -c '--resume' '${SESSION_ID}'`
    )
  })

  it('leaves wrapper commands untouched and appends at the end', () => {
    expect(buildClaudeResumeLaunchCommand('bash -c claude', RESUME, 'posix')).toBe(
      `bash -c claude '--resume' '${SESSION_ID}'`
    )
    expect(buildClaudeResumeLaunchCommand('mise exec -- claude', RESUME, 'posix')).toBe(
      `mise exec -- claude '--resume' '${SESSION_ID}'`
    )
    expect(buildClaudeResumeLaunchCommand('sudo -u dev -- claude', RESUME, 'posix')).toBe(
      `sudo -u dev -- claude '--resume' '${SESSION_ID}'`
    )
  })

  it('strips selectors that follow claude inside a wrapper command', () => {
    expect(
      buildClaudeResumeLaunchCommand("mise exec -- claude '--resume' stale", RESUME, 'posix')
    ).toBe(`mise exec -- claude '--resume' '${SESSION_ID}'`)
    expect(buildClaudeResumeLaunchCommand("npx claude '--resume'", RESUME, 'posix')).toBe(
      `npx claude '--resume' '${SESSION_ID}'`
    )
  })

  it('preserves an env-assignment or path prefix byte for byte', () => {
    expect(
      buildClaudeResumeLaunchCommand('FOO="$HOME/x" ~/bin/claude \'--resume\'', RESUME, 'posix')
    ).toBe(`FOO="$HOME/x" ~/bin/claude '--resume' '${SESSION_ID}'`)
  })

  it('recognizes Windows claude executable spellings', () => {
    expect(buildClaudeResumeLaunchCommand('C:\\tools\\claude.CMD "--resume"', RESUME, 'cmd')).toBe(
      `C:\\tools\\claude.CMD "--resume" "${SESSION_ID}"`
    )
  })

  it("inserts the selector before claude's own -- terminator", () => {
    expect(
      buildClaudeResumeLaunchCommand('claude --resume stale -- positional', RESUME, 'posix')
    ).toBe(`claude '--resume' '${SESSION_ID}' -- positional`)
  })

  it('fails open when the base cannot be tokenized', () => {
    expect(buildClaudeResumeLaunchCommand('claude "unterminated', RESUME, 'posix')).toBe(
      `claude "unterminated '--resume' '${SESSION_ID}'`
    )
  })

  it('fails open when no claude executable token exists', () => {
    expect(buildClaudeResumeLaunchCommand('my-agent-wrapper --resume', RESUME, 'posix')).toBe(
      `my-agent-wrapper --resume '--resume' '${SESSION_ID}'`
    )
  })
})

describe('buildAgentResumeStartupPlan claude selector guard', () => {
  it.each(SHELLS)(
    'emits one identity-bearing resume for a persisted bare selector ($platform/$shell)',
    ({ platform, shell }) => {
      const initial = buildAgentStartupPlan({
        agent: 'claude',
        prompt: '',
        cmdOverrides: {},
        agentArgs: '--resume',
        platform,
        shell,
        allowEmptyPromptLaunch: true
      })
      expect(initial).not.toBeNull()
      const restored = buildAgentResumeStartupPlan({
        agent: 'claude',
        providerSession,
        cmdOverrides: {},
        agentArgs: initial?.launchConfig.agentArgs,
        agentCommand: initial?.launchConfig.agentCommand,
        platform,
        shell
      })
      expect(restored).not.toBeNull()
      expectSingleAuthoritativeResume(restored?.launchCommand ?? '', shell)
    }
  )

  it('emits one identity-bearing resume when only default args carry a stale id', () => {
    const restored = buildAgentResumeStartupPlan({
      agent: 'claude',
      providerSession,
      cmdOverrides: {},
      agentArgs: '--resume stale-session --model sonnet',
      platform: 'linux'
    })
    expect(restored?.launchCommand).toBe(`claude '--model' 'sonnet' '--resume' '${SESSION_ID}'`)
  })

  it('still launches exotic custom commands that the tokenizer rejects', () => {
    const restored = buildAgentResumeStartupPlan({
      agent: 'claude',
      providerSession,
      cmdOverrides: {},
      agentCommand: 'claude --model $(cat ~/.claude-model) "unterminated',
      platform: 'darwin'
    })
    expect(restored).not.toBeNull()
    expect(restored?.launchCommand.endsWith(`'--resume' '${SESSION_ID}'`)).toBe(true)
  })

  it('does not change other agents', () => {
    const restored = buildAgentResumeStartupPlan({
      agent: 'gemini',
      providerSession,
      cmdOverrides: {},
      agentArgs: '--resume',
      platform: 'linux'
    })
    expect(restored?.launchCommand).toBe(`gemini '--resume' '--resume' '${SESSION_ID}'`)
  })

  it('persists the original base command unchanged', () => {
    const restored = buildAgentResumeStartupPlan({
      agent: 'claude',
      providerSession,
      cmdOverrides: {},
      agentCommand: "claude '--resume'",
      platform: 'linux'
    })
    expect(restored?.launchConfig.agentCommand).toBe("claude '--resume'")
  })
})
