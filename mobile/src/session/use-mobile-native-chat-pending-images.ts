import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { saveMobileClipboardImageAsTempFile } from './mobile-clipboard-image'
import { pickMobileImage, type MobileImageSource } from './mobile-image-source-picker'
import {
  nextMobileNativeChatImageId,
  readMobileNativeChatImageScope,
  updateMobileNativeChatImageScopeEntries,
  writeMobileNativeChatImageScope
} from './mobile-native-chat-image-scope-cache'
import { mobileImageAttachToastMessage } from './use-mobile-image-attachment'

/** A picked-but-unsent image shown as a removable thumbnail in the chat
 *  composer. Uploads to the host eagerly on pick; the resulting host path is
 *  pasted into the agent TUI only at send time so removing the thumbnail
 *  needs no TUI un-paste. */
export type MobileNativeChatPendingImage = {
  readonly id: string
  readonly thumbnailUri: string
  readonly status: 'uploading' | 'ready' | 'pasted'
}

export type MobileNativeChatSendImage =
  | { readonly id: string; readonly status: 'ready'; readonly hostPath: string }
  | { readonly id: string; readonly status: 'pasted' }

type PendingImageEntry = MobileNativeChatPendingImage & {
  readonly hostPath: string | null
}

type UseMobileNativeChatPendingImagesArgs = {
  readonly client: RpcClient | null
  readonly activeHandle: string | null
  readonly attachmentScopeKey: string
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
  readonly getSendableChatImages: () => readonly MobileNativeChatSendImage[]
  readonly markPendingChatImagesPasted: (ids: readonly string[]) => void
  /** Drop entries after the TUI submission is accepted or delivery is unknown. */
  readonly consumePendingChatImages: (ids: readonly string[]) => void
}

