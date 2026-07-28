import { useCallback, useEffect, useRef, useState } from 'react'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'
import { encodeMobileWebFileEdit } from './mobile-web-file-edit-content'
import type { MobileWebFileDocument } from './mobile-web-file-document'

type EditableFileState = {
  relativePath: string
  expectedRevision: string
  initialContent: string
  draft: string
}

export type MobileWebFileEditorState =
  | { status: 'idle' }
  | ({ status: 'editing' | 'saving' } & EditableFileState)
  | ({ status: 'error'; error: MobileWebBridgeClientError } & EditableFileState)

export function useMobileWebFileEditor({
  client,
  workspaceId,
  connected,
  onSaved
}: {
  client: MobileWebBridgeClient
  workspaceId: string
  connected: boolean
  onSaved: (relativePath: string) => void
}) {
  const [editor, setEditor] = useState<MobileWebFileEditorState>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)
  const scope = useRef(0)

  const cancel = useCallback(() => {
    scope.current += 1
    controller.current?.abort()
    controller.current = null
    setEditor({ status: 'idle' })
  }, [])

  useEffect(() => {
    cancel()
    return cancel
  }, [cancel, client, workspaceId])

  useEffect(() => {
    if (!connected && editor.status === 'saving') {
      controller.current?.abort()
      controller.current = null
      setEditor({
        ...editor,
        status: 'error',
        error: new MobileWebBridgeClientError('not_connected', true)
      })
    }
  }, [connected, editor])

  const begin = useCallback((document: MobileWebFileDocument) => {
    if (document.kind !== 'text' || !document.eof || document.limitReached || !document.revision) {
      return
    }
    setEditor({
      status: 'editing',
      relativePath: document.relativePath,
      expectedRevision: document.revision,
      initialContent: document.content,
      draft: document.content
    })
  }, [])

  const setDraft = useCallback((draft: string) => {
    setEditor((current) =>
      current.status === 'idle' || current.status === 'saving'
        ? current
        : { ...current, status: 'editing', draft }
    )
  }, [])

  const save = useCallback(() => {
    if (!connected || editor.status === 'idle' || editor.status === 'saving') {
      return
    }
    let encoded: ReturnType<typeof encodeMobileWebFileEdit>
    try {
      encoded = encodeMobileWebFileEdit(editor.draft)
    } catch (error) {
      setEditor({ ...editor, status: 'error', error: bridgeClientError(error) })
      return
    }
    controller.current?.abort()
    const requestController = new AbortController()
    const requestScope = ++scope.current
    controller.current = requestController
    setEditor({ ...editor, status: 'saving' })
    void client
      .fileWrite(
        {
          workspaceId,
          relativePath: editor.relativePath,
          expectedRevision: editor.expectedRevision,
          contentBase64: encoded.contentBase64
        },
        { signal: requestController.signal }
      )
      .then((result) => {
        if (
          scope.current !== requestScope ||
          result.revision !== encoded.revision ||
          result.byteLength !== encoded.byteLength
        ) {
          if (scope.current === requestScope) {
            throw new MobileWebBridgeClientError('invalid_message', false)
          }
          return
        }
        setEditor({ status: 'idle' })
        onSaved(editor.relativePath)
      })
      .catch((error: unknown) => {
        if (scope.current === requestScope) {
          setEditor({ ...editor, status: 'error', error: bridgeClientError(error) })
        }
      })
      .finally(() => {
        if (scope.current === requestScope) {
          controller.current = null
        }
      })
  }, [client, connected, editor, onSaved, workspaceId])

  return { editor, begin, setDraft, save, cancel }
}

function bridgeClientError(error: unknown): MobileWebBridgeClientError {
  return error instanceof MobileWebBridgeClientError
    ? error
    : new MobileWebBridgeClientError('internal', false)
}
