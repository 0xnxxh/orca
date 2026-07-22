import { useCallback } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { buildMobileImagePastePayload } from './mobile-clipboard-image'
import { sendMobileNativeChatMessage } from './mobile-native-chat-send'
import type { MobileNativeChatReadyImage } from './use-mobile-native-chat-pending-images'

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
  readonly getReadyImages: () => readonly MobileNativeChatReadyImage[]
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
  getReadyImages,
  consumeImages,
  onSendError
}: UseMobileNativeChatImageSendArgs): (text: string) => Promise<boolean> {
  return useCallback(
    async (text: string): Promise<boolean> => {
      const images = getReadyImages()
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
      for (const image of images) {
        if (!targetIsCurrent()) {
          onSendError('Message not sent (disconnected)')
          return false
        }
        const accepted = await sendMobileNativeChatMessage({
          client,
          terminal,
          text: buildMobileImagePastePayload(image.hostPath),
          enter: false,
          ...(mobileClient ? { mobileClient } : {})
        })
        if (!accepted) {
          onSendError('Message not sent')
          return false
        }
        // Why: consume per image so a mid-sequence failure can't re-paste
        // already-delivered paths on retry (they sit in the TUI input now).
        consumeImages([image.id])
      }
      if (text.trim().length > 0) {
        // Why: image RPCs can outlive a tab switch; never send the caption to a
        // different terminal than the one that received the image paths.
        if (!targetIsCurrent()) {
          onSendError('Message not sent (disconnected)')
          return false
        }
        return sendText(text)
      }
      // Image-only send: the paths are in the TUI input; submit with Enter.
      if (!targetIsCurrent()) {
        onSendError('Message not sent (disconnected)')
        return false
      }
      const submitted = await sendMobileNativeChatMessage({
        client,
        terminal,
        text: '',
        enter: true,
        ...(mobileClient ? { mobileClient } : {})
      })
      if (!submitted) {
        onSendError('Message not sent')
      }
      return submitted
    },
    [
      activeHandleRef,
      clientRef,
      consumeImages,
      deviceTokenRef,
      getReadyImages,
      inputLeaseReadyRef,
      onSendError,
      sendText
    ]
  )
}
