import type { AgentHookInstallStatus } from '../../shared/agent-hook-types'
import type { HookInstallAgent } from '../../shared/telemetry-events'
import { ampHookService } from '../amp/hook-service'
import { antigravityHookService } from '../antigravity/hook-service'
import { claudeHookService } from '../claude/hook-service'
import { codexHookService } from '../codex/hook-service'
import { commandCodeHookService } from '../command-code/hook-service'
import { copilotHookService } from '../copilot/hook-service'
import { cursorHookService } from '../cursor/hook-service'
import { devinHookService } from '../devin/hook-service'
import { droidHookService } from '../droid/hook-service'
import { geminiHookService } from '../gemini/hook-service'
import { grokHookService } from '../grok/hook-service'
import { hermesHookService } from '../hermes/hook-service'
import { kimiHookService } from '../kimi/hook-service'
import { openClaudeHookService } from '../openclaude/hook-service'

// Why: awaited by every caller, but stays sync-tolerant — Codex's install still
// runs sync because its trust/TOML layer has no async twin yet.
export type ManagedAgentHookAction = readonly [
  HookInstallAgent,
  () => AgentHookInstallStatus | Promise<AgentHookInstallStatus>
]

export type ManagedAgentHookInstaller = ManagedAgentHookAction
export type ManagedAgentHookRemover = ManagedAgentHookAction
export type ManagedAgentHookStatusReader = ManagedAgentHookAction

export const MANAGED_AGENT_HOOK_INSTALLERS: readonly ManagedAgentHookInstaller[] = [
  ['claude', () => claudeHookService.installAsync()],
  ['openclaude', () => openClaudeHookService.installAsync()],
  ['codex', () => codexHookService.install()],
  ['gemini', () => geminiHookService.installAsync()],
  ['antigravity', () => antigravityHookService.installAsync()],
  ['amp', () => ampHookService.install()],
  ['cursor', () => cursorHookService.installAsync()],
  ['droid', () => droidHookService.installAsync()],
  ['command-code', () => commandCodeHookService.installAsync()],
  ['grok', () => grokHookService.installAsync()],
  ['copilot', () => copilotHookService.installAsync()],
  ['hermes', () => hermesHookService.install()],
  ['devin', () => devinHookService.install()],
  ['kimi', () => kimiHookService.install()]
]

export const MANAGED_AGENT_HOOK_REMOVERS: readonly ManagedAgentHookRemover[] = [
  ['claude', () => claudeHookService.removeAsync()],
  ['openclaude', () => openClaudeHookService.removeAsync()],
  ['codex', () => codexHookService.remove()],
  ['gemini', () => geminiHookService.removeAsync()],
  ['antigravity', () => antigravityHookService.removeAsync()],
  ['amp', () => ampHookService.remove()],
  ['cursor', () => cursorHookService.removeAsync()],
  ['droid', () => droidHookService.removeAsync()],
  ['command-code', () => commandCodeHookService.removeAsync()],
  ['grok', () => grokHookService.removeAsync()],
  ['copilot', () => copilotHookService.removeAsync()],
  ['hermes', () => hermesHookService.remove()],
  ['devin', () => devinHookService.remove()],
  ['kimi', () => kimiHookService.remove()]
]

export const MANAGED_AGENT_HOOK_STATUS_READERS: readonly ManagedAgentHookStatusReader[] = [
  ['claude', () => claudeHookService.getStatusAsync()],
  ['openclaude', () => openClaudeHookService.getStatusAsync()],
  ['codex', () => codexHookService.getStatus()],
  ['gemini', () => geminiHookService.getStatusAsync()],
  ['antigravity', () => antigravityHookService.getStatusAsync()],
  ['amp', () => ampHookService.getStatus()],
  ['cursor', () => cursorHookService.getStatusAsync()],
  ['droid', () => droidHookService.getStatusAsync()],
  ['grok', () => grokHookService.getStatusAsync()],
  ['command-code', () => commandCodeHookService.getStatusAsync()],
  ['copilot', () => copilotHookService.getStatusAsync()],
  ['hermes', () => hermesHookService.getStatus()],
  ['devin', () => devinHookService.getStatus()],
  ['kimi', () => kimiHookService.getStatus()]
]
