import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { PaneForegroundAgentEntry } from '../../store/slices/pane-foreground-agent'

/**
 * Why: xterm brackets a paste only after its own parser saw DECSET 2004, but Windows
 * ConPTY never forwards it and that ConPTY can be on a remote host — so the client's
 * platform proves nothing about the PTY. Unbracketed, xterm rewrites the paste's
 * newlines to CR and the agent submits whatever draft was parked in its composer.
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
  // Why: a process-table confirmed agent is the strongest evidence there is.
  if (isTuiAgent(paneForegroundAgentByPaneKey[paneKey]?.agent)) {
    return true
  }
  const entry = agentStatusByPaneKey[paneKey]
  // Why: a row rehydrated from disk across a restart describes the previous process,
  // not the shell now attached to this pane.
  if (entry?.restoredUnconfirmed === true) {
    return false
  }
  // Why NOT vetoed on shellForeground: that flag is republished only at OSC 133
  // boundaries, so a shell without 133 integration leaves it latched true while an
  // agent owns the foreground. Vetoing on it silently reinstates the submit bug —
  // measured live. An idle agent also sits at `done` past the 30-minute freshness
  // TTL, so neither state nor TTL can gate this either. Erring toward bracketing
  // costs a literal ESC[200~ in a non-2004 program; erring the other way sends the
  // user's parked draft.
  return isTuiAgent(entry?.agentType)
}
