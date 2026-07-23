import { useCallback, useEffect, useRef } from 'react'
import {
  NATIVE_CHAT_IMAGE_ATTACHMENT_SETTLE_MS,
  NATIVE_CHAT_SUBMIT_DELAY_MS
} from '../../../src/shared/native-chat-answer-stepping'
import type { RpcClient } from '../transport/rpc-client'
import { buildMobileImagePastePayload } from './mobile-clipboard-image'
import { sendMobileNativeChatMessageWithOutcome } from './mobile-native-chat-send'
import type { MobileNativeChatSendImage } from './use-mobile-native-chat-pending-images'

type CurrentRef<T> = {
  readonly current: T
}

type UseMobileNativeChatImageSendArgs = {
  readonly clientRef: CurrentRef<RpcClient | null>
  readonly activeHandleRef: CurrentRef<string | null>
  readonly deviceTokenRef: CurrentRef<string | null>
  readonly inputLeaseReadyRef: CurrentRef<boolean>
  readonly attachmentScopeKey: string
  /** The plain text send (controller-owned: optimistic bubble + draft clear). */
  readonly sendText: (text: string) => Promise<boolean>
  readonly getSendableImages: () => readonly MobileNativeChatSendImage[]
  readonly markImagesPasted: (ids: readonly string[]) => void
  readonly consumeImages: (ids: readonly string[]) => void
  readonly onSendError: (message: string) => void
}

function waitForNativeChatInputSettle(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

/** Wraps the native-chat send so pending image attachments are pasted into the
 *  agent TUI (bracketed, like a desktop image paste) right before the message
 *  text — deferring delivery to send time is what lets the composer thumbnails
 *  be removable. Image-only sends submit with a bare Enter. */
export function useMobileNativeChatImageSend({
  clientRef,
  activeHandleRef,
  deviceTokenRef,
  inputLeaseReadyRef,
  attachmentScopeKey,
  sendText,
  getSendableImages,
  markImagesPasted,
  consumeImages,
  onSendError
}: UseMobileNativeChatImageSendArgs): (text: string) => Promise<boolean> {
  const mountedRef = useRef(false)
  const targetStateRef = useRef({
    client: clientRef.current,
    attachmentScopeKey,
    generation: 0
  })
  if (
    targetStateRef.current.client !== clientRef.current ||
    targetStateRef.current.attachmentScopeKey !== attachmentScopeKey
  ) {
    targetStateRef.current = {
      client: clientRef.current,
      attachmentScopeKey,
      generation: targetStateRef.current.generation + 1
    }
  }
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  return useCallback(
    async (text: string): Promise<boolean> => {
      const images = getSendableImages()
      if (images.length === 0) {
        return sendText(text)
      }
      const hasText = text.trim().length > 0
      const client = clientRef.current
      const terminal = activeHandleRef.current
      const targetGeneration = targetStateRef.current.generation
      if (!mountedRef.current) {
        return false
      }
      if (!client || !terminal || !inputLeaseReadyRef.current) {
        onSendError('Message not sent (disconnected)')
        return false
      }
      const targetIdentityIsCurrent = (): boolean =>
        mountedRef.current &&
        targetStateRef.current.generation === targetGeneration &&
        clientRef.current === client &&
        activeHandleRef.current === terminal
      const targetIsReady = (): boolean => targetIdentityIsCurrent() && inputLeaseReadyRef.current
      const reportTargetChanged = (): false => {
        if (mountedRef.current) {
          onSendError('Message not sent (disconnected)')
        }
        return false
      }
      const mobileClient = deviceTokenRef.current
        ? { id: deviceTokenRef.current, type: 'mobile' as const }
        : undefined
      const pastedImageIds = images
        .filter((image) => image.status === 'pasted')
        .map((image) => image.id)
      let pastedImageThisSend = false
      for (const image of images) {
        if (image.status === 'pasted') {
          continue
        }
        if (!targetIsReady()) {
          return reportTargetChanged()
        }
        const outcome = await sendMobileNativeChatMessageWithOutcome({
          client,
          terminal,
          text: buildMobileImagePastePayload(image.hostPath),
          enter: false,
          ...(mobileClient ? { mobileClient } : {})
        })
        if (outcome === 'rejected') {
          if (targetIdentityIsCurrent()) {
            onSendError('Message not sent')
          }
          return false
        }
        // Why: keep paths already written to the hidden TUI distinct from ready
        // paths so a failed or ack-lost sequence can retry without duplicating them.
        markImagesPasted([image.id])
        pastedImageIds.push(image.id)
        pastedImageThisSend = true
        if (!targetIdentityIsCurrent()) {
          return reportTargetChanged()
        }
        if (outcome === 'unknown') {
          await waitForNativeChatInputSettle(
            hasText ? NATIVE_CHAT_IMAGE_ATTACHMENT_SETTLE_MS : NATIVE_CHAT_SUBMIT_DELAY_MS
          )
          if (!targetIdentityIsCurrent()) {
            return false
          }
          onSendError('Image delivery unconfirmed — check terminal before retrying')
          // Match text-send ambiguity: preserve retry state without also showing
          // the contradictory inline "Message not sent" failure.
          return true
        }
      }
      if (hasText) {
        if (pastedImageThisSend) {
          await waitForNativeChatInputSettle(NATIVE_CHAT_IMAGE_ATTACHMENT_SETTLE_MS)
        }
        // Why: image RPCs can outlive a tab switch; never send the caption to a
        // different terminal than the one that received the image paths.
        if (!targetIsReady()) {
          return reportTargetChanged()
        }
        const accepted = await sendText(text)
        if (accepted && targetIdentityIsCurrent()) {
          consumeImages(pastedImageIds)
        }
        return accepted
      }
      // Image-only send: the paths are in the TUI input; submit with Enter.
      if (pastedImageThisSend) {
        await waitForNativeChatInputSettle(NATIVE_CHAT_SUBMIT_DELAY_MS)
      }
      if (!targetIsReady()) {
        return reportTargetChanged()
      }
      const outcome = await sendMobileNativeChatMessageWithOutcome({
        client,
        terminal,
        text: '',
        enter: true,
        ...(mobileClient ? { mobileClient } : {})
      })
      if (!targetIdentityIsCurrent()) {
        return false
      }
      if (outcome === 'rejected') {
        onSendError('Message not sent')
        return false
      }
      consumeImages(pastedImageIds)
      if (outcome === 'unknown') {
        onSendError('Delivery unconfirmed — check chat before retrying')
      }
      return true
    },
    [
      activeHandleRef,
      attachmentScopeKey,
      clientRef,
      consumeImages,
      deviceTokenRef,
      getSendableImages,
      inputLeaseReadyRef,
      markImagesPasted,
      onSendError,
      sendText
    ]
  )
}
