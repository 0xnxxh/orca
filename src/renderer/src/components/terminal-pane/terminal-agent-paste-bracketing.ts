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
 * Why keyed on the pane's agent and not on the mode bit itself: "we never observed
 * DECSET 2004" is not usable evidence. Measured in real ptys — zsh 5.9, fish 4.8.1 and
 * bash >= 5.1 emit `?2004h` at the prompt and `?2004l` just before exec, but macOS
 * /bin/bash 3.2, /bin/sh, bash 4.4, and any shell with bracketed paste turned off in
 * .inputrc/zle emit *nothing at all*. A deliberate opt-out is byte-identical to a bare
 * `cat`. So silence cannot be read as "nobody has an opinion".
 *
 * Agent identity is the only signal that disambiguates it: a TUI agent always enables
 * bracketed paste, so on an agent pane silence can only mean the announcement was lost
 * in transit (ConPTY, replay) — never an opt-out. Keep this narrow for that reason.
 * Bracketing a program that never negotiated is measurably worse than useless: the
 * markers arrive as literal payload bytes and ICRNL still turns the CR into a submit.
 *
 * Why this diverges from terminal-ctrl-enter / terminal-windows-shift-enter, which veto
 * on shellForeground/routingRevoked and require routingTrusted: those resolvers decide
 * where to ROUTE input bytes, so a forged identity misdelivers keystrokes. This one only
 * decides whether to WRAP a paste, and the payload is ESC-sanitized downstream, so the
 * worst a forged identity buys is a literal ESC[200~ printed at a program. Do not
 * "align" this with those gates — measured live, that reinstates the submit bug.
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
  let paneKey: string
  try {
    paneKey = makePaneKey(tabId, leafId)
  } catch {
    // Why: unreachable today (pane.leafId is a minted UUID), but a legacy/malformed
    // layout must degrade to the pre-fix path, not throw out of the paste handler --
    // the throw would escape before pasteTerminalClipboard's catch is attached and
    // the paste would be a silent no-op with no error surface.
    return false
  }
  // Why: a process-table confirmed agent is the strongest evidence there is.
  // Note this branch is dead for remote-runtime and SSH panes: isForegroundTrackingAllowed
  // (pty-connection) returns false for them, so paneForegroundAgentByPaneKey stays empty
  // and the status row below is the only evidence a remote pane ever has.
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
