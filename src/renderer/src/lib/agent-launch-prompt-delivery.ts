import { agentDeliversDraftViaNativePrefill } from '@/lib/agent-native-draft-prefill'
import { pasteDraftWhenAgentReady } from '@/lib/agent-paste-draft'
import { isNativeChatSupportedAgent } from '@/lib/native-chat-supported-agent'
import { useAppStore } from '@/store'
import type { TuiAgent } from '../../../shared/types'

/** Seed the chat-composer copy of launch context that reaches only the TUI
 *  input (argv prefill or startup paste). No-op for empty text or agents
 *  without a native-chat renderer. */
export function seedNativeChatLaunchDraftForAgentTab(args: {
  tabId: string
  agent: TuiAgent
  text: string
}): void {
  // Multi-line drafts are safe because chat clears every parked line before send.
  if (args.text.trim().length === 0 || !isNativeChatSupportedAgent(args.agent)) {
    return
  }
  useAppStore.getState().seedNativeChatLaunchDraft({
    tabId: args.tabId,
    agent: args.agent,
    text: args.text,
    createdAt: Date.now()
  })
}

export function deliverLaunchPromptToAgentTab(args: {
  tabId: string
  agent: TuiAgent
  content: string
  submit: boolean
  forcePaste: boolean
  timeoutMs?: number
  onTimeout?: () => void
}): Promise<boolean> {
  const { tabId, agent, content, submit, forcePaste, timeoutMs, onTimeout } = args
  const shouldSeed =
    submit === true && content.trim().length > 0 && isNativeChatSupportedAgent(agent)

  if (shouldSeed) {
    useAppStore.getState().seedNativeChatLaunchPrompt({
      tabId,
      agent,
      text: content,
      createdAt: Date.now()
    })
  } else if (submit !== true) {
    // Why: an unsubmitted draft lives only in the TUI input buffer; seed the
    // chat-composer copy so the context isn't invisible in the GUI view.
    seedNativeChatLaunchDraftForAgentTab({ tabId, agent, text: content })
  }

  // Why: native-prefill agents (claude/openclaude etc.) get the prompt at launch,
  // so pasteDraftWhenAgentReady returns false without pasting. That is a successful
  // native delivery, not a failure — don't flag the seeded bubble in that case.
  const deliversViaNativePrefill = agentDeliversDraftViaNativePrefill(agent, forcePaste)

  return pasteDraftWhenAgentReady({
    tabId,
    content,
    agent,
    submit,
    forcePaste,
    timeoutMs,
    onTimeout
  }).then((delivered) => {
    if (shouldSeed && !delivered && !deliversViaNativePrefill) {
      useAppStore.getState().markNativeChatLaunchPromptFailed(tabId)
    }
    return delivered || deliversViaNativePrefill
  })
}
