import React from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { WorkspaceCleanupScanProgress } from '../../../../shared/workspace-cleanup'
import { formatWorkspaceCleanupScanProgress } from './workspace-cleanup-scan-notice'

export function WorkspaceCleanupInitialScanBanner({
  progress
}: {
  progress: WorkspaceCleanupScanProgress | null
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 border-b border-border bg-muted/25 px-5 py-3">
      <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-xs font-medium text-foreground">
          {translate(
            'auto.components.workspace.cleanup.WorkspaceCleanupDialog.7eee951968',
            'Checking inactive workspaces'
          )}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {translate(
            'auto.components.workspace.cleanup.WorkspaceCleanupDialog.47123d0108',
            'Scanning inactive workspaces. You can close this and come back.'
          )}
        </div>
        <div className="mt-1 text-xs font-medium text-muted-foreground">
          {formatWorkspaceCleanupScanProgress(progress)}
        </div>
      </div>
    </div>
  )
}

export function WorkspaceCleanupNotice({
  tone = 'muted',
  message
}: {
  tone?: 'muted' | 'destructive'
  message: string
}): React.JSX.Element {
  if (tone === 'destructive') {
    return (
      <div className="border-b border-destructive/30 bg-destructive/10 px-5 py-2 text-xs text-destructive">
        {message}
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2 border-b border-border bg-muted/25 px-5 py-2 text-xs text-muted-foreground">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

export function WorkspaceCleanupEmptyState({
  title,
  description,
  actionLabel,
  onAction
}: {
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
}): React.JSX.Element {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-muted/20 px-6 text-center text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{title}</span>
      {description ? <span className="text-xs">{description}</span> : null}
      {actionLabel && onAction ? (
        <Button variant="outline" size="sm" className="mt-1" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}

export function WorkspaceCleanupSkeletonRows(): React.JSX.Element {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="h-24 animate-pulse rounded-lg border border-border bg-muted/35"
        />
      ))}
    </div>
  )
}
