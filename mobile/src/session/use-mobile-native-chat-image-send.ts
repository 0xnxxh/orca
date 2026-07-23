import { useCallback } from 'react'
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
  /** The plain text send (controller-owned: optimistic bubble + draft clear). */
  readonly sendText: (text: string) => Promise<boolean>
  readonly getSendableImages: () => readonly MobileNativeChatSendImage[]
  readonly markImagesPasted: (ids: readonly string[]) => void
  readonly consumeImages: (ids: readonly string[]) => void
  readonly onSendError: (message: string) => void
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
  sendText,
  getSendableImages,
  markImagesPasted,
  consumeImages,
  onSendError
}: UseMobileNativeChatImageSendArgs): (text: string) => Promise<boolean> {
  return useCallback(
    async (text: string): Promise<boolean> => {
      const images = getSendableImages()
      if (images.length === 0) {
        return sendText(text)
      }
      const client = clientRef.current
      const terminal = activeHandleRef.current
      if (!client || !terminal || !inputLeaseReadyRef.current) {
        onSendError('Message not sent (disconnected)')
        return false
      }
      const targetIsCurrent = (): boolean =>
        clientRef.current === client &&
        activeHandleRef.current === terminal &&
        inputLeaseReadyRef.current
      const mobileClient = deviceTokenRef.current
        ? { id: deviceTokenRef.current, type: 'mobile' as const }
        : undefined
      const pastedImageIds = images
        .filter((image) => image.status === 'pasted')
        .map((image) => image.id)
      for (const image of images) {
        if (image.status === 'pasted') {
          continue
        }
        if (!targetIsCurrent()) {
          onSendError('Message not sent (disconnected)')
          return false
        }
        const outcome = await sendMobileNativeChatMessageWithOutcome({
          client,
          terminal,
          text: buildMobileImagePastePayload(image.hostPath),
          enter: false,
          ...(mobileClient ? { mobileClient } : {})
        })
        if (outcome === 'rejected') {
          onSendError('Message not sent')
          return false
        }
        // Why: keep paths already written to the hidden TUI distinct from ready
        // paths so a failed or ack-lost sequence can retry without duplicating them.
        markImagesPasted([image.id])
        pastedImageIds.push(image.id)
        if (outcome === 'unknown') {
          onSendError('Image delivery unconfirmed — check terminal before retrying')
          return false
        }
      }
      if (text.trim().length > 0) {
        // Why: image RPCs can outlive a tab switch; never send the caption to a
        // different terminal than the one that received the image paths.
        if (!targetIsCurrent()) {
          onSendError('Message not sent (disconnected)')
          return false
        }
        const accepted = await sendText(text)
        if (accepted) {
          consumeImages(pastedImageIds)
        }
        return accepted
      }
      // Image-only send: the paths are in the TUI input; submit with Enter.
      if (!targetIsCurrent()) {
        onSendError('Message not sent (disconnected)')
        return false
      }
      const outcome = await sendMobileNativeChatMessageWithOutcome({
        client,
        terminal,
        text: '',
        enter: true,
        ...(mobileClient ? { mobileClient } : {})
      })
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
