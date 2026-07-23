import { useCallback, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import {
  ImageLibraryPermissionError,
  pickMobileImage,
  type MobileImageSource
} from './mobile-image-source-picker'
import {
  uploadMobileNativeChatImage,
  type PendingNativeChatImage
} from './mobile-native-chat-image-attachment'
import {
  MOBILE_NATIVE_CHAT_IMAGE_SETTLE_MS,
  pasteMobileNativeChatImagePaths
} from './mobile-native-chat-image-send'

type CurrentRef<T> = { readonly current: T }
type ShowToast = (message: string, durationMs?: number) => void

type Args = {
  readonly client: RpcClient | null
  readonly activeHandleRef: CurrentRef<string | null>
  readonly deviceTokenRef: CurrentRef<string | null>
  readonly getActiveWorktreeConnectionId: () => Promise<string | null>
  readonly connState: ConnectionState
  /** The native-chat input lease is ready — same gate `handleNativeChatSend` uses. */
  readonly enabled: boolean
  readonly showToast: ShowToast
  /** The plain text send (controller.handleNativeChatSend); wrapped so images ride
   *  along. The optional URIs drive the optimistic echo's thumbnails. */
  readonly baseSend: (text: string, imagePreviewUris?: string[]) => Promise<boolean>
  readonly onAttachSuccess?: () => void
  readonly onError?: () => void
  // Injected so the settle between image paste and submit is instant in tests.
  readonly sleep?: (ms: number) => Promise<void>
}

export type MobileNativeChatImageAttachments = {
  readonly attachments: PendingNativeChatImage[]
  readonly isAttaching: boolean
  readonly attachImage: (source: MobileImageSource) => Promise<void>
  readonly removeAttachment: (id: string) => void
  /** Ride any pending images along with `text`, then submit; clears chips on send. */
  readonly sendNativeChat: (text: string) => Promise<boolean>
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export function useMobileNativeChatImageAttachments({
  client,
  activeHandleRef,
  deviceTokenRef,
  getActiveWorktreeConnectionId,
  connState,
  enabled,
  showToast,
  baseSend,
  onAttachSuccess,
  onError,
  sleep = defaultSleep
}: Args): MobileNativeChatImageAttachments {
  const [attachments, setAttachments] = useState<PendingNativeChatImage[]>([])
  const [isAttaching, setIsAttaching] = useState(false)
  const idCounter = useRef(0)

  const attachImage = useCallback(
    async (source: MobileImageSource): Promise<void> => {
      if (!client || !activeHandleRef.current || connState !== 'connected') {
        return
      }
      try {
        const uploaded = await uploadMobileNativeChatImage(source, {
          client,
          getConnectionId: getActiveWorktreeConnectionId,
          pickImage: pickMobileImage,
          onUploadStart: () => setIsAttaching(true)
        })
        // Cancelled picker: no error, no toast.
        if (!uploaded) {
          return
        }
        idCounter.current += 1
        setAttachments((prev) => [...prev, { id: `img-${idCounter.current}`, ...uploaded }])
        onAttachSuccess?.()
      } catch (error) {
        onError?.()
        if (connState !== 'connected') {
          showToast('Attach failed (disconnected)', 1500)
          return
        }
        if (error instanceof ImageLibraryPermissionError) {
          showToast('Photo permission denied', 1500)
          return
        }
        if (getErrorMessage(error) === 'Clipboard image is too large') {
          showToast('Image too large to attach', 1500)
          return
        }
        showToast('Attach failed', 1500)
      } finally {
        setIsAttaching(false)
      }
    },
    [
      activeHandleRef,
      client,
      connState,
      getActiveWorktreeConnectionId,
      onAttachSuccess,
      onError,
      showToast
    ]
  )

  const removeAttachment = useCallback((id: string): void => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id))
  }, [])

  const sendNativeChat = useCallback(
    async (text: string): Promise<boolean> => {
      if (attachments.length === 0) {
        return baseSend(text)
      }
      const handle = activeHandleRef.current
      if (!client || !handle || !enabled || connState !== 'connected') {
        onError?.()
        return false
      }
      const pasted = await pasteMobileNativeChatImagePaths({
        client,
        terminal: handle,
        deviceToken: deviceTokenRef.current,
        imagePaths: attachments.map((attachment) => attachment.path)
      })
      if (!pasted) {
        // Keep the chips so the user can retry; the failed paste never submitted.
        onError?.()
        return false
      }
      // Let the TUI absorb the image paste before the text + Enter follow. The
      // preview URIs ride along to baseSend so the sent bubble shows the photo
      // immediately (empty text still submits a bare Enter through baseSend).
      await sleep(MOBILE_NATIVE_CHAT_IMAGE_SETTLE_MS)
      const accepted = await baseSend(
        text,
        attachments.map((attachment) => attachment.previewUri)
      )
      if (accepted) {
        setAttachments([])
      }
      return accepted
    },
    [
      activeHandleRef,
      attachments,
      baseSend,
      client,
      connState,
      deviceTokenRef,
      enabled,
      onError,
      sleep
    ]
  )

  return { attachments, isAttaching, attachImage, removeAttachment, sendNativeChat }
}
