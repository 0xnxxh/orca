import { useAppStore } from '@/store'
import { seedNativeChatAppliedSessionOptions } from '@/components/native-chat/native-chat-session-option-cache'
import { seedNativeChatLaunchDraftForAgentTab } from '@/lib/agent-launch-prompt-delivery'
import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'

/**
 * Seed per-tab agent state (applied session options + the chat-composer copy of
 * draft launch context) once a created worktree's launch tab is known.
 */
export function seedAgentTabStateAfterWorktreeCreate(args: {
  request: Pick<WorktreeCreationRequest, 'agent' | 'startupPlan' | 'launchDraftPrompt'>
  worktreeId: string
  primaryTabId: string | null
  startupTerminalTabId: string | null | undefined
}): void {
  const { request, worktreeId, primaryTabId, startupTerminalTabId } = args
  if (!request.startupPlan || !request.agent) {
    return
  }
  // Why: on the backend-spawn path the tab was created by main and activation
  // reports no primaryTabId; the synced store tab is the launch tab.
  const worktreeTabs = useAppStore.getState().tabsByWorktree[worktreeId] ?? []
  const tabId =
    primaryTabId ??
    startupTerminalTabId ??
    worktreeTabs.find((tab) => tab.launchAgent === request.agent)?.id ??
    worktreeTabs[0]?.id
  if (!tabId) {
    return
  }
  seedNativeChatAppliedSessionOptions(tabId, request.agent, request.startupPlan.sessionOptions)
  // Why: draft launch context reaches only the TUI input; seed the
  // chat-composer copy so it isn't invisible in the chat view.
  if (request.launchDraftPrompt) {
    seedNativeChatLaunchDraftForAgentTab({
      tabId,
      agent: request.agent,
      text: request.launchDraftPrompt
    })
  }
}