export function useMobileNativeChatPendingImages({
  client,
  activeHandle,
  attachmentScopeKey,
  canAttach,
  connState,
  getConnectionId,
  showToast,
  onSuccess,
  onError
}: UseMobileNativeChatPendingImagesArgs): MobileNativeChatPendingImages {
  const [entries, setEntries] = useState<readonly PendingImageEntry[]>(() =>
    readMobileNativeChatImageScope({ client, key: attachmentScopeKey })
  )
  const entriesRef = useRef(entries)
  const mountedRef = useRef(false)
  const uploadControllersRef = useRef(new Map<string, AbortController>())
  const targetState = useRef({
    client,
    attachmentScopeKey,
    generation: 0
  })

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      for (const controller of uploadControllersRef.current.values()) {
        controller.abort()
      }
      uploadControllersRef.current.clear()
      writeMobileNativeChatImageScope(
        { client: targetState.current.client, key: targetState.current.attachmentScopeKey },
        entriesRef.current
      )
      entriesRef.current = []
    }
  }, [])

  useEffect(
    () => () => {
      for (const controller of uploadControllersRef.current.values()) {
        controller.abort()
      }
      uploadControllersRef.current.clear()
    },
    [client, attachmentScopeKey]
  )

  const updateEntries = useCallback(
    (updater: (previous: readonly PendingImageEntry[]) => readonly PendingImageEntry[]) => {
      if (!mountedRef.current) {
        return
      }
      const previous = entriesRef.current
      const next = updater(previous)
      if (next === previous) {
        return
      }
      entriesRef.current = next
      writeMobileNativeChatImageScope(
        { client: targetState.current.client, key: targetState.current.attachmentScopeKey },
        next
      )
      setEntries(next)
    },
    []
  )

  // Why: a path accepted by a hidden TUI must remain visible only in its owning
  // composer, including when its acknowledgement arrives during a tab switch.
  if (
    targetState.current.client !== client ||
    targetState.current.attachmentScopeKey !== attachmentScopeKey
  ) {
    targetState.current = {
      client,
      attachmentScopeKey,
      generation: targetState.current.generation + 1
    }
    const restored = readMobileNativeChatImageScope({ client, key: attachmentScopeKey })
    entriesRef.current = restored
    setEntries(restored)
  }

  const attachPendingChatImage = useCallback(
    async (source: MobileImageSource): Promise<void> => {
      if (!client || !activeHandle || !canAttach) {
        return
      }
      const targetClient = client
      const targetScopeKey = attachmentScopeKey
      const targetGeneration = targetState.current.generation
      const targetIsCurrent = (): boolean =>
        mountedRef.current &&
        targetState.current.client === targetClient &&
        targetState.current.attachmentScopeKey === targetScopeKey &&
        targetState.current.generation === targetGeneration
      let entryId: string | null = null
      let uploadController: AbortController | null = null
      try {
        const picked = await pickMobileImage(source)
        // Cancelled picker: no entry, no toast.
        if (!picked || !targetIsCurrent()) {
          return
        }
        const id = nextMobileNativeChatImageId()
        entryId = id
        uploadController = new AbortController()
        uploadControllersRef.current.set(id, uploadController)
        updateEntries((previous) => [
          ...previous,
          {
            id,
            thumbnailUri: picked.uri,
            status: 'uploading',
            hostPath: null
          }
        ])
        const connectionId = await getConnectionId()
        if (!targetIsCurrent()) {
          return
        }
        const hostPath = await saveMobileClipboardImageAsTempFile(targetClient, picked.base64, {
          connectionId,
          signal: uploadController.signal
        })
        if (!targetIsCurrent()) {
          return
        }
        let completed = false
        updateEntries((previous) => {
          const index = previous.findIndex((entry) => entry.id === id)
          if (index < 0) {
            return previous
          }
          completed = true
          const next = previous.slice()
          next[index] = { ...previous[index], status: 'ready', hostPath }
          return next
        })
        if (completed) {
          onSuccess()
        }
      } catch (error) {
        // Why: switching targets or removing the tile cancels this attachment;
        // late failures must not surface against the current composer.
        if (
          !targetIsCurrent() ||
          (entryId !== null && !entriesRef.current.some((entry) => entry.id === entryId))
        ) {
          return
        }
        if (entryId !== null) {
          const failedId = entryId
          updateEntries((previous) => previous.filter((entry) => entry.id !== failedId))
        }
        onError()
        showToast(mobileImageAttachToastMessage(error, connState === 'connected'), 1500)
      } finally {
        if (entryId !== null && uploadControllersRef.current.get(entryId) === uploadController) {
          uploadControllersRef.current.delete(entryId)
        }
      }
    },
    [
      activeHandle,
      attachmentScopeKey,
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
      uploadControllersRef.current.get(id)?.abort()
      uploadControllersRef.current.delete(id)
      updateEntries((previous) =>
        previous.filter((entry) => entry.id !== id || entry.status === 'pasted')
      )
    },
    [updateEntries]
  )

  const getSendableChatImages = useCallback((): readonly MobileNativeChatSendImage[] => {
    const images: MobileNativeChatSendImage[] = []
    for (const entry of entriesRef.current) {
      if (entry.status === 'ready' && entry.hostPath !== null) {
        images.push({ id: entry.id, status: 'ready', hostPath: entry.hostPath })
      } else if (entry.status === 'pasted') {
        images.push({ id: entry.id, status: 'pasted' })
      }
    }
    return images
  }, [])

  const markPendingChatImagesPasted = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) {
        return
      }
      const pasted = new Set(ids)
      updateEntries((previous) => {
        let changed = false
        const next = previous.map((entry) => {
          if (!pasted.has(entry.id) || entry.status !== 'ready') {
            return entry
          }
          changed = true
          return { ...entry, status: 'pasted' as const, hostPath: null }
        })
        return changed ? next : previous
      })
      updateMobileNativeChatImageScopeEntries(pasted, (entry) =>
        entry.status === 'ready' ? { ...entry, status: 'pasted', hostPath: null } : entry
      )
    },
    [updateEntries]
  )

  const consumePendingChatImages = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) {
        return
      }
      const consumed = new Set(ids)
      updateEntries((previous) => {
        const next = previous.filter((entry) => !consumed.has(entry.id))
        return next.length === previous.length ? previous : next
      })
      updateMobileNativeChatImageScopeEntries(consumed, () => null)
    },
    [updateEntries]
  )

  return {
    pendingChatImages: entries,
    attachPendingChatImage,
    removePendingChatImage,
    getSendableChatImages,
    markPendingChatImagesPasted,
    consumePendingChatImages
  }
}
