import type {
  TerminalAgentQuickCommand,
  TerminalQuickCommand,
  TerminalQuickCommandAction,
  TerminalQuickCommandScope,
  TuiAgent
} from '../../../src/shared/types'
import {
  MOBILE_TUI_AGENT_LABELS,
  MOBILE_TUI_AGENT_LAUNCH_COMMANDS,
  mobileTuiAgentSupportsPromptCommand
} from '../tasks/mobile-tui-agents'

// Why: mobile mirrors the desktop terminal-quick-commands logic locally instead
// of runtime-importing src/shared (which pulls in tui-agent-config and breaks
// mobile Vitest transforms). Kept behaviourally identical; the server re-runs the
// canonical normalizeTerminalQuickCommands on write.

export const MAX_QUICK_COMMAND_LABEL_LENGTH = 80
export const MAX_QUICK_COMMAND_TERMINAL_TEXT_LENGTH = 4000
export const MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH = 6000
const MAX_QUICK_COMMAND_DISPLAY_PREVIEW_LENGTH = 240

export function getQuickCommandAction(command: TerminalQuickCommand): TerminalQuickCommandAction {
  return command.action === 'agent-prompt' ? 'agent-prompt' : 'terminal-command'
}

export function isAgentQuickCommand(
  command: TerminalQuickCommand
): command is TerminalAgentQuickCommand {
  return getQuickCommandAction(command) === 'agent-prompt'
}

export function getQuickCommandScope(command: TerminalQuickCommand): TerminalQuickCommandScope {
  const scope = command.scope
  if (scope && scope.type === 'repo' && typeof scope.repoId === 'string' && scope.repoId.trim()) {
    return { type: 'repo', repoId: scope.repoId }
  }
  return { type: 'global' }
}

export function quickCommandMatchesRepo(
  command: TerminalQuickCommand,
  repoId: string | null
): boolean {
  const scope = getQuickCommandScope(command)
  return scope.type === 'global' || (repoId !== null && scope.repoId === repoId)
}

export function getQuickCommandBody(command: TerminalQuickCommand): string {
  return isAgentQuickCommand(command) ? command.prompt : command.command
}

export function isQuickCommandComplete(command: TerminalQuickCommand): boolean {
  if (command.label.trim().length === 0) {
    return false
  }
  if (isAgentQuickCommand(command)) {
    return mobileTuiAgentSupportsPromptCommand(command.agent) && command.prompt.trim().length > 0
  }
  return command.command.trim().length > 0
}

export type MobileQuickCommandLaunch = {
  agent?: TuiAgent
  options: {
    agentPrompt?: string
    startupCommand?: string
    startupCommandDelivery?: 'shell-ready'
    initialPrompt?: string
    enter?: boolean
  }
}

export function buildMobileQuickCommandLaunch(
  command: TerminalQuickCommand
): MobileQuickCommandLaunch | null {
  if (isAgentQuickCommand(command)) {
    if (!command.prompt.trim() || !mobileTuiAgentSupportsPromptCommand(command.agent)) {
      return null
    }
    return { agent: command.agent, options: { agentPrompt: command.prompt } }
  }
  const body = command.command
  if (!body.trim()) {
    return null
  }
  return command.appendEnter === false
    ? { options: { initialPrompt: body, enter: false } }
    : {
        // Why: raw commands that resemble bare agent launches can otherwise
        // select the fast path and race slow native, WSL, or SSH shell startup.
        options: { startupCommand: body, startupCommandDelivery: 'shell-ready' }
      }
}

export function getQuickCommandAgentLabel(agent: TuiAgent): string {
  return MOBILE_TUI_AGENT_LABELS[agent] ?? agent
}

// The subtitle desktop shows under each quick command: agent prompts read
// "Codex: <prompt>", terminal commands show the raw command text.
export function getQuickCommandPreview(command: TerminalQuickCommand): string {
  if (isAgentQuickCommand(command)) {
    return `${getQuickCommandAgentLabel(command.agent)}: ${command.prompt}`
  }
  return command.command
}

export function getQuickCommandDisplayPreview(command: TerminalQuickCommand): string {
  const preview = getQuickCommandPreview(command)
  if (preview.length <= MAX_QUICK_COMMAND_DISPLAY_PREVIEW_LENGTH) {
    return preview
  }
  // Why: one-line rows should not send up to 6 KB each through native text
  // layout; full command bodies remain available to search, edit, and launch.
  return `${preview.slice(0, MAX_QUICK_COMMAND_DISPLAY_PREVIEW_LENGTH - 1)}…`
}

export function getQuickCommandAgentLaunchName(agent: TuiAgent): string {
  return MOBILE_TUI_AGENT_LAUNCH_COMMANDS[agent] ?? agent
}
