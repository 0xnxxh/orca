import { useCallback, useEffect, useRef, useState } from 'react'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'
import {
  appendMobileWebFileChunk,
  mobileWebFileNextChunkLength,
  type MobileWebFileDocument
} from './mobile-web-file-document'
import {
  MOBILE_WEB_RASTER_IMAGE_MAX_BYTES,
  isMobileWebRasterImagePath
} from './mobile-web-raster-image'

export type MobileWebFilePreviewState =
  | { status: 'idle' }
  | { status: 'loading'; relativePath: string; document: MobileWebFileDocument | null }
  | { status: 'ready'; document: MobileWebFileDocument }
  | {
      status: 'error'
      relativePath: string
      document: MobileWebFileDocument | null
      error: MobileWebBridgeClientError
    }

export function useMobileWebFileDocument(args: {
  client: MobileWebBridgeClient
  workspaceId: string
  connected: boolean
}): {
  preview: MobileWebFilePreviewState
  openFile: (relativePath: string) => void
  openTextFile: (relativePath: string) => void
  openBinaryFile: (relativePath: string) => void
  loadMore: () => void
  cancelLoad: () => void
} {
  const { client, workspaceId, connected } = args
  const [preview, setPreview] = useState<MobileWebFilePreviewState>({ status: 'idle' })
  const scope = useRef(0)
  const controller = useRef<AbortController | null>(null)

  const cancelLoad = useCallback(() => {
    scope.current += 1
    controller.current?.abort()
    controller.current = null
    setPreview((current) =>
      current.status === 'loading'
        ? current.document?.kind === 'text'
          ? { status: 'ready', document: current.document }
          : { status: 'idle' }
        : current
    )
  }, [])

  useEffect(() => {
    scope.current += 1
    controller.current?.abort()
    controller.current = null
    setPreview({ status: 'idle' })
    return () => {
      scope.current += 1
      controller.current?.abort()
      controller.current = null
    }
  }, [client, workspaceId])

  useEffect(() => {
    if (!connected) {
      cancelLoad()
    }
  }, [cancelLoad, connected])

  const readNext = useCallback(
    (relativePath: string, document: MobileWebFileDocument | null) => {
      const length = mobileWebFileNextChunkLength(document)
      if (!connected || length === 0 || document?.eof || document?.kind === 'binary') {
        return
      }
      controller.current?.abort()
      const requestController = new AbortController()
      controller.current = requestController
      const requestScope = ++scope.current
      const offset = document?.bytes.byteLength ?? 0
      setPreview({ status: 'loading', relativePath, document })
      void client
        .fileReadChunk(
          { workspaceId, relativePath, offset, length },
          { signal: requestController.signal }
        )
        .then((chunk) => {
          if (scope.current !== requestScope) {
            return
          }
          if (
            chunk.workspaceId !== workspaceId ||
            chunk.relativePath !== relativePath ||
            chunk.offset !== offset
          ) {
            throw new MobileWebBridgeClientError('invalid_message', false)
          }
          setPreview({ status: 'ready', document: appendMobileWebFileChunk(document, chunk) })
        })
        .catch((error: unknown) => {
          if (scope.current === requestScope) {
            setPreview({
              status: 'error',
              relativePath,
              document,
              error: bridgeClientError(error)
            })
          }
        })
        .finally(() => {
          if (scope.current === requestScope) {
            controller.current = null
          }
        })
    },
    [client, connected, workspaceId]
  )

  const openTextFile = useCallback(
    (relativePath: string) => {
      readNext(relativePath, null)
    },
    [readNext]
  )
  const readRasterImage = useCallback(
    (relativePath: string) => {
      if (!connected) {
        return
      }
      controller.current?.abort()
      const requestController = new AbortController()
      controller.current = requestController
      const requestScope = ++scope.current
      setPreview({ status: 'loading', relativePath, document: null })
      void readRasterImageChunks({
        client,
        workspaceId,
        relativePath,
        signal: requestController.signal,
        onProgress: (document) => {
          if (scope.current === requestScope) {
            setPreview({ status: 'loading', relativePath, document })
          }
        }
      })
        .then((document) => {
          if (scope.current === requestScope) {
            setPreview({ status: 'ready', document })
          }
        })
        .catch((error: unknown) => {
          if (scope.current === requestScope) {
            setPreview({
              status: 'error',
              relativePath,
              document: null,
              error: bridgeClientError(error)
            })
          }
        })
        .finally(() => {
          if (scope.current === requestScope) {
            controller.current = null
          }
        })
    },
    [client, connected, workspaceId]
  )
  const openFile = useCallback(
    (relativePath: string) => {
      if (isMobileWebRasterImagePath(relativePath)) {
        readRasterImage(relativePath)
        return
      }
      openTextFile(relativePath)
    },
    [openTextFile, readRasterImage]
  )
  const openBinaryFile = useCallback(
    (relativePath: string) => {
      if (isMobileWebRasterImagePath(relativePath)) {
        readRasterImage(relativePath)
        return
      }
      cancelLoad()
      setPreview({
        status: 'ready',
        document: {
          workspaceId,
          relativePath,
          bytes: new Uint8Array(),
          content: '',
          kind: 'binary',
          eof: true,
          limitReached: false,
          revision: null
        }
      })
    },
    [cancelLoad, readRasterImage, workspaceId]
  )
  const loadMore = useCallback(() => {
    if (preview.status === 'ready') {
      readNext(preview.document.relativePath, preview.document)
    } else if (preview.status === 'error') {
      readNext(preview.relativePath, preview.document)
    }
  }, [preview, readNext])

  return { preview, openFile, openTextFile, openBinaryFile, loadMore, cancelLoad }
}

function bridgeClientError(error: unknown): MobileWebBridgeClientError {
  return error instanceof MobileWebBridgeClientError
    ? error
    : new MobileWebBridgeClientError('internal', false)
}

async function readRasterImageChunks(args: {
  client: MobileWebBridgeClient
  workspaceId: string
  relativePath: string
  signal: AbortSignal
  onProgress: (document: MobileWebFileDocument) => void
}): Promise<MobileWebFileDocument> {
  let document: MobileWebFileDocument | null = null
  while (!document?.eof && !document?.limitReached) {
    const offset = document?.bytes.byteLength ?? 0
    const length = mobileWebFileNextChunkLength(document, MOBILE_WEB_RASTER_IMAGE_MAX_BYTES)
    if (length === 0) {
      break
    }
    const chunk = await args.client.fileReadChunk(
      {
        workspaceId: args.workspaceId,
        relativePath: args.relativePath,
        offset,
        length
      },
      { signal: args.signal }
    )
    if (
      chunk.workspaceId !== args.workspaceId ||
      chunk.relativePath !== args.relativePath ||
      chunk.offset !== offset
    ) {
      throw new MobileWebBridgeClientError('invalid_message', false)
    }
    const assembled = appendMobileWebFileChunk(document, chunk, MOBILE_WEB_RASTER_IMAGE_MAX_BYTES)
    document = {
      ...assembled,
      content: '',
      kind: 'binary',
      revision: null
    }
    args.onProgress(document)
  }
  if (!document) {
    throw new MobileWebBridgeClientError('invalid_message', false)
  }
  return document
}
