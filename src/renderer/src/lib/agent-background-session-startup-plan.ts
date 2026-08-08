import type { useAppStore } from '@/store'
import { buildAgentStartupPlan, type AgentStartupPlan } from '@/lib/tui-agent-startup'
import type { AgentBackgroundLaunchHost } from '@/lib/agent-background-session-launch-host'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../shared/tui-agent-launch-defaults'
import { TUI_AGENT_CONFIG } from '../../../shared/tui-agent-config'
import { resolveLocalWindowsAgentStartupShell } from '../../../shared/windows-terminal-shell'
import type { TuiAgent } from '../../../shared/types'

type LaunchStore = ReturnType<typeof useAppStore.getState>

export type AgentBackgroundSessionStartupPlan = {
  startupPlan: AgentStartupPlan
  trimmedPrompt: string
  hasPrompt: boolean
  isFollowupPath: boolean
  pasteDraftAfterLaunch: string | null
}

export async function prepareAgentBackgroundSessionStartup(args: {
  store: LaunchStore
  agent: TuiAgent
  worktreePath: string | undefined
  launchHost: AgentBackgroundLaunchHost
  prompt?: string
}): Promise<AgentBackgroundSessionStartupPlan | null> {
  const { store, agent, worktreePath, launchHost, prompt } = args
  const cmdOverrides = store.settings?.agentCmdOverrides ?? {}
  const agentArgs = resolveTuiAgentLaunchArgs(agent, store.settings?.agentDefaultArgs)
  const agentEnv = resolveTuiAgentLaunchEnv(agent, store.settings?.agentDefaultEnv)
  const preflight = TUI_AGENT_CONFIG[agent].preflightTrust
  if (preflight && worktreePath && window.api.agentTrust?.markTrusted) {
    try {
      await window.api.agentTrust.markTrusted({
        preset: preflight,
        workspacePath: worktreePath,
        ...(launchHost.connectionId ? { connectionId: launchHost.connectionId } : {})
      })
    } catch {
      // Best-effort: the user can still accept the trust prompt.
    }
  }
  const { platform, isRemote } = launchHost
  const startupShell = resolveLocalWindowsAgentStartupShell({
    platform,
    isRemote,
    terminalWindowsShell: store.settings?.terminalWindowsShell
  })
  const trimmedPrompt = prompt?.trim() ?? ''
  const hasPrompt = trimmedPrompt.length > 0
  const isFollowupPath = TUI_AGENT_CONFIG[agent].promptInjectionMode === 'stdin-after-start'
  const pasteDraftAfterLaunch = hasPrompt && isFollowupPath ? trimmedPrompt : null
  const startupPlan = buildAgentStartupPlan({
    agent,
    prompt: hasPrompt && !isFollowupPath ? trimmedPrompt : '',
    cmdOverrides,
    agentArgs,
    agentEnv,
    platform,
    shell: startupShell,
    isRemote,
    allowEmptyPromptLaunch: !hasPrompt || isFollowupPath
  })
  if (!startupPlan) {
    return null
  }
  return { startupPlan, trimmedPrompt, hasPrompt, isFollowupPath, pasteDraftAfterLaunch }
}
