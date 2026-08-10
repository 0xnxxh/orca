import { describe, expect, it } from 'vitest'
import { buildClaudeResumeLaunchCommand } from './agent-resume-launch-command'
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

/** Independent selector oracle — deliberately NOT the implementation's own
 * predicate, so a regression that shrinks the stripped set cannot also blind
 * this assertion. */
function isSelectorShapedToken(token: string): boolean {
  return (
    ['--resume', '--continue', '-r', '-c'].includes(token) ||
    ['--resume=', '--continue=', '-r=', '-c='].some((prefix) => token.startsWith(prefix))
  )
}

/** Tokenizes a launch command and asserts exactly one identity-bearing resume. */
function expectSingleAuthoritativeResume(command: string, shell: AgentStartupShell): void {
  const tokenized = tokenizeStartupCommand(command, shell)
  expect(tokenized.ok).toBe(true)
  if (!tokenized.ok) {
    return
  }
  const selectors = tokenized.tokens.filter(isSelectorShapedToken)
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
    expect(buildClaudeResumeLaunchCommand('claude --agent -reviewer', RESUME, 'posix')).toBe(
      `claude --agent -reviewer '--resume' '${SESSION_ID}'`
    )
    expect(buildClaudeResumeLaunchCommand('claude --plugin-url -remote.zip', RESUME, 'posix')).toBe(
      `claude --plugin-url -remote.zip '--resume' '${SESSION_ID}'`
    )
  })

  it('leaves the ambiguous joined -r<id> form alone (degrades to pre-guard behavior)', () => {
    expect(buildClaudeResumeLaunchCommand('claude -rstale-session', RESUME, 'posix')).toBe(
      `claude -rstale-session '--resume' '${SESSION_ID}'`
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

  it('strips selectors that follow claude after a wrapper terminator', () => {
    expect(
      buildClaudeResumeLaunchCommand("mise exec -- claude '--resume' stale", RESUME, 'posix')
    ).toBe(`mise exec -- claude '--resume' '${SESSION_ID}'`)
  })

  it('fails open for claude outside command position (wrapper without --)', () => {
    // Why: npx/bunx-style passthrough cannot be told apart from an argument
    // that merely names claude, so the guard defers to append-only behavior.
    expect(buildClaudeResumeLaunchCommand("npx claude '--resume'", RESUME, 'posix')).toBe(
      `npx claude '--resume' '--resume' '${SESSION_ID}'`
    )
  })

  it('never mistakes a claude-suffixed argument for the executable', () => {
    expect(
      buildClaudeResumeLaunchCommand(
        'ssh -i ~/.ssh/claude devbox -- claude --resume OLD',
        RESUME,
        'posix'
      )
    ).toBe(`ssh -i ~/.ssh/claude devbox -- claude '--resume' '${SESSION_ID}'`)
    expect(
      buildClaudeResumeLaunchCommand(
        'mise exec --cd /Users/me/src/claude -- claude --resume OLD',
        RESUME,
        'posix'
      )
    ).toBe(`mise exec --cd /Users/me/src/claude -- claude '--resume' '${SESSION_ID}'`)
    // No claude in command position at all: wrapper flags stay untouched.
    expect(
      buildClaudeResumeLaunchCommand(
        'nix develop /Users/me/src/claude -c claude --resume OLD',
        RESUME,
        'posix'
      )
    ).toBe(`nix develop /Users/me/src/claude -c claude --resume OLD '--resume' '${SESSION_ID}'`)
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

  it.each([
    'claude -c && echo done',
    'claude --resume stale; echo hi',
    'claude --resume stale;echo hi',
    'claude -c | tee /tmp/log',
    'claude 2>/tmp/x.log',
    'claude --resume stale\n--verbose'
  ])('fails open when the base chains shell syntax after claude: %s', (base) => {
    expect(buildClaudeResumeLaunchCommand(base, RESUME, 'posix')).toBe(
      `${base} '--resume' '${SESSION_ID}'`
    )
  })

  it('still strips when operators are safely quoted', () => {
    expect(
      buildClaudeResumeLaunchCommand(
        "claude --append-system-prompt 'use && wisely' --resume stale",
        RESUME,
        'posix'
      )
    ).toBe(`claude --append-system-prompt 'use && wisely' '--resume' '${SESSION_ID}'`)
  })

  it('recognizes claude behind the PowerShell call operator', () => {
    expect(buildClaudeResumeLaunchCommand("& claude '--resume'", RESUME, 'powershell')).toBe(
      `& claude '--resume' '${SESSION_ID}'`
    )
    expect(
      buildClaudeResumeLaunchCommand(
        "& 'C:\\Program Files\\claude\\claude.exe' --resume old",
        RESUME,
        'powershell'
      )
    ).toBe(`& 'C:\\Program Files\\claude\\claude.exe' '--resume' '${SESSION_ID}'`)
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
