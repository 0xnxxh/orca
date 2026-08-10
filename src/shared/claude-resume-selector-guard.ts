import type { ResumableTuiAgent } from './agent-session-resume'
import {
  quoteStartupArg,
  tokenizeStartupCommand,
  type AgentStartupShell
} from './tui-agent-startup-shell'

/** Claude options that always consume the following token as their value, so a
 * dash-leading value (`--model -mine`) is never mistaken for a resume selector. */
const CLAUDE_VALUE_OPTIONS = new Set([
  '--add-dir',
  '--agents',
  '--allowed-tools',
  '--allowedTools',
  '--append-system-prompt',
  '--config',
  '--disallowed-tools',
  '--disallowedTools',
  '--fallback-model',
  '--input-format',
  '--max-turns',
  '--mcp-config',
  '--model',
  '--output-format',
  '--permission-mode',
  '--permission-prompt-tool',
  '--session-id',
  '--settings',
  '--system-prompt'
])

function isResumeSelector(token: string): boolean {
  if (token === '--resume' || token.startsWith('--resume=')) {
    return true
  }
  if (token === '--continue' || token.startsWith('--continue=')) {
    return true
  }
  if (token.startsWith('--')) {
    return false
  }
  if (token === '-c' || token.startsWith('-c=')) {
    return true
  }
  // -r, -r=<id>, and the joined -r<id> form all select a session.
  return token.startsWith('-r')
}

function isClaudeExecutableToken(token: string): boolean {
  const base = token.split(/[\\/]/).pop() ?? ''
  return /^claude(\.(exe|cmd|bat|ps1))?$/i.test(base)
}

/** Joins the resolved base command with the agent's resume argv. Claude goes
 * through the selector guard below; other agents keep plain appending. */
export function buildAgentResumeLaunchCommand(
  agent: ResumableTuiAgent,
  baseCommand: string,
  resumeArgv: readonly string[],
  shell: AgentStartupShell
): string {
  const argv = resumeArgv.slice(1)
  if (agent === 'claude') {
    return buildClaudeResumeLaunchCommand(baseCommand, argv, shell)
  }
  const resumeArgs = argv.map((arg) => quoteStartupArg(arg, shell)).join(' ')
  return resumeArgs ? `${baseCommand} ${resumeArgs}` : baseCommand
}

/** Builds the Claude cold-restore launch command: strips any resume/continue
 * selector the user's persisted command carries and appends exactly one
 * authoritative selector, so a stale or bare selector can never compete with
 * the provider session id (#12982).
 *
 * Fails open by design: when the base command cannot be tokenized, or no
 * claude executable token can be located (wrapper commands like
 * `bash -c claude`), the base is left byte-for-byte untouched and the
 * selector is appended, which is the pre-guard behavior. Bytes outside
 * removed selector tokens are always preserved verbatim — the base is
 * spliced by source span, never re-quoted. */
export function buildClaudeResumeLaunchCommand(
  baseCommand: string,
  resumeArgv: readonly string[],
  shell: AgentStartupShell
): string {
  const quotedResume = resumeArgv.map((arg) => quoteStartupArg(arg, shell)).join(' ')
  if (!quotedResume) {
    return baseCommand
  }
  const appended = `${baseCommand} ${quotedResume}`
  const tokenized = tokenizeStartupCommand(baseCommand, shell)
  if (!tokenized.ok) {
    return appended
  }
  const { tokens, spans } = tokenized
  const claudeIndex = tokens.findIndex(isClaudeExecutableToken)
  if (claudeIndex === -1) {
    return appended
  }
  const cuts: { start: number; end: number }[] = []
  let terminatorStart: number | null = null
  for (let i = claudeIndex + 1; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token === '--') {
      // Why: claude is the executable here, so `--` is claude's own
      // terminator; the selector must stay in option position before it.
      terminatorStart = spans[i].start
      break
    }
    if (isResumeSelector(token)) {
      const selectorStart = spans[i].start
      let end = spans[i].end
      const next = tokens[i + 1]
      if ((token === '--resume' || token === '-r') && next !== undefined && !next.startsWith('-')) {
        // A stale session locator rides along with its selector.
        end = spans[i + 1].end
        i += 1
      }
      cuts.push({ start: selectorStart, end })
      continue
    }
    if (CLAUDE_VALUE_OPTIONS.has(token)) {
      i += 1
      continue
    }
    if (token.startsWith('-') && tokens[i + 1] !== undefined && !tokens[i + 1].startsWith('-')) {
      // Unknown option: assume it consumes a non-dash value so that value is
      // never inspected as a selector.
      i += 1
    }
  }
  if (cuts.length === 0 && terminatorStart === null) {
    return appended
  }
  let result = baseCommand
  if (terminatorStart !== null) {
    result = `${result.slice(0, terminatorStart)}${quotedResume} ${result.slice(terminatorStart)}`
  }
  for (let i = cuts.length - 1; i >= 0; i -= 1) {
    let { start } = cuts[i]
    while (start > 0 && (result[start - 1] === ' ' || result[start - 1] === '\t')) {
      start -= 1
    }
    result = `${result.slice(0, start)}${result.slice(cuts[i].end)}`
  }
  return terminatorStart !== null ? result : `${result} ${quotedResume}`
}
