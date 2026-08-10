import { sendRuntimePtyInputVerified } from '@/runtime/runtime-terminal-inspection'
import { NATIVE_CHAT_SUBMIT_DELAY_MS } from '../../../../shared/native-chat-answer-stepping'
import { buildNativeChatPasteBytes, NATIVE_CHAT_SUBMIT } from './native-chat-send'
import type { NativeChatSendOptions } from './native-chat-runtime-send'

type NativeChatVerifiedSubmitContext = {
  isCancelled: () => boolean
  delay: (ms: number, fn: () => void) => void
  markSubmitted: () => void
  markFinished: () => void
}

export function isVerifiedOptionSend(
  classification: string,
  surface: { tracksOutgoingCommand(command: string): boolean } | null,
  command: string
): boolean {
  return classification === 'command' && surface?.tracksOutgoingCommand(command) === true
}

export function verifiedSendOptions(
  options: NativeChatSendOptions | undefined,
  verified: boolean
): NativeChatSendOptions | undefined {
  return verified ? { ...options, verifySubmission: true } : options
}

export function writeVerifiedNativeChatBody(
  settings: Parameters<typeof sendRuntimePtyInputVerified>[0],
  ptyId: string,
  text: string,
  context: NativeChatVerifiedSubmitContext,
  onSubmitStarted: () => void
): void {
  void sendRuntimePtyInputVerified(settings, ptyId, buildNativeChatPasteBytes(text)).then(
    (bodyAccepted) => {
      if (!bodyAccepted || context.isCancelled()) {
        context.markFinished()
        return
      }
      context.delay(NATIVE_CHAT_SUBMIT_DELAY_MS, () => {
        onSubmitStarted()
        void sendRuntimePtyInputVerified(settings, ptyId, NATIVE_CHAT_SUBMIT).then((accepted) => {
          if (accepted) {
            context.markSubmitted()
          } else {
            context.markFinished()
          }
        }, context.markFinished)
      })
    },
    context.markFinished
  )
}
