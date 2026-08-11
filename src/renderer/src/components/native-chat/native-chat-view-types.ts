import type { TuiAgent } from '../../../../shared/types'
import type { AgentType } from '../../../../shared/agent-status-types'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import type { NativeChatContextMenuActions } from './use-native-chat-context-menu'

export type NativeChatBridgeViewProps = {
  mode?: 'bridge'
  /** The terminal tab hosting the agent. paneKey is `${tabId}:${leafId}`. */
  terminalTabId: string
  /** Specific split leaf this chat surface replaces. */
  paneKey?: string
  /** PTY bound to `paneKey`, used for composer and interactive-card sends. */
  targetPtyId?: string | null
  /** Launch-time agent hint from the TerminalTab, when Orca started one. */
  launchAgent?: TuiAgent | null
  /** Trusted title/foreground fallback for manually-started agents. */
  resolvedAgent?: TuiAgent | null
  /** Return this pane to the hosted terminal surface. */
  onSwitchToTerminal?: () => void
  /** Current xterm screen reader used to recover agent-reported session state. */
  readTerminalScreen?: () => string | null
  contextMenuActions?: Omit<NativeChatContextMenuActions, 'onPaste'>
}

export type NativeChatStructuredViewProps = {
  mode: 'structured'
  tabId: string
  sessionId: string
  target: RuntimeClientTarget
  agent: AgentType
  allowFileUriLinks: boolean
}

export type NativeChatViewProps = NativeChatBridgeViewProps | NativeChatStructuredViewProps
