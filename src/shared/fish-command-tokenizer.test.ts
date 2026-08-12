import { describe, expect, it } from 'vitest'
import { tokenizeFishStartupCommand } from './fish-command-tokenizer'
import { tokenizeStartupCommand } from './tui-agent-startup-shell'

function tokens(value: string): string[] {
  const result = tokenizeFishStartupCommand(value)
  if (!result.ok) {
    throw new Error(result.error)
  }
  return result.tokens
}

function spanFlags(value: string): boolean[] {
  const result = tokenizeFishStartupCommand(value)
  if (!result.ok) {
    throw new Error(result.error)
  }
  return result.spans.map((span) => span.divergesFromShell)
}

describe('tokenizeFishStartupCommand', () => {
  it('treats a backslash inside single quotes as an escape, unlike sh', () => {
    expect(tokens(String.raw`'a\\b'`)).toEqual([String.raw`a\b`])
    expect(tokens(String.raw`'a\'b'`)).toEqual([`a'b`])
    // Every other backslash stays literal inside single quotes.
    expect(tokens(String.raw`'a\nb'`)).toEqual([String.raw`a\nb`])
  })

  it('rejects a trailing backslash before the closing single quote', () => {
    // fish reads the escaped quote as literal, so the string never closes.
    expect(tokenizeFishStartupCommand(String.raw`'ends\'`)).toEqual({
      ok: false,
      error: 'Unclosed quote in command template.'
    })
  })

  it('escapes only \\ $ " and a continuation inside double quotes', () => {
    expect(tokens(String.raw`"a\\b" "a\$b" "a\"b" "a\nb" "a\zb"`)).toEqual([
      String.raw`a\b`,
      'a$b',
      'a"b',
      String.raw`a\nb`,
      String.raw`a\zb`
    ])
  })

  it('decodes the unquoted escape set fish actually implements', () => {
    expect(tokens(String.raw`a\nb`)).toEqual(['a\nb'])
    expect(tokens(String.raw`a\tb`)).toEqual(['a\tb'])
    expect(tokens(String.raw`\x41 \X41 \101 A \U00000041`)).toEqual(['A', 'A', 'A', 'A', 'A'])
    expect(tokens(String.raw`\cA`)).toEqual([''])
    // An unknown escape drops the backslash and keeps the byte.
    expect(tokens(String.raw`a\zb`)).toEqual(['azb'])
  })

  it('keeps quoted regions attached to the surrounding token', () => {
    expect(tokens(`a"b"c'd'e`)).toEqual(['abcde'])
    expect(tokens(`--flag='has space'`)).toEqual(['--flag=has space'])
  })

  it('reports an unclosed quote of either kind', () => {
    expect(tokenizeFishStartupCommand(`a 'b`).ok).toBe(false)
    expect(tokenizeFishStartupCommand(`a "b`).ok).toBe(false)
  })

  it('flags live fish syntax a span splice cannot model', () => {
    // Command substitution, brace expansion and globs are all live in fish; an
    // unmatched wildcard is a hard error rather than a literal.
    expect(spanFlags('claude (echo hi)')).toEqual([false, true, true])
    expect(spanFlags('claude {a,b}')).toEqual([false, true])
    expect(spanFlags('claude *.ts')).toEqual([false, true])
    expect(spanFlags('claude a?b')).toEqual([false, true])
    expect(spanFlags('claude x; y')).toEqual([false, true, false])
    expect(spanFlags('claude trailing\\')).toEqual([false, true])
    // Plain words and quoted metacharacters stay modelable.
    expect(spanFlags(`claude --resume 'a*b' "c;d"`)).toEqual([false, false, false, false])
  })

  it('is what tokenizeStartupCommand uses for the fish dialect', () => {
    const line = String.raw`claude --prompt 'match \\d+'`
    expect(tokenizeStartupCommand(line, 'fish')).toEqual(tokenizeFishStartupCommand(line))
    // The sh tokenizer keeps both backslashes, which is not what fish does.
    const posix = tokenizeStartupCommand(line, 'posix')
    expect(posix.ok && posix.tokens.at(-1)).toBe(String.raw`match \\d+`)
  })
})
