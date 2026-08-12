import { describe, expect, it } from 'vitest'
import {
  buildShellCommandFromArgv,
  clearEnvCommand,
  commandSeparator,
  isPosixStartupShell,
  quoteStartupArg,
  resolveLoginShellStartupDialect,
  tokenizeStartupCommand
} from './tui-agent-startup-shell'
import { buildAgentDraftLaunchPlan } from './tui-agent-startup'

function expectSpansCoverTokens(source: string, shell: 'powershell' | 'cmd'): string[] {
  const result = tokenizeStartupCommand(source, shell)
  expect(result.ok).toBe(true)
  if (!result.ok) {
    return []
  }
  expect(result.spans).toHaveLength(result.tokens.length)
  let previousEnd = 0
  for (const [index, { start, end }] of result.spans.entries()) {
    expect(start).toBeGreaterThanOrEqual(previousEnd)
    expect(end).toBeGreaterThan(start)
    // Every raw span must re-tokenize to exactly its own token.
    const slice = tokenizeStartupCommand(source.slice(start, end), shell)
    expect(slice.ok && slice.tokens).toEqual([result.tokens[index]])
    previousEnd = end
  }
  return result.spans.map(({ start, end }) => source.slice(start, end))
}

describe('tokenizeStartupCommand spans (windows shells)', () => {
  it('covers plain and quoted tokens on powershell', () => {
    const source = "claude --msg 'hello world'"
    const result = tokenizeStartupCommand(source, 'powershell')
    expect(result).toEqual({
      ok: true,
      tokens: ['claude', '--msg', 'hello world'],
      spans: [
        { start: 0, end: 6, divergesFromShell: false },
        { start: 7, end: 12, divergesFromShell: false },
        { start: 13, end: 26, divergesFromShell: false }
      ]
    })
  })

  it('starts a span at a token-leading escape character', () => {
    expect(expectSpansCoverTokens('claude ^&literal next', 'cmd')).toEqual([
      'claude',
      '^&literal',
      'next'
    ])
    expect(expectSpansCoverTokens('claude `x tail', 'powershell')).toEqual(['claude', '`x', 'tail'])
  })

  it('spans a powershell doubled-quote token as one raw range', () => {
    expect(expectSpansCoverTokens("claude 'a''b' end", 'powershell')).toEqual([
      'claude',
      "'a''b'",
      'end'
    ])
  })

  it('spans a token opened by a quote at end of input', () => {
    expect(expectSpansCoverTokens('claude ""', 'cmd')).toEqual(['claude', '""'])
  })
})

describe('fish startup shell dialect', () => {
  it('clears variables with fish syntax instead of the sh `unset` fish rejects', () => {
    expect(clearEnvCommand('CODEX_HOME', 'fish')).toBe('set -e CODEX_HOME')
    expect(clearEnvCommand('CODEX_HOME', 'posix')).toBe('unset CODEX_HOME')
    expect(clearEnvCommand('CODEX_HOME', 'cmd')).toBe('set "CODEX_HOME="')
    expect(clearEnvCommand('CODEX_HOME', 'powershell')).toBe(
      'Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue'
    )
  })

  it('shares POSIX word splitting and chaining but NOT quoting', () => {
    // fish single quotes are not literal: `\\` and `\'` are escapes inside them.
    expect(quoteStartupArg("it's", 'fish')).toBe(String.raw`'it\'s'`)
    expect(quoteStartupArg(String.raw`\\server\share`, 'fish')).toBe(
      String.raw`'\\\\server\\share'`
    )
    // The sh spelling would have halved those backslashes when fish read it back.
    expect(quoteStartupArg(String.raw`\\server\share`, 'posix')).toBe(String.raw`'\\server\share'`)
    // A trailing backslash is a hard syntax error in fish unless it is escaped.
    expect(quoteStartupArg('ends\\', 'fish')).toBe(String.raw`'ends\\'`)
    expect(buildShellCommandFromArgv(['codex', 'resume', 'a b'], 'fish')).toBe(
      buildShellCommandFromArgv(['codex', 'resume', 'a b'], 'posix')
    )
    expect(commandSeparator('fish')).toBe('; ')
    expect(isPosixStartupShell('fish')).toBe(true)
  })

  it('tokenizes with fish escape rules rather than sh ones', () => {
    const line = String.raw`codex --arg 'a\\b'`
    expect(tokenizeStartupCommand(line, 'fish')).not.toEqual(tokenizeStartupCommand(line, 'posix'))
    const fishTokens = tokenizeStartupCommand(line, 'fish')
    expect(fishTokens.ok && fishTokens.tokens.at(-1)).toBe(String.raw`a\b`)
  })

  it('round-trips an adversarial argument through quote then tokenize', () => {
    for (const value of [
      String.raw`use \d+ and \\server\share`,
      "it's mine",
      'ends\\',
      'a "b" c',
      '$PATH *.ts'
    ]) {
      const tokenized = tokenizeStartupCommand(quoteStartupArg(value, 'fish'), 'fish')
      expect(tokenized.ok && tokenized.tokens).toEqual([value])
    }
  })

  it('maps login shell paths to their dialect', () => {
    expect(resolveLoginShellStartupDialect('/opt/homebrew/bin/fish')).toBe('fish')
    expect(resolveLoginShellStartupDialect('/usr/local/bin/FISH')).toBe('fish')
    expect(resolveLoginShellStartupDialect('/bin/zsh')).toBe('posix')
    expect(resolveLoginShellStartupDialect('/bin/bash')).toBe('posix')
    expect(resolveLoginShellStartupDialect('')).toBe('posix')
    expect(resolveLoginShellStartupDialect(undefined)).toBe('posix')
  })

  it('clears an agent draft prefill variable with fish syntax', () => {
    const plan = buildAgentDraftLaunchPlan({
      agent: 'pi',
      draft: 'hello',
      cmdOverrides: {},
      platform: 'darwin',
      shell: 'fish'
    })

    expect(plan?.launchCommand).toBe('pi; set -e ORCA_PI_PREFILL')
    expect(plan?.env?.ORCA_PI_PREFILL).toBe('hello')
  })
})
