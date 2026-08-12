import type { CommandTokenSpan } from './commit-message-prompt'

/**
 * Splits a command line the way fish does, which is NOT the way sh does.
 *
 * fish single quotes are not literal: `\\` and `\'` are escapes inside them, so
 * a trailing backslash before the closing quote is a syntax error rather than a
 * literal byte. Unquoted backslashes decode the full C-style escape set
 * (`\n`, `\t`, `\x41`, `\101`, `A`, `\cA`, …) instead of just protecting the
 * next byte, and inside double quotes only `\\`, `\$`, `\"` and a line
 * continuation are escapes — every other backslash stays literal.
 *
 * Verified against fish 4.7.1. Feeding these strings through the sh tokenizer
 * silently drops or invents backslashes, which is how a regex or a UNC path in a
 * user's CLI-args string gets corrupted before it ever reaches the agent.
 */
export type FishStartupCommandTokens =
  | { ok: true; tokens: string[]; spans: CommandTokenSpan[] }
  | { ok: false; error: string }

const UNCLOSED_QUOTE_ERROR = 'Unclosed quote in command template.'

const SIMPLE_ESCAPES: Record<string, string> = {
  a: '\x07',
  b: '\b',
  e: '\x1b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '\\': '\\'
}

type EscapeDecode = { text: string; next: number; diverges: boolean }

function readRadix(value: string, start: number, pattern: RegExp): string {
  return pattern.exec(value.slice(start))?.[0] ?? ''
}

/** Decodes the escape whose backslash sits at `start - 1`. */
function decodeFishEscape(value: string, start: number): EscapeDecode {
  const char = value[start]
  const simple = SIMPLE_ESCAPES[char]
  if (simple !== undefined) {
    return { text: simple, next: start + 1, diverges: false }
  }
  const fromCode = (digits: string, radix: number, prefix: number): EscapeDecode => {
    const code = Number.parseInt(digits, radix)
    // Why: fish rejects an out-of-range escape outright, and a NUL truncates the
    // token; neither is something this tokenizer's value can represent.
    if (!Number.isFinite(code) || code === 0 || code > 0x10ffff) {
      return {
        text: value.slice(start, start + prefix + digits.length),
        next: start + prefix + digits.length,
        diverges: true
      }
    }
    return {
      text: String.fromCodePoint(code),
      next: start + prefix + digits.length,
      diverges: false
    }
  }
  if (char === 'x' || char === 'X') {
    const digits = readRadix(value, start + 1, /^[0-9a-fA-F]{1,2}/)
    return digits ? fromCode(digits, 16, 1) : { text: char, next: start + 1, diverges: false }
  }
  if (char === 'u' || char === 'U') {
    const digits = readRadix(
      value,
      start + 1,
      char === 'u' ? /^[0-9a-fA-F]{1,4}/ : /^[0-9a-fA-F]{1,8}/
    )
    return digits ? fromCode(digits, 16, 1) : { text: char, next: start + 1, diverges: false }
  }
  if (char >= '0' && char <= '7') {
    const digits = readRadix(value, start, /^[0-7]{1,3}/)
    // fish caps an octal escape at one byte and errors above it.
    return Number.parseInt(digits, 8) > 0xff
      ? {
          text: value.slice(start, start + digits.length),
          next: start + digits.length,
          diverges: true
        }
      : fromCode(digits, 8, 0)
  }
  if (char === 'c' && value[start + 1]) {
    return {
      text: String.fromCharCode(value.charCodeAt(start + 1) & 0x1f),
      next: start + 2,
      diverges: false
    }
  }
  return { text: char, next: start + 1, diverges: false }
}

export function tokenizeFishStartupCommand(value: string): FishStartupCommandTokens {
  const tokens: string[] = []
  const spans: CommandTokenSpan[] = []
  let token = ''
  let tokenStart = 0
  let started = false
  let diverges = false
  let index = 0

  const begin = (at: number): void => {
    if (!started) {
      tokenStart = at
    }
    started = true
  }

  while (index < value.length) {
    const char = value[index]

    if (char === "'") {
      begin(index)
      index += 1
      let closed = false
      while (index < value.length) {
        const inner = value[index]
        if (inner === '\\' && (value[index + 1] === '\\' || value[index + 1] === "'")) {
          token += value[index + 1]
          index += 2
          continue
        }
        if (inner === "'") {
          closed = true
          index += 1
          break
        }
        token += inner
        index += 1
      }
      if (!closed) {
        return { ok: false, error: UNCLOSED_QUOTE_ERROR }
      }
      continue
    }

    if (char === '"') {
      begin(index)
      index += 1
      let closed = false
      while (index < value.length) {
        const inner = value[index]
        if (inner === '\\') {
          const next = value[index + 1]
          if (next === '\\' || next === '$' || next === '"') {
            token += next
            index += 2
            continue
          }
          if (next === '\n') {
            // A continuation joins words the caller's span splice cannot model.
            diverges = true
            index += 2
            continue
          }
          if (next === undefined) {
            break
          }
          token += inner
          index += 1
          continue
        }
        if (inner === '"') {
          closed = true
          index += 1
          break
        }
        // Why: `$(…)` and `${…}` reopen a nested parsing context this loop does not model.
        diverges ||= inner === '$' && '({'.includes(value[index + 1] ?? '\0')
        token += inner
        index += 1
      }
      if (!closed) {
        return { ok: false, error: UNCLOSED_QUOTE_ERROR }
      }
      continue
    }

    if (char === '\\') {
      const next = value[index + 1]
      if (next === undefined) {
        // A trailing backslash swallows whatever a consumer appends after the base.
        diverges = true
        begin(index)
        token += char
        index += 1
        continue
      }
      if (next === '\n') {
        diverges = true
        begin(index)
        index += 2
        continue
      }
      begin(index)
      const decoded = decodeFishEscape(value, index + 1)
      diverges ||= decoded.diverges
      token += decoded.text
      index = decoded.next
      continue
    }

    if (/\s/.test(char)) {
      if (started) {
        tokens.push(token)
        spans.push({
          start: tokenStart,
          end: index,
          divergesFromShell: diverges
        })
        token = ''
        started = false
        diverges = false
      }
      index += 1
      continue
    }

    const atTokenStart = !started
    begin(index)
    diverges ||=
      ';&|<>'.includes(char) ||
      // Command substitution `(…)`/`$(…)` and brace expansion, all live fish syntax.
      '(){}'.includes(char) ||
      // An unmatched wildcard is a HARD ERROR in fish, and a matched one splits the word.
      '*?['.includes(char) ||
      (char === '#' && atTokenStart) ||
      (char === '$' && '({'.includes(value[index + 1] ?? '\0'))
    token += char
    index += 1
  }

  if (started) {
    tokens.push(token)
    spans.push({
      start: tokenStart,
      end: value.length,
      divergesFromShell: diverges
    })
  }
  return { ok: true, tokens, spans }
}
