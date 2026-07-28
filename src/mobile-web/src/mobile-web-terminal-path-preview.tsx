import { Button } from '@renderer/components/ui/button'
import { FileWarning, Loader2, X } from 'lucide-react'
import React from 'react'
import type { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'
import { MobileWebFileTextPreview } from './mobile-web-file-text-preview'
import { MobileWebRasterImagePreview } from './mobile-web-raster-image-preview'
import type { MobileWebTerminalPathPreviewState } from './use-mobile-web-terminal-path-preview'

export function MobileWebTerminalPathPreview({
  preview,
  onClose
}: {
  preview: MobileWebTerminalPathPreviewState
  onClose: () => void
}): React.JSX.Element | null {
  if (preview.status === 'idle') {
    return null
  }
  const target = preview.status === 'resolving' ? null : preview.target
  const document =
    preview.status === 'loading' || preview.status === 'ready' ? preview.document : null
  const title =
    target?.kind === 'worktree-file'
      ? target.relativePath
      : (target?.displayName ?? 'Terminal file')

  return (
    <section className="border-t border-border" aria-label={`Terminal file preview: ${title}`}>
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs">{title}</p>
          {target && (target.line !== null || target.column !== null) ? (
            <p className="text-[11px] text-muted-foreground">
              {terminalLocationCopy(target.line, target.column)}
            </p>
          ) : null}
        </div>
        <Button variant="ghost" size="icon-xs" onClick={onClose}>
          <X />
          <span className="sr-only">Close terminal file preview</span>
        </Button>
      </div>
      {preview.status === 'resolving' || preview.status === 'loading' ? (
        <p
          role="status"
          className="flex items-center gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground"
        >
          <Loader2 className="size-3.5 animate-spin" />
          {preview.status === 'resolving' ? 'Resolving terminal file' : 'Loading file content'}
        </p>
      ) : null}
      {preview.status === 'error' ? (
        <p
          role="alert"
          className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs text-destructive"
        >
          <FileWarning className="size-4" />
          {terminalPreviewErrorCopy(preview.error)}
        </p>
      ) : null}
      {document ? (
        document.kind === 'binary' ? (
          target?.previewKind === 'raster' ? (
            <MobileWebRasterImagePreview document={document} />
          ) : (
            <p className="flex items-center gap-2 border-t border-border px-4 py-4 text-xs text-muted-foreground">
              <FileWarning className="size-4" />
              Binary preview is unavailable for this terminal file.
            </p>
          )
        ) : (
          <MobileWebFileTextPreview key={title} document={document} />
        )
      ) : null}
    </section>
  )
}

function terminalLocationCopy(line: number | null, column: number | null): string {
  if (line !== null && column !== null) {
    return `Line ${line}, column ${column}`
  }
  return line !== null ? `Line ${line}` : `Column ${column}`
}

function terminalPreviewErrorCopy(error: MobileWebBridgeClientError): string {
  if (error.code === 'not_found') {
    return 'This terminal file is no longer available.'
  }
  if (error.code === 'too_large') {
    return 'This terminal file exceeds the mobile preview limit.'
  }
  if (error.code === 'not_connected') {
    return 'Reconnect to the paired desktop to open this terminal file.'
  }
  if (error.code === 'unsupported_capability') {
    return 'Update Orca Desktop and Mobile to preview terminal files.'
  }
  return 'The paired desktop could not provide this terminal file.'
}
