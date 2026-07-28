import { Button } from '@renderer/components/ui/button'
import { FileWarning, Loader2, Pencil, X } from 'lucide-react'
import React from 'react'
import type { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'
import { MobileWebFileEditor } from './mobile-web-file-editor'
import {
  MOBILE_WEB_FILE_DOCUMENT_MAX_BYTES,
  type MobileWebFileDocument
} from './mobile-web-file-document'
import { isMobileWebRasterImagePath } from './mobile-web-raster-image'
import { MobileWebRasterImagePreview } from './mobile-web-raster-image-preview'
import { MobileWebFileTextPreview } from './mobile-web-file-text-preview'
import type { MobileWebFilePreviewState } from './use-mobile-web-file-document'
import type { MobileWebFileEditorState } from './use-mobile-web-file-editor'

export function MobileWebFilePreview({
  preview,
  connected,
  editor,
  onLoadMore,
  onCancel,
  onBeginEdit,
  onEditChange,
  onSaveEdit,
  onCancelEdit
}: {
  preview: MobileWebFilePreviewState
  connected: boolean
  editor: MobileWebFileEditorState
  onLoadMore: () => void
  onCancel: () => void
  onBeginEdit: () => void
  onEditChange: (value: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
}): React.JSX.Element | null {
  if (preview.status === 'idle') {
    return null
  }
  const document = preview.document
  const relativePath =
    preview.status === 'loading' || preview.status === 'error'
      ? preview.relativePath
      : preview.document.relativePath

  return (
    <section className="border-t border-border" aria-label={`Preview ${relativePath}`}>
      <div className="flex items-center justify-between gap-3 px-6 py-2">
        <p className="truncate font-mono text-xs">{relativePath}</p>
        {document ? (
          <div className="flex shrink-0 items-center gap-2">
            <p className="text-[11px] text-muted-foreground">
              {document.bytes.byteLength.toLocaleString()} bytes loaded
            </p>
            {canEdit(document) && editor.status === 'idle' ? (
              <Button variant="outline" size="xs" disabled={!connected} onClick={onBeginEdit}>
                <Pencil />
                Edit
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {preview.status === 'loading' ? (
        <div
          role="status"
          className="flex items-center justify-between gap-3 border-t border-border px-6 py-2 text-xs text-muted-foreground"
        >
          <span className="flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" />
            Loading file content
          </span>
          <Button variant="ghost" size="xs" onClick={onCancel}>
            <X />
            Cancel
          </Button>
        </div>
      ) : null}
      {preview.status === 'error' ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-t border-border px-6 py-2 text-xs text-destructive"
        >
          <span>{fileErrorCopy(preview.error)}</span>
          {preview.error.retryable ? (
            <Button variant="outline" size="xs" disabled={!connected} onClick={onLoadMore}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
      {document ? (
        <>
          {editor.status !== 'idle' && editor.relativePath === document.relativePath ? (
            <MobileWebFileEditor
              editor={editor}
              connected={connected}
              onChange={onEditChange}
              onSave={onSaveEdit}
              onCancel={onCancelEdit}
            />
          ) : document.kind === 'binary' ? (
            isMobileWebRasterImagePath(document.relativePath) ? (
              <MobileWebRasterImagePreview document={document} />
            ) : (
              <p className="flex items-center gap-2 border-t border-border px-6 py-6 text-xs text-muted-foreground">
                <FileWarning className="size-4" />
                Binary preview is not available for this file type.
              </p>
            )
          ) : (
            <MobileWebFileTextPreview key={document.relativePath} document={document} />
          )}
          {editor.status === 'idle' && document.limitReached ? (
            <p className="border-t border-border bg-muted px-6 py-2 text-xs text-muted-foreground">
              Preview stopped at the {formatByteLimit(MOBILE_WEB_FILE_DOCUMENT_MAX_BYTES)} mobile
              document limit.
            </p>
          ) : null}
          {editor.status === 'idle' &&
          !document.eof &&
          !document.limitReached &&
          document.kind === 'text' ? (
            <div className="border-t border-border px-6 py-3">
              <Button
                variant="outline"
                size="sm"
                disabled={!connected || preview.status === 'loading'}
                onClick={onLoadMore}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

function canEdit(document: MobileWebFileDocument): boolean {
  return (
    document.kind === 'text' && document.eof && !document.limitReached && document.revision !== null
  )
}

function fileErrorCopy(error: MobileWebBridgeClientError): string {
  if (error.code === 'unsupported_capability') {
    return 'This Orca Mobile shell cannot stream file content.'
  }
  if (error.code === 'not_connected') {
    return 'Reconnect to the paired desktop to load this file.'
  }
  if (error.code === 'cancelled') {
    return 'File loading was cancelled.'
  }
  return 'The paired desktop could not provide this file.'
}

function formatByteLimit(bytes: number): string {
  return `${bytes / (1024 * 1024)} MiB`
}
