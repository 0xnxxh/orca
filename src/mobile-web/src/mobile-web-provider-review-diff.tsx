import { Button } from '@renderer/components/ui/button'
import { FileWarning, Loader2, X } from 'lucide-react'
import React from 'react'
import type { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'
import { MobileWebDiffRows } from './mobile-web-source-control-diff'
import type { useMobileWebProviderReviewDiff } from './use-mobile-web-provider-review-diff'

type ReviewDiffState = ReturnType<typeof useMobileWebProviderReviewDiff>

export function MobileWebProviderReviewDiff({
  diff,
  connected
}: {
  diff: ReviewDiffState
  connected: boolean
}): React.JSX.Element | null {
  if (!diff.file) {
    return null
  }
  return (
    <section className="space-y-0 border-t border-border pt-4" aria-label="Hosted review diff">
      <div className="flex items-center justify-between gap-3 pb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Review diff</h3>
          <p className="truncate font-mono text-xs text-muted-foreground">{diff.file.path}</p>
        </div>
        <Button variant="ghost" size="icon-xs" aria-label="Close review diff" onClick={diff.close}>
          <X />
        </Button>
      </div>
      {diff.loading ? (
        <div
          role="status"
          className="flex items-center justify-between gap-3 border border-border px-3 py-2 text-xs text-muted-foreground"
        >
          <span className="flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" />
            Loading review diff
          </span>
          <Button variant="ghost" size="xs" onClick={diff.cancel}>
            <X />
            Cancel
          </Button>
        </div>
      ) : null}
      {diff.error ? (
        <ReviewDiffError
          error={diff.error}
          connected={connected}
          loading={diff.loading}
          onRetry={diff.retry}
        />
      ) : null}
      {diff.document?.kind === 'binary' ? (
        <p className="flex items-center gap-2 border border-border px-3 py-6 text-xs text-muted-foreground">
          <FileWarning className="size-4" />
          Binary review diff preview is unavailable.
        </p>
      ) : null}
      {diff.document?.kind === 'too-large' ? (
        <p className="border border-border px-3 py-6 text-xs text-muted-foreground">
          This review diff exceeds the bounded mobile preview.
          {diff.document.characterCount === undefined
            ? ''
            : ` ${diff.document.characterCount.toLocaleString()} characters were reported.`}
        </p>
      ) : null}
      {diff.document?.kind === 'text' ? (
        <>
          <p className="border-x border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            {diff.document.rows.length.toLocaleString()} of{' '}
            {diff.document.totalRows.toLocaleString()} rows
          </p>
          <MobileWebDiffRows
            document={diff.document}
            connected={connected}
            loading={diff.loading}
            onLoadMore={diff.loadMore}
            focusRowIndex={diff.document.focusRowIndex}
          />
        </>
      ) : null}
    </section>
  )
}

function ReviewDiffError({
  error,
  connected,
  loading,
  onRetry
}: {
  error: MobileWebBridgeClientError
  connected: boolean
  loading: boolean
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 border border-border px-3 py-2 text-xs text-destructive"
    >
      <span>{reviewDiffErrorCopy(error)}</span>
      {error.retryable || error.code === 'conflict' ? (
        <Button variant="outline" size="xs" disabled={!connected || loading} onClick={onRetry}>
          Reload
        </Button>
      ) : null}
    </div>
  )
}

function reviewDiffErrorCopy(error: MobileWebBridgeClientError): string {
  if (error.code === 'conflict') {
    return 'The repository or hosted review changed. Refresh before loading this diff.'
  }
  if (error.code === 'not_connected') {
    return 'Reconnect to the paired desktop to load this review diff.'
  }
  if (error.code === 'unsupported_capability') {
    return 'This Orca Mobile shell does not expose hosted-review diffs.'
  }
  return 'The paired desktop could not provide this review diff.'
}
