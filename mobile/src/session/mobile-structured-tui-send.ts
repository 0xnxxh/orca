import { isSlashCommandDraft } from '../../../src/shared/native-chat-slash-commands'
import type { AgentSessionHandoffStatus } from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import {
  MOBILE_NATIVE_CHAT_IMAGE_SETTLE_MS,
  pasteMobileNativeChatImagePaths
} from './mobile-native-chat-image-send'
import {
  openMobileNativeChatSendBudget,
  sendMobileNativeChatMessageWithOutcome,
  typeMobileNativeChatCommandWithOutcome,
  type MobileNativeChatSendOutcome
} from './mobile-native-chat-send'
import { classifyMobileNativeChatSend } from './mobile-native-chat-send-classification'
import {
  clearMobileNativeChatInputStale,
  healMobileNativeChatStaleInput,
  markMobileNativeChatInputStale
} from './mobile-native-chat-stale-input'
import {
  acquireMobileNativeChatTerminalWrite,
  releaseMobileNativeChatTerminalWrite
} from './mobile-native-chat-terminal-write-lock'

type MobileStructuredTuiSendArgs = {
  client: RpcClient
  terminal: string
  deviceToken: string | null
  text: string
  attachments: readonly PendingNativeChatImage[]
  sleep?: (ms: number) => Promise<void>
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export function getMobileStructuredTuiTerminal(
  handoff: AgentSessionHandoffStatus | null
): string | null {
  return handoff?.owner === 'tui' && handoff.phase === 'idle'
    ? (handoff.terminal?.handle ?? null)
    : null
}

/** Sends the structured transcript composer through its proven TUI owner. */
export async function sendMobileStructuredTuiMessage(
  args: MobileStructuredTuiSendArgs
): Promise<MobileNativeChatSendOutcome> {
  if (!acquireMobileNativeChatTerminalWrite(args.terminal)) {
    return 'rejected'
  }
  try {
    const deadline = openMobileNativeChatSendBudget()
    const mobileClient = args.deviceToken
      ? { id: args.deviceToken, type: 'mobile' as const }
      : undefined
    if (
      !(await healMobileNativeChatStaleInput({
        client: args.client,
        terminal: args.terminal,
        deviceToken: args.deviceToken,
        deadline
      }))
    ) {
      return 'rejected'
    }
    if (args.attachments.length > 0) {
      const pasted = await pasteMobileNativeChatImagePaths({
        client: args.client,
        terminal: args.terminal,
        deviceToken: args.deviceToken,
        imagePaths: args.attachments.map((attachment) => attachment.path),
        deadline
      })
      if (!pasted) {
        markMobileNativeChatInputStale(args.terminal)
        return 'rejected'
      }
      clearMobileNativeChatInputStale(args.terminal)
      await (args.sleep ?? wait)(MOBILE_NATIVE_CHAT_IMAGE_SETTLE_MS)
    }
    const textDeadline =
      args.attachments.length > 0 ? deadline + MOBILE_NATIVE_CHAT_IMAGE_SETTLE_MS : deadline
    const classification = classifyMobileNativeChatSend('codex', args.text)
    const outcome =
      classification !== 'chat' && isSlashCommandDraft(args.text) && args.attachments.length === 0
        ? await typeMobileNativeChatCommandWithOutcome({
            client: args.client,
            terminal: args.terminal,
            command: args.text,
            ...(mobileClient ? { mobileClient } : {}),
            deadline: textDeadline
          })
        : await sendMobileNativeChatMessageWithOutcome({
            client: args.client,
            terminal: args.terminal,
            text: args.text,
            clearInputFirst: args.attachments.length === 0,
            ...(mobileClient ? { mobileClient } : {}),
            deadline: textDeadline
          })
    if (args.attachments.length > 0 && outcome !== 'accepted') {
      markMobileNativeChatInputStale(args.terminal)
    }
    return outcome
  } catch {
    if (args.attachments.length > 0) {
      markMobileNativeChatInputStale(args.terminal)
    }
    return 'rejected'
  } finally {
    releaseMobileNativeChatTerminalWrite(args.terminal)
  }
}
