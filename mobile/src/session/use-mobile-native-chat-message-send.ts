import { useCallback, type MutableRefObject } from 'react'
import type {
  HostSessionNativeChatOperations,
  HostSessionNativeChatTarget
} from './host-session-native-chat-operations'
import {
  clearMobileNativeChatInput,
  openMobileNativeChatSendBudget,
  type MobileNativeChatSendOutcome
} from './mobile-native-chat-send'
import type { MobileNativeChatSendOrigin } from './use-mobile-native-chat-drafts'
import type { MobileNativeChatLaunchDraftSeed } from './use-mobile-native-chat-launch-draft-seed'
import { buildAgentTuiClearInputForText } from '../../../src/shared/agent-tui-input-clear'

export type MobileNativeChatMessageSend = {
  send: (text: string, images?: string[]) => Promise<boolean>
  /** Outcome-preserving variant: callers that pasted terminal input beforehand
   *  (image sends) must see 'unknown' to heal a possibly-orphaned paste. Such a
   *  caller passes its own `deadline` so the paste it already spent and this text
   *  body share one budget instead of holding the composer for two. */
  sendWithOutcome: (
    text: string,
    images?: string[],
    deadline?: number
  ) => Promise<MobileNativeChatSendOutcome>
  /** Answer to an agent question — never touches the composer draft. */
  answerQuestion: (text: string) => Promise<boolean>
  /** Session-option command dispatch (e.g. `/model sonnet`) — never touches the
   *  composer draft; callers need the outcome to track dispatched state. */
  dispatchCommand: (text: string) => Promise<MobileNativeChatSendOutcome>
}

export function useMobileNativeChatMessageSend(args: {
  operations: HostSessionNativeChatOperations | null
  enabled: boolean
  targetRef: MutableRefObject<HostSessionNativeChatTarget | null>
  captureSendOrigin: (text: string) => MobileNativeChatSendOrigin | null
  /** Launch-context text Orca parked on the agent's TUI input line, or null. Read
   *  at send time so the pre-clear can be sized to every line it occupies. */
  readSeededLaunchDraftSeed: () => MobileNativeChatLaunchDraftSeed | null
  clearDraftForSend: (origin: MobileNativeChatSendOrigin, text: string) => void
  restoreRejectedDraft: (origin: MobileNativeChatSendOrigin, text: string) => void
  acceptSend: (origin: MobileNativeChatSendOrigin, text: string, images?: string[]) => void
  holdUnconfirmedSend: (
    origin: MobileNativeChatSendOrigin,
    text: string,
    onUnconfirmed: () => void
  ) => void
  onSendError: (message: string) => void
}): MobileNativeChatMessageSend {
  const {
    operations,
    enabled,
    targetRef,
    captureSendOrigin,
    readSeededLaunchDraftSeed,
    clearDraftForSend,
    restoreRejectedDraft,
    acceptSend,
    holdUnconfirmedSend,
    onSendError
  } = args

  const sendMessage = useCallback(
    async (
      text: string,
      images: string[] | undefined,
      syncComposer: boolean,
      recordControlSend: boolean,
      sharedDeadline?: number
    ): Promise<MobileNativeChatSendOutcome> => {
      const target = targetRef.current
      const origin = captureSendOrigin(text)
      if (!operations || !target || !origin || !enabled) {
        onSendError('Message not sent (disconnected)')
        return 'rejected'
      }
      // One budget spans stale-input healing and the committed message write.
      const deadline = sharedDeadline ?? openMobileNativeChatSendBudget()
      if (!(await operations.prepareCommit(target, deadline))) {
        onSendError('Message not sent')
        return 'rejected'
      }
      if (syncComposer) {
        clearDraftForSend(origin, text)
      }
      const outcome = await operations.sendMessage(target, text, deadline, !images?.length)
      if (outcome === 'unknown') {
        holdUnconfirmedSend(origin, text, () =>
          onSendError('Delivery unconfirmed — check chat before retrying')
        )
        return 'unknown'
      }
      if (outcome === 'rejected') {
        if (syncComposer) {
          restoreRejectedDraft(origin, text)
        }
        onSendError('Message not sent')
        return 'rejected'
      }
      acceptSend(origin, text, images)
      return 'accepted'
    },
    [
      acceptSend,
      agentRef,
      captureSendOrigin,
      clearDraftForSend,
      enabled,
      holdUnconfirmedSend,
      onSendError,
      operations,
      restoreRejectedDraft,
      targetRef
    ]
  )

  const sendWithOutcome = useCallback(
    (text: string, images?: string[], deadline?: number) =>
      sendMessage(text, images, true, true, deadline),
    [sendMessage]
  )
  const send = useCallback(
    async (text: string, images?: string[]) => (await sendWithOutcome(text, images)) !== 'rejected',
    [sendWithOutcome]
  )
  const answerQuestion = useCallback(
    async (text: string) => (await sendMessage(text, undefined, false)) !== 'rejected',
    [sendMessage]
  )

  // A session-option apply writes to the same input line as a send, and the host
  // spaces a send's body and its Enter ~500ms apart — so without this lock an
  // apply lands between them and is submitted as part of the user's prompt.
  const dispatchCommand = useCallback(
    async (text: string): Promise<MobileNativeChatSendOutcome> => {
      const terminal = handleRef.current
      if (terminal && !acquireMobileNativeChatTerminalWrite(terminal)) {
        return 'rejected'
      }
      try {
        return await sendMessage(text, undefined, false, false)
      } finally {
        if (terminal) {
          releaseMobileNativeChatTerminalWrite(terminal)
        }
      }
    },
    [handleRef, sendMessage]
  )

  return { send, sendWithOutcome, answerQuestion, dispatchCommand }
}
