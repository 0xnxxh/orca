import { AgentBrowserBridge } from '../browser/agent-browser-bridge'
import type { BrowserManager } from '../browser/browser-manager'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

type AgentBrowserStartupRuntime = Pick<
  OrcaRuntimeService,
  'notifyMobileSessionTabsChanged' | 'setAgentBrowserBridge'
>

export function attachAgentBrowserStartupCapability(
  runtime: AgentBrowserStartupRuntime,
  browserManager: BrowserManager
): AgentBrowserBridge {
  const bridge = new AgentBrowserBridge(browserManager, {
    onTabsChanged: (worktreeId) => runtime.notifyMobileSessionTabsChanged(worktreeId)
  })
  runtime.setAgentBrowserBridge(bridge)
  return bridge
}
