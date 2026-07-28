import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MOBILE_WEB_TERMINAL_ARTIFACT_RASTER_MAX_BYTES,
  MOBILE_WEB_TERMINAL_ARTIFACT_TEXT_MAX_BYTES,
  type MobileWebTerminalPathResolveResult
} from '../../shared/mobile-web/terminal-artifact-contract'
import type { TerminalFileLinkTarget } from '../../shared/terminal-file-link-matcher'
import type { MobileWebFileChunkResult } from '../../shared/mobile-web/bridge-operation-contract'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'
import {
  appendMobileWebFileChunk,
  mobileWebFileNextChunkLength,
  type MobileWebFileDocument
} from './mobile-web-file-document'

export type MobileWebTerminalPathPreviewState =
  | { status: 'idle' }
  | { status: 'resolving' }
  | {
      status: 'loading'
      target: MobileWebTerminalPathResolveResult
      document: MobileWebFileDocument | null
    }
  | { status: 'ready'; target: MobileWebTerminalPathResolveResult; document: MobileWebFileDocument }
  | {
      status: 'error'
      target: MobileWebTerminalPathResolveResult | null
      error: MobileWebBridgeClientError
    }

export function useMobileWebTerminalPathPreview(args: {
  client: MobileWebBridgeClient
  workspaceId: string
  tabId: string
  connected: boolean
}): {
  preview: MobileWebTerminalPathPreviewState
  openPath: (target: TerminalFileLinkTarget) => void
  closePreview: () => void
} {
  const { client, workspaceId, tabId, connected } = args
  const [preview, setPreview] = useState<MobileWebTerminalPathPreviewState>({ status: 'idle' })
  const scope = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const activeTarget = useRef<MobileWebTerminalPathResolveResult | null>(null)

  const retire = useCallback(
    (updateState: boolean) => {
      scope.current += 1
      controller.current?.abort()
      controller.current = null
      const target = activeTarget.current
      activeTarget.current = null
      if (target?.kind === 'terminal-artifact') {
        void releaseTerminalArtifact(client, target, tabId)
      }
      if (updateState) {
        setPreview({ status: 'idle' })
      }
    },
    [client, tabId]
  )

  useEffect(() => {
    retire(true)
    return () => retire(false)
  }, [client, retire, workspaceId])

  useEffect(() => {
    if (!connected) {
      retire(true)
    }
  }, [connected, retire])

  const openPath = useCallback(
    (pathTarget: TerminalFileLinkTarget) => {
      if (!connected) {
        return
      }
      retire(false)
      const requestScope = ++scope.current
      const requestController = new AbortController()
      controller.current = requestController
      setPreview({ status: 'resolving' })
      void client
        .fileResolveTerminalPath(
          {
            workspaceId,
            tabId,
            pathText: pathTarget.pathText,
            line: pathTarget.line,
            column: pathTarget.column
          },
          { signal: requestController.signal }
        )
        .then(async (target) => {
          if (scope.current !== requestScope) {
            await releaseTerminalArtifact(client, target, tabId)
            return
          }
          activeTarget.current = target
          setPreview({ status: 'loading', target, document: null })
          const document = await readTerminalPathDocument({
            client,
            target,
            tabId,
            signal: requestController.signal,
            onProgress: (nextDocument) => {
              if (scope.current === requestScope) {
                setPreview({ status: 'loading', target, document: nextDocument })
              }
            }
          })
          if (scope.current === requestScope) {
            setPreview({ status: 'ready', target, document })
          }
        })
        .catch((error: unknown) => {
          if (scope.current !== requestScope) {
            return
          }
          const target = activeTarget.current
          activeTarget.current = null
          if (target?.kind === 'terminal-artifact') {
            void releaseTerminalArtifact(client, target, tabId)
          }
          setPreview({
            status: 'error',
            target,
            error: bridgeClientError(error)
          })
        })
        .finally(() => {
          if (scope.current === requestScope) {
            controller.current = null
          }
        })
    },
    [client, connected, retire, tabId, workspaceId]
  )

  return { preview, openPath, closePreview: () => retire(true) }
}

async function readTerminalPathDocument(args: {
  client: MobileWebBridgeClient
  target: MobileWebTerminalPathResolveResult
  tabId: string
  signal: AbortSignal
  onProgress: (document: MobileWebFileDocument) => void
}): Promise<MobileWebFileDocument> {
  const maximumBytes =
    args.target.previewKind === 'raster'
      ? MOBILE_WEB_TERMINAL_ARTIFACT_RASTER_MAX_BYTES
      : MOBILE_WEB_TERMINAL_ARTIFACT_TEXT_MAX_BYTES
  const relativePath =
    args.target.kind === 'worktree-file' ? args.target.relativePath : args.target.displayName
  let document: MobileWebFileDocument | null = null
  while (!document?.eof && !document?.limitReached) {
    const offset = document?.bytes.byteLength ?? 0
    const length = mobileWebFileNextChunkLength(document, maximumBytes)
    if (length === 0) {
      break
    }
    const chunk =
      args.target.kind === 'worktree-file'
        ? await args.client.fileReadChunk(
            {
              workspaceId: args.target.workspaceId,
              relativePath,
              offset,
              length
            },
            { signal: args.signal }
          )
        : terminalArtifactFileChunk(
            relativePath,
            await args.client.fileReadTerminalArtifactChunk(
              {
                workspaceId: args.target.workspaceId,
                tabId: args.tabId,
                token: args.target.token,
                offset,
                length
              },
              { signal: args.signal }
            )
          )
    const assembled = appendMobileWebFileChunk(document, chunk, maximumBytes)
    document =
      args.target.previewKind === 'raster'
        ? { ...assembled, content: '', kind: 'binary', revision: null }
        : { ...assembled, revision: null }
    args.onProgress(document)
    if (args.target.previewKind === 'text' && document.kind === 'binary') {
      break
    }
  }
  if (!document) {
    throw new MobileWebBridgeClientError('invalid_message', false)
  }
  return document
}

function terminalArtifactFileChunk(
  relativePath: string,
  chunk: Awaited<ReturnType<MobileWebBridgeClient['fileReadTerminalArtifactChunk']>>
): MobileWebFileChunkResult {
  return {
    workspaceId: chunk.workspaceId,
    relativePath,
    offset: chunk.offset,
    bytes: chunk.bytes,
    bytesRead: chunk.bytesRead,
    eof: chunk.eof
  }
}

async function releaseTerminalArtifact(
  client: MobileWebBridgeClient,
  target: MobileWebTerminalPathResolveResult,
  tabId: string
): Promise<void> {
  if (target.kind !== 'terminal-artifact') {
    return
  }
  await client
    .fileReleaseTerminalArtifact({
      workspaceId: target.workspaceId,
      tabId,
      token: target.token
    })
    .catch(() => undefined)
}

function bridgeClientError(error: unknown): MobileWebBridgeClientError {
  return error instanceof MobileWebBridgeClientError
    ? error
    : new MobileWebBridgeClientError('internal', false)
}
