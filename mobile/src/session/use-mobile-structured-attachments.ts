import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import {
  ImageLibraryPermissionError,
  pickMobileImages,
  type MobileImageSource
} from './mobile-image-source-picker'
import {
  appendPendingNativeChatImages,
  uploadMobileNativeChatImages,
  type PendingNativeChatImage
} from './mobile-native-chat-image-attachment'

export function useMobileStructuredAttachments(args: {
  client: RpcClient | null
  sessionId: string | null
  getConnectionId: () => Promise<string | null>
  onError: (message: string) => void
}): {
  attachments: PendingNativeChatImage[]
  attaching: boolean
  attach: (source: MobileImageSource) => Promise<void>
  remove: (id: string) => void
  clear: () => void
} {
  const [attachments, setAttachments] = useState<PendingNativeChatImage[]>([])
  const [attaching, setAttaching] = useState(false)
  const sessionRef = useRef(args.sessionId)
  const idCounterRef = useRef(0)
  const { client, getConnectionId, onError, sessionId } = args
  sessionRef.current = sessionId
  useEffect(() => {
    setAttachments([])
  }, [sessionId])

  const attach = useCallback(
    async (source: MobileImageSource): Promise<void> => {
      if (!client || !sessionId || attaching) {
        return
      }
      const targetSession = sessionId
      try {
        const uploaded = await uploadMobileNativeChatImages(source, {
          client,
          getConnectionId,
          pickImages: pickMobileImages,
          onUploadStart: () => setAttaching(true)
        })
        if (sessionRef.current === targetSession && uploaded.length > 0) {
          setAttachments((current) =>
            appendPendingNativeChatImages(current, uploaded, idCounterRef)
          )
        }
      } catch (error) {
        onError(
          error instanceof ImageLibraryPermissionError
            ? 'Photo permission denied'
            : error instanceof Error && error.message === 'Clipboard image is too large'
              ? 'Image too large to attach'
              : 'Attach failed'
        )
      } finally {
        setAttaching(false)
      }
    },
    [attaching, client, getConnectionId, onError, sessionId]
  )

  return {
    attachments,
    attaching,
    attach,
    remove: (id) => setAttachments((current) => current.filter((entry) => entry.id !== id)),
    clear: () => setAttachments([])
  }
}
