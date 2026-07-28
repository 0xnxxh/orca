import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { parseAskFromStatus } from './mobile-native-chat-ask'
import type { detectAgentPermission } from './mobile-native-chat-permission'
import type { parseAgentQuestion } from './mobile-native-chat-question'
import type { HostSessionNativeChatTarget } from './host-session-native-chat-operations'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import type { MobileNativeChatAnswerSend } from './use-mobile-native-chat-answer-send'
import type { MobileNativeChatPendingMessage } from './use-mobile-native-chat-pending-deliveries'
import type { useMobileNativeChatSession } from './use-mobile-native-chat-session'

export type MobileNativeChatController = {
  isTabChatView: (tabId: string) => boolean
  toggleTabChatView: (tabId: string) => void
  showNativeChat: boolean
  showNativeChatRef: MutableRefObject<boolean>
  nativeChatAgent: string | null
  chatComposerText: string
  setChatComposerText: Dispatch<SetStateAction<string>>
  chatPending: MobileNativeChatPendingMessage[]
  nativeChatSession: ReturnType<typeof useMobileNativeChatSession>
  nativeChatAgentWorking: boolean
  nativeChatTargetRef: MutableRefObject<HostSessionNativeChatTarget | null>
  nativeChatStreamingText?: string
  nativeChatPermission: ReturnType<typeof detectAgentPermission>
  nativeChatQuestion: ReturnType<typeof parseAgentQuestion>
  nativeChatAsk: ReturnType<typeof parseAskFromStatus>
  handleNativeChatOpenFile: (relativePath: string) => void
  handleNativeChatAnswerAsk: MobileNativeChatAnswerSend['answerAsk']
  handleNativeChatCancelAsk: () => Promise<boolean>
  handleNativeChatRespondPermission: (text: string) => Promise<boolean>
  handleNativeChatStop: () => void
  nativeChatFilePaths: string[]
  loadNativeChatFiles: (query: string) => void
  handleNativeChatQuestionAnswer: (text: string) => Promise<boolean>
  handleNativeChatSend: (text: string, images?: string[]) => Promise<boolean>
  handleNativeChatSendWithOutcome: (
    text: string,
    images?: string[],
    deadline?: number
  ) => Promise<MobileNativeChatSendOutcome>
}
