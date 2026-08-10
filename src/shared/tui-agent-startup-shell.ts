import { tokenizeCustomCommandTemplate, type CommandTokenSpan } from './commit-message-prompt'

export type AgentStartupShell = 'posix' | 'powershell' | 'cmd'

export type StartupCommandTokens =
  | { ok: true; tokens: string[]; spans: CommandTokenSpan[] }
  | { ok: false; error: string }

function tokenizeWindowsStartupCommand(
  value: string,
  shell: Exclude<AgentStartupShell, 'posix'>
): StartupCommandTokens {
  const tokens: string[] = []
  const spans: CommandTokenSpan[] = []
  let token = ''
  let tokenStart = 0
  let divergesFromShell = false
  let quote: "'" | '"' | null = null
  let tokenStarted = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    const escape = shell === 'cmd' ? '^' : '`'
    if (char === escape && index + 1 < value.length) {
      token += value[index + 1]
      if (!tokenStarted) {
        tokenStart = index
      }
      tokenStarted = true
      index += 1
      continue
    }
    if (quote) {
      // Why: see the posix tokenizer — a `"` inside $(…) re-opens a nested
      // quoting context that this tokenizer does not model.
      divergesFromShell ||=
        shell === 'powershell' &&
        quote === '"' &&
        char === '$' &&
        (value[index + 1] === '(' || value[index + 1] === '{')
      if (char === quote) {
        if (shell === 'powershell' && quote === "'" && value[index + 1] === "'") {
          token += "'"
          index += 1
        } else {
          quote = null
        }
      } else {
        token += char
      }
      tokenStarted = true
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      // Why: cmd.exe has no single-quote syntax, so this tokenizer's grouping
      // of a single-quoted region diverges from what cmd actually parses;
      // flag the token so consumers treat it as unmodelable.
      divergesFromShell ||= shell === 'cmd' && char === "'"
      if (!tokenStarted) {
        tokenStart = index
      }
      tokenStarted = true
    } else if (/\s/.test(char)) {
      if (tokenStarted) {
        tokens.push(token)
        spans.push({ start: tokenStart, end: index, divergesFromShell })
        token = ''
        tokenStarted = false
        divergesFromShell = false
      }
    } else {
      if (!tokenStarted) {
        tokenStart = index
      }
      divergesFromShell ||=
        ';&|<>'.includes(char) ||
        (shell === 'powershell' &&
          ((char === '#' && !tokenStarted) ||
            (char === '$' && (value[index + 1] === '(' || value[index + 1] === '{'))))
      token += char
      tokenStarted = true
    }
  }
  if (quote) {
    return { ok: false, error: 'Unclosed quote in command template.' }
  }
  if (tokenStarted) {
    tokens.push(token)
    spans.push({ start: tokenStart, end: value.length, divergesFromShell })
  }
  return { ok: true, tokens, spans }
}

export function tokenizeStartupCommand(
  value: string,
  shell: AgentStartupShell
): StartupCommandTokens {
  return shell === 'posix'
    ? tokenizeCustomCommandTemplate(value)
    : tokenizeWindowsStartupCommand(value, shell)
}

export function resolveStartupShell(
  platform: NodeJS.Platform,
  shell?: AgentStartupShell
): AgentStartupShell {
  return shell ?? (platform === 'win32' ? 'powershell' : 'posix')
}

export function quoteStartupArg(value: string, shell: AgentStartupShell): string {
  if (shell === 'powershell') {
    return `'${value.replace(/'/g, "''")}'`
  }
  if (shell === 'cmd') {
    return `"${value.replace(/([\^&|<>()%!"])/g, '^$1')}"`
  }
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildShellCommandFromArgv(
  args: readonly string[],
  shell: AgentStartupShell
): string {
  const command = args.map((arg) => quoteStartupArg(arg, shell)).join(' ')
  if (shell === 'powershell' && command) {
    return `& ${command}`
  }
  return command
}

export function clearEnvCommand(name: string, shell: AgentStartupShell): string {
  if (shell === 'powershell') {
    return `Remove-Item Env:${name} -ErrorAction SilentlyContinue`
  }
  if (shell === 'cmd') {
    return `set "${name}="`
  }
  return `unset ${name}`
}

export function commandSeparator(shell: AgentStartupShell): string {
  return shell === 'cmd' ? ' & ' : '; '
}

export type AgentCliArgsPlan = { ok: true; suffix: string } | { ok: false; error: string }

export function planAgentCliArgsSuffix(
  agentArgs: string | null | undefined,
  shell: AgentStartupShell
): AgentCliArgsPlan {
  const trimmed = agentArgs?.trim()
  if (!trimmed) {
    return { ok: true, suffix: '' }
  }
  const tokenized = tokenizeStartupCommand(trimmed, shell)
  if (!tokenized.ok) {
    return { ok: false, error: `CLI arguments are invalid: ${tokenized.error}` }
  }
  return {
    ok: true,
    suffix: tokenized.tokens.map((token) => quoteStartupArg(token, shell)).join(' ')
  }
}
