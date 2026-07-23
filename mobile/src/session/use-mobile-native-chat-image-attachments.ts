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
  /** Identity of the active composer surface (same key shape as the drafts hook):
   *  chips are scoped to the tab that picked them, so a tab switch cannot ride
   *  one tab's image into another tab's terminal. Null disables attaching. */
  readonly scopeKey: string | null
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
  /** Pending chips for the active scope (tab) only. */
  readonly attachments: PendingNativeChatImage[]
  readonly isAttaching: boolean
  readonly attachImage: (source: MobileImageSource) => Promise<void>
  readonly removeAttachment: (id: string) => void
  /** Ride any pending images along with `text`, then submit; clears the sent
   *  chips (and only those) once the send is accepted. */
  readonly sendNativeChat: (text: string) => Promise<boolean>
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const NO_ATTACHMENTS: PendingNativeChatImage[] = []

function withScopeAttachments(
  byScope: Record<string, PendingNativeChatImage[]>,
  scope: string,
  next: PendingNativeChatImage[]
): Record<string, PendingNativeChatImage[]> {
  if (next.length > 0) {
    return { ...byScope, [scope]: next }
  }
  const remaining = { ...byScope }
  delete remaining[scope]
  return remaining
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export function useMobileNativeChatImageAttachments({
  client,
  activeHandleRef,
  deviceTokenRef,
  getActiveWorktreeConnectionId,
  connState,
  scopeKey,
  enabled,
  showToast,
  baseSend,
  onAttachSuccess,
  onError,
  sleep = defaultSleep
}: Args): MobileNativeChatImageAttachments {
  const [attachmentsByScope, setAttachmentsByScope] = useState<
    Record<string, PendingNativeChatImage[]>
  >({})
  const [isAttaching, setIsAttaching] = useState(false)
  const idCounter = useRef(0)
  // Count in-flight uploads so an overlapping attach can't clear the flag early.
  const attachingCount = useRef(0)

  const attachments = (scopeKey ? attachmentsByScope[scopeKey] : undefined) ?? NO_ATTACHMENTS

  const attachImage = useCallback(
    async (source: MobileImageSource): Promise<void> => {
      // The chip lands in the scope that initiated the pick, even if the user
      // switches tabs while the upload is in flight.
      const scope = scopeKey
      if (!client || !scope || !activeHandleRef.current || connState !== 'connected') {
        return
      }
      try {
        const uploaded = await uploadMobileNativeChatImage(source, {
          client,
          getConnectionId: getActiveWorktreeConnectionId,
          pickImage: pickMobileImage,
          onUploadStart: () => {
            attachingCount.current += 1
            setIsAttaching(true)
          }
        })
        // Cancelled picker: no error, no toast.
        if (!uploaded) {
          return
        }
        idCounter.current += 1
        const chip = { id: `img-${idCounter.current}`, ...uploaded }
        setAttachmentsByScope((prev) => ({ ...prev, [scope]: [...(prev[scope] ?? []), chip] }))
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
        attachingCount.current -= 1
        if (attachingCount.current <= 0) {
          attachingCount.current = 0
          setIsAttaching(false)
        }
      }
    },
    [
      activeHandleRef,
      client,
      connState,
      getActiveWorktreeConnectionId,
      onAttachSuccess,
      onError,
      scopeKey,
      showToast
    ]
  )

  const removeAttachment = useCallback(
    (id: string): void => {
      const scope = scopeKey
      if (!scope) {
        return
      }
      setAttachmentsByScope((prev) =>
        withScopeAttachments(
          prev,
          scope,
          (prev[scope] ?? []).filter((attachment) => attachment.id !== id)
        )
      )
    },
    [scopeKey]
  )

  const sendNativeChat = useCallback(
    async (text: string): Promise<boolean> => {
      const scope = scopeKey
      const pendingImages = (scope ? attachmentsByScope[scope] : undefined) ?? NO_ATTACHMENTS
      if (pendingImages.length === 0 || !scope) {
        return baseSend(text)
      }
      const handle = activeHandleRef.current
      if (!client || !handle || !enabled || connState !== 'connected') {
        onError?.()
        // Mirror the text path's failure surface (the base send is never reached).
        showToast('Message not sent (disconnected)', 1500)
        return false
      }
      try {
        const pasted = await pasteMobileNativeChatImagePaths({
          client,
          terminal: handle,
          deviceToken: deviceTokenRef.current,
          imagePaths: pendingImages.map((attachment) => attachment.path)
        })
        if (!pasted) {
          // Keep the chips so the user can retry; the failed paste never submitted.
          onError?.()
          showToast('Message not sent', 1500)
          return false
        }
        // Let the TUI absorb the image paste before the text + Enter follow. The
        // preview URIs ride along to baseSend so the sent bubble shows the photo
        // immediately (empty text still submits a bare Enter through baseSend).
        await sleep(MOBILE_NATIVE_CHAT_IMAGE_SETTLE_MS)
        const accepted = await baseSend(
          text,
          pendingImages.map((attachment) => attachment.previewUri)
        )
        if (accepted) {
          // Drop only what rode along — a chip attached while this send was in
          // flight keeps waiting for its own send.
          const sentIds = new Set(pendingImages.map((attachment) => attachment.id))
          setAttachmentsByScope((prev) =>
            withScopeAttachments(
              prev,
              scope,
              (prev[scope] ?? []).filter((attachment) => !sentIds.has(attachment.id))
            )
          )
        }
        return accepted
      } catch {
        // A thrown paste/send (network/RPC) keeps the chips and honors the
        // Promise<boolean> contract instead of rejecting. Retry-safe: the next
        // attempt's leading Ctrl+U clears whatever fraction of the paste landed.
        onError?.()
        showToast('Message not sent', 1500)
        return false
      }
    },
    [
      activeHandleRef,
      attachmentsByScope,
      baseSend,
      client,
      connState,
      deviceTokenRef,
      enabled,
      onError,
      scopeKey,
      showToast,
      sleep
    ]
  )

  return { attachments, isAttaching, attachImage, removeAttachment, sendNativeChat }
}
