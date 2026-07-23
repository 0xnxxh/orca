import { useCallback, useRef, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { useMobileNativeChatImageSend } from './use-mobile-native-chat-image-send'
import {
  useMobileNativeChatPendingImages,
  type MobileNativeChatPendingImage
} from './use-mobile-native-chat-pending-images'

export type MobileNativeChatImageAttachmentContext = {
  readonly canAttach: boolean
  readonly connState: ConnectionState
  readonly getConnectionId: () => Promise<string | null>
  readonly showToast: (message: string, durationMs?: number) => void
  readonly onSuccess: () => void
  readonly onError: () => void
}

export type MobileNativeChatImageAttachments = {
  readonly pendingChatImages: readonly MobileNativeChatPendingImage[]
  readonly attachPendingChatImage: () => Promise<void>
  readonly removePendingChatImage: (id: string) => void
  readonly handleNativeChatSendWithImages: (text: string) => Promise<boolean>
}

type Args = MobileNativeChatImageAttachmentContext & {
  readonly client: RpcClient | null
  readonly activeHandle: string | null
  readonly activeHandleRef: MutableRefObject<string | null>
  readonly deviceTokenRef: MutableRefObject<string | null>
  readonly inputLeaseReady: boolean
  readonly sendText: (text: string) => Promise<boolean>
  readonly onSendError: (message: string) => void
}

/** Keeps native-chat image state and its send wrapper under the same target
 * lifecycle; the terminal surface continues to use immediate image paste. */
export function useMobileNativeChatImageAttachments({
  client,
  activeHandle,
  activeHandleRef,
  deviceTokenRef,
  inputLeaseReady,
  sendText,
  onSendError,
  ...pendingImageContext
}: Args): MobileNativeChatImageAttachments {
  const clientRef = useRef(client)
  clientRef.current = client
  const inputLeaseReadyRef = useRef(inputLeaseReady)
  inputLeaseReadyRef.current = inputLeaseReady
  const {
    pendingChatImages,
    attachPendingChatImage: attachPendingChatImageFromSource,
    removePendingChatImage,
    getReadyChatImages,
    consumePendingChatImages
  } = useMobileNativeChatPendingImages({
    client,
    activeHandle,
    ...pendingImageContext
  })
  const handleNativeChatSendWithImages = useMobileNativeChatImageSend({
    clientRef,
    activeHandleRef,
    deviceTokenRef,
    inputLeaseReadyRef,
    sendText,
    getReadyImages: getReadyChatImages,
    consumeImages: consumePendingChatImages,
    onSendError
  })
  const attachPendingChatImage = useCallback(
    () => attachPendingChatImageFromSource('library'),
    [attachPendingChatImageFromSource]
  )

  return {
    pendingChatImages,
    attachPendingChatImage,
    removePendingChatImage,
    handleNativeChatSendWithImages
  }
}
