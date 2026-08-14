import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { PaneForegroundAgentEntry } from '../../store/slices/pane-foreground-agent'

/**
 * Why: xterm brackets a paste only after its own parser saw DECSET 2004, but Windows
 * ConPTY never forwards it and that ConPTY can be on a remote host — so the client's
 * platform proves nothing about the PTY. Unbracketed, xterm rewrites the paste's
 * newlines to CR and the agent submits whatever draft was parked in its composer.
 *
 * An agent row is retained on purpose (an idle agent sits at `done`), so neither the
 * 30-minute freshness TTL nor `state !== 'done'` can gate this — both would strip
 * bracketing from a live but quiet agent. Only evidence that the pane is *no longer*
 * the agent's vetoes it.
 */
export function shouldForceBracketedMultilinePasteForPane({
  isWindowsClient,
  agentStatusByPaneKey,
  paneForegroundAgentByPaneKey,
  tabId,
  leafId
}: {
  isWindowsClient: boolean
  agentStatusByPaneKey: Record<string, AgentStatusEntry>
  paneForegroundAgentByPaneKey: Record<string, PaneForegroundAgentEntry>
  tabId: string
  leafId: string
}): boolean {
  if (isWindowsClient) {
    return true
  }
  const paneKey = makePaneKey(tabId, leafId)
  // Why: OSC 133;D proved the foreground is back at the shell — process-grade evidence
  // that outranks an agent row nothing has cleared yet.
  if (paneForegroundAgentByPaneKey[paneKey]?.shellForeground === true) {
    return false
  }
  const entry = agentStatusByPaneKey[paneKey]
  // Why: a row rehydrated from disk across a restart describes the previous process,
  // not the shell now attached to this pane.
  if (entry?.restoredUnconfirmed === true) {
    return false
  }
  return isTuiAgent(entry?.agentType)
}
