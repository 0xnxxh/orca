import { Button } from '@renderer/components/ui/button'
import { ChevronRight, File, FileSymlink, Folder, Loader2 } from 'lucide-react'
import React from 'react'
import type { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'
import { joinMobileWebFilePath, mobileWebFileBreadcrumbs } from './mobile-web-file-path'
import type { MobileWebDirectoryView } from './use-mobile-web-file-directory'

export function MobileWebFileDirectory({
  directory,
  connected,
  onNavigate,
  onOpenFile,
  onRetry
}: {
  directory: MobileWebDirectoryView
  connected: boolean
  onNavigate: (relativePath: string) => void
  onOpenFile: (relativePath: string) => void
  onRetry: () => void
}): React.JSX.Element {
  const breadcrumbs = mobileWebFileBreadcrumbs(directory.relativePath)
  return (
    <section aria-label="Workspace files">
      <nav
        aria-label="File path"
        className="flex min-h-10 items-center gap-1 overflow-x-auto border-t border-border px-4 py-1 scrollbar-sleek"
      >
        {breadcrumbs.map((breadcrumb, index) => (
          <React.Fragment key={breadcrumb.relativePath || 'root'}>
            {index > 0 ? (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            ) : null}
            {index === breadcrumbs.length - 1 ? (
              <span className="max-w-48 truncate px-2 text-xs font-medium" aria-current="page">
                {breadcrumb.label}
              </span>
            ) : (
              <Button
                variant="ghost"
                size="xs"
                className="max-w-48 shrink-0"
                disabled={!connected}
                onClick={() => onNavigate(breadcrumb.relativePath)}
              >
                <span className="truncate">{breadcrumb.label}</span>
              </Button>
            )}
          </React.Fragment>
        ))}
        {directory.loading ? (
          <Loader2 className="ml-auto size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : null}
      </nav>
      {directory.error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-t border-border px-6 py-3 text-xs text-destructive"
        >
          <span>{directoryErrorCopy(directory.error)}</span>
          {directory.error.retryable ? (
            <Button variant="outline" size="xs" disabled={!connected} onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
      <DirectoryEntries
        directory={directory}
        connected={connected}
        onNavigate={onNavigate}
        onOpenFile={onOpenFile}
      />
    </section>
  )
}

function DirectoryEntries({
  directory,
  connected,
  onNavigate,
  onOpenFile
}: {
  directory: MobileWebDirectoryView
  connected: boolean
  onNavigate: (relativePath: string) => void
  onOpenFile: (relativePath: string) => void
}): React.JSX.Element | null {
  const result = directory.result
  if (!result) {
    return null
  }
  if (result.entries.length === 0) {
    return (
      <p className="border-t border-border px-6 py-8 text-center text-xs text-muted-foreground">
        This folder is empty.
      </p>
    )
  }
  return (
    <>
      <ul
        key={result.revision}
        data-directory-revision={result.revision}
        className="border-t border-border"
      >
        {result.entries.map((entry) => {
          const relativePath = joinMobileWebFilePath(result.relativePath, entry.name)
          return (
            <li key={entry.name} className="border-b border-border last:border-b-0">
              <Button
                variant="ghost"
                className="h-auto w-full justify-start rounded-none px-6 py-2 text-left"
                disabled={!connected || entry.isSymlink}
                onClick={() =>
                  entry.isDirectory ? onNavigate(relativePath) : onOpenFile(relativePath)
                }
              >
                {entry.isSymlink ? <FileSymlink /> : entry.isDirectory ? <Folder /> : <File />}
                <span className="min-w-0 truncate text-xs font-medium">{entry.name}</span>
                {entry.isSymlink ? (
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    Link unavailable
                  </span>
                ) : null}
              </Button>
            </li>
          )
        })}
      </ul>
      {result.truncated ? (
        <p className="border-t border-border bg-muted px-6 py-2 text-xs text-muted-foreground">
          This folder exceeds the 128-entry mobile listing limit.
        </p>
      ) : null}
    </>
  )
}

function directoryErrorCopy(error: MobileWebBridgeClientError): string {
  if (error.code === 'unsupported_capability') {
    return 'This Orca Mobile shell cannot browse folders.'
  }
  if (error.code === 'not_connected') {
    return 'Reconnect to the paired desktop to browse folders.'
  }
  return 'The paired desktop could not provide this folder.'
}
