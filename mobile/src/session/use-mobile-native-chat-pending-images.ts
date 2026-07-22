import { useCallback, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { saveMobileClipboardImageAsTempFile } from './mobile-clipboard-image'
import { pickMobileImage, type MobileImageSource } from './mobile-image-source-picker'
import { mobileImageAttachToastMessage } from './use-mobile-image-attachment'

/** A picked-but-unsent image shown as a removable thumbnail in the chat
 *  composer. Uploads to the host eagerly on pick; the resulting host path is
 *  pasted into the agent TUI only at send time so removing the thumbnail
 *  needs no TUI un-paste. */
export type MobileNativeChatPendingImage = {
  readonly id: string
  readonly thumbnailUri: string
  readonly status: 'uploading' | 'ready'
}

export type MobileNativeChatReadyImage = {
  readonly id: string
  readonly hostPath: string
}

type PendingImageEntry = MobileNativeChatPendingImage & {
  readonly hostPath: string | null
}

type UseMobileNativeChatPendingImagesArgs = {
  readonly client: RpcClient | null
  readonly activeHandle: string | null
  readonly canAttach: boolean
  readonly connState: ConnectionState
  readonly getConnectionId: () => Promise<string | null>
  readonly showToast: (message: string, durationMs?: number) => void
  readonly onSuccess: () => void
  readonly onError: () => void
}

type MobileNativeChatPendingImages = {
  readonly pendingChatImages: readonly MobileNativeChatPendingImage[]
  readonly attachPendingChatImage: (source: MobileImageSource) => Promise<void>
  readonly removePendingChatImage: (id: string) => void
  /** Snapshot of fully-uploaded images, in attach order. Read at send time. */
  readonly getReadyChatImages: () => readonly MobileNativeChatReadyImage[]
  /** Drop entries whose host paths were delivered to the TUI. */
  readonly consumePendingChatImages: (ids: readonly string[]) => void
}

export function useMobileNativeChatPendingImages({
  client,
  activeHandle,
  canAttach,
  connState,
  getConnectionId,
  showToast,
  onSuccess,
  onError
}: UseMobileNativeChatPendingImagesArgs): MobileNativeChatPendingImages {
  const [entries, setEntries] = useState<readonly PendingImageEntry[]>([])
  const entriesRef = useRef(entries)
  const idCounter = useRef(0)

  const updateEntries = useCallback(
    (updater: (previous: readonly PendingImageEntry[]) => readonly PendingImageEntry[]) => {
      setEntries((previous) => {
        const next = updater(previous)
        entriesRef.current = next
        return next
      })
    },
    []
  )

  // Why: pending images target the active terminal's agent; a tab/worktree
  // switch would silently re-aim them, so drop instead (adjust during render,
  // not in an effect, so a send in the same frame can't read stale entries).
  const lastHandle = useRef(activeHandle)
  if (lastHandle.current !== activeHandle) {
    lastHandle.current = activeHandle
    if (entriesRef.current.length > 0) {
      entriesRef.current = []
      setEntries([])
    }
  }

  const attachPendingChatImage = useCallback(
    async (source: MobileImageSource): Promise<void> => {
      if (!client || !activeHandle || !canAttach) {
        return
      }
      let entryId: string | null = null
      try {
        const picked = await pickMobileImage(source)
        // Cancelled picker: no entry, no toast.
        if (!picked) {
          return
        }
        idCounter.current += 1
        const id = `chat-image-${idCounter.current}`
        entryId = id
        updateEntries((previous) => [
          ...previous,
          {
            id,
            // Why: prefer the picker's file URI so the thumbnail doesn't hold a
            // second base64 copy of the image in JS memory.
            thumbnailUri: picked.uri ?? `data:image/png;base64,${picked.base64}`,
            status: 'uploading',
            hostPath: null
          }
        ])
        const connectionId = await getConnectionId()
        const hostPath = await saveMobileClipboardImageAsTempFile(client, picked.base64, {
          connectionId
        })
        // A handle switch mid-upload cleared the entry; the orphaned host temp
        // file is covered by the upload TTL.
        updateEntries((previous) =>
          previous.map((entry) =>
            entry.id === id ? { ...entry, status: 'ready' as const, hostPath } : entry
          )
        )
        onSuccess()
      } catch (error) {
        if (entryId !== null) {
          const failedId = entryId
          updateEntries((previous) => previous.filter((entry) => entry.id !== failedId))
        }
        onError()
        showToast(mobileImageAttachToastMessage(error, connState === 'connected'), 1500)
      }
    },
    [
      activeHandle,
      canAttach,
      client,
      connState,
      getConnectionId,
      onError,
      onSuccess,
      showToast,
      updateEntries
    ]
  )

  const removePendingChatImage = useCallback(
    (id: string) => {
      updateEntries((previous) => previous.filter((entry) => entry.id !== id))
    },
    [updateEntries]
  )

  const getReadyChatImages = useCallback(
    (): readonly MobileNativeChatReadyImage[] =>
      entriesRef.current
        .filter((entry) => entry.status === 'ready' && entry.hostPath !== null)
        .map((entry) => ({ id: entry.id, hostPath: entry.hostPath! })),
    []
  )

  const consumePendingChatImages = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) {
        return
      }
      const consumed = new Set(ids)
      updateEntries((previous) => previous.filter((entry) => !consumed.has(entry.id)))
    },
    [updateEntries]
  )

  return {
    pendingChatImages: entries,
    attachPendingChatImage,
    removePendingChatImage,
    getReadyChatImages,
    consumePendingChatImages
  }
}
