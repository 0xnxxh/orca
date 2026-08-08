import type { LaunchAgentBackgroundSessionArgs } from './agent-background-session-contract'

type AgentBackgroundSessionExitHandlerOptions = {
  isHandled: () => boolean
  markHandled: () => void
  unsubscribeExit: () => void
  unsubscribeData: () => void
  clearStartupDelivery: () => void
  getTabId: () => string | null
  clearTabPtyId: (tabId: string, ptyId: string) => void
  clearAgentLaunchConfig: () => void
  onExit: LaunchAgentBackgroundSessionArgs['onExit']
}

export function createAgentBackgroundSessionExitHandler(
  options: AgentBackgroundSessionExitHandlerOptions
): (ptyId: string, code: number) => void {
  return (ptyId, code) => {
    if (options.isHandled()) {
      return
    }
    options.markHandled()
    options.unsubscribeExit()
    options.unsubscribeData()
    options.clearStartupDelivery()
    const tabId = options.getTabId()
    if (tabId) {
      options.clearTabPtyId(tabId, ptyId)
    }
    options.clearAgentLaunchConfig()
    options.onExit?.(ptyId, code)
  }
}
