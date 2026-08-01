import { useCallback, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { AskAnswerSelection, AskPrompt } from './mobile-native-chat-ask'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import { useNativeChatAcceptedAction } from './use-native-chat-action-outcomes'
import { useMobileNativeChatWriterGate } from './use-mobile-native-chat-writer-gate'

type BooleanWrite<Params extends unknown[]> = (...params: Params) => Promise<boolean>

export function useMobileNativeChatControllerWriters(args: {
  client: RpcClient | null
  enabled: boolean
  handleRef: MutableRefObject<string | null>
  streamIdentity: string
  answerAskWrite: BooleanWrite<[AskPrompt, AskAnswerSelection[]]>
  cancelAskWrite: BooleanWrite<[]>
  permissionWrite: BooleanWrite<[string]>
  questionAnswerWrite: BooleanWrite<[string]>
  messageWrite: BooleanWrite<[string, string[]?]>
  messageWriteWithOutcome: (
    text: string,
    images?: string[],
    deadline?: number
  ) => Promise<MobileNativeChatSendOutcome>
  onSendResolved: () => void
}): {
  answerAsk: BooleanWrite<[AskPrompt, AskAnswerSelection[]]>
  cancelAsk: BooleanWrite<[]>
  respondPermission: BooleanWrite<[string]>
  answerQuestion: BooleanWrite<[string]>
  send: BooleanWrite<[string, string[]?]>
  sendWithOutcome: (
    text: string,
    images?: string[],
    deadline?: number
  ) => Promise<MobileNativeChatSendOutcome>
  beforeWrite: () => Promise<boolean>
} {
  const { beforeWrite, runWrite } = useMobileNativeChatWriterGate(args)
  const guardedAnswerAsk = useCallback(
    (prompt: AskPrompt, selections: AskAnswerSelection[]) =>
      runWrite(() => args.answerAskWrite(prompt, selections), false),
    [args.answerAskWrite, runWrite]
  )
  const guardedCancelAsk = useCallback(
    () => runWrite(args.cancelAskWrite, false),
    [args.cancelAskWrite, runWrite]
  )
  const guardedPermission = useCallback(
    (text: string) => runWrite(() => args.permissionWrite(text), false),
    [args.permissionWrite, runWrite]
  )
  const answerQuestion = useCallback(
    (text: string) => runWrite(() => args.questionAnswerWrite(text), false),
    [args.questionAnswerWrite, runWrite]
  )
  const send = useCallback(
    (text: string, images?: string[]) => runWrite(() => args.messageWrite(text, images), false),
    [args.messageWrite, runWrite]
  )
  const sendWithOutcome = useCallback(
    async (text: string, images?: string[], deadline?: number) => {
      const waitStartedAt = Date.now()
      const allowed = await beforeWrite()
      if (!allowed) {
        if (!args.client || !args.enabled || !args.handleRef.current) {
          return args.messageWriteWithOutcome(text, images, deadline)
        }
        return 'rejected'
      }
      const creditedDeadline =
        deadline === undefined ? undefined : deadline + Date.now() - waitStartedAt
      return args.messageWriteWithOutcome(text, images, creditedDeadline)
    },
    [args.client, args.enabled, args.handleRef, args.messageWriteWithOutcome, beforeWrite]
  )

  return {
    answerAsk: useNativeChatAcceptedAction(guardedAnswerAsk, args.onSendResolved),
    cancelAsk: useNativeChatAcceptedAction(guardedCancelAsk, args.onSendResolved),
    respondPermission: useNativeChatAcceptedAction(guardedPermission, args.onSendResolved),
    answerQuestion,
    send,
    sendWithOutcome,
    beforeWrite
  }
}
