import { useVirtualizer } from '@tanstack/react-virtual'
import { Button } from '@renderer/components/ui/button'
import { FileWarning, Loader2, X } from 'lucide-react'
import React, { useEffect, useRef } from 'react'
import type { MobileWebSourceControlStatusEntry } from '../../shared/mobile-web/source-control-operation-contract'
import type { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'
import type { MobileWebDiffDocument } from './use-mobile-web-diff-document'

const DIFF_ROW_HEIGHT = 24

export function MobileWebSourceControlDiff({
  entry,
  document,
  loading,
  error,
  connected,
  onLoadMore,
  onRetry,
  onCancel
}: {
  entry: MobileWebSourceControlStatusEntry | null
  document: MobileWebDiffDocument | null
  loading: boolean
  error: MobileWebBridgeClientError | null
  connected: boolean
  onLoadMore: () => void
  onRetry: () => void
  onCancel: () => void
}): React.JSX.Element | null {
  if (!entry) {
    return null
  }
  return (
    <section className="border-t border-border" aria-label={`Diff ${entry.relativePath}`}>
      <div className="flex items-center justify-between gap-3 px-6 py-2">
        <p className="truncate font-mono text-xs">{entry.relativePath}</p>
        {document?.kind === 'text' ? (
          <p className="shrink-0 text-[11px] text-muted-foreground">
            {document.rows.length.toLocaleString()} of {document.totalRows.toLocaleString()} rows
          </p>
        ) : null}
      </div>
      {loading ? (
        <div
          role="status"
          className="flex items-center justify-between gap-3 border-t border-border px-6 py-2 text-xs text-muted-foreground"
        >
          <span className="flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" />
            Loading diff
          </span>
          <Button variant="ghost" size="xs" onClick={onCancel}>
            <X />
            Cancel
          </Button>
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-t border-border px-6 py-2 text-xs text-destructive"
        >
          <span>{diffErrorCopy(error)}</span>
          {error.retryable || error.code === 'conflict' ? (
            <Button variant="outline" size="xs" disabled={!connected} onClick={onRetry}>
              Reload
            </Button>
          ) : null}
        </div>
      ) : null}
      {document?.kind === 'binary' ? (
        <p className="flex items-center gap-2 border-t border-border px-6 py-6 text-xs text-muted-foreground">
          <FileWarning className="size-4" />
          Binary diff preview is not available yet.
        </p>
      ) : null}
      {document?.kind === 'too-large' ? (
        <p className="border-t border-border px-6 py-6 text-xs text-muted-foreground">
          This diff exceeds the bounded mobile preview.
          {document.characterCount === undefined
            ? ''
            : ` ${document.characterCount.toLocaleString()} characters were reported.`}
        </p>
      ) : null}
      {document?.kind === 'text' ? (
        <MobileWebDiffRows
          document={document}
          connected={connected}
          loading={loading}
          onLoadMore={onLoadMore}
        />
      ) : null}
    </section>
  )
}

export function MobileWebDiffRows({
  document,
  connected,
  loading,
  onLoadMore,
  focusRowIndex
}: {
  document: Extract<MobileWebDiffDocument, { kind: 'text' }>
  connected: boolean
  loading: boolean
  onLoadMore: () => void
  focusRowIndex?: number
}): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: document.rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => DIFF_ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => document.rows[index]?.index ?? index
  })
  useEffect(() => {
    if (focusRowIndex === undefined) {
      return
    }
    const localIndex = document.rows.findIndex((row) => row.index === focusRowIndex)
    if (localIndex >= 0) {
      virtualizer.scrollToIndex(localIndex, { align: 'center' })
    }
  }, [document.rows, focusRowIndex, virtualizer])

  return (
    <>
      <div
        ref={viewportRef}
        role="list"
        aria-label="Diff rows"
        aria-setsize={document.totalRows}
        className="max-h-[32rem] overflow-auto border-t border-border bg-editor-surface font-mono text-xs scrollbar-editor"
      >
        <div className="relative min-w-max" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = document.rows[virtualRow.index]
            if (!row) {
              return null
            }
            const focused = row.index === focusRowIndex
            return (
              <div
                key={row.index}
                role="listitem"
                aria-posinset={row.index + 1}
                aria-current={focused || undefined}
                data-diff-row-index={row.index}
                data-focused={focused || undefined}
                className={`absolute left-0 top-0 flex h-6 min-w-full items-center ${
                  focused ? 'bg-accent ring-1 ring-inset ring-ring' : ''
                }`}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <span className="w-10 shrink-0 pr-2 text-right text-muted-foreground">
                  {row.oldLineNumber ?? ''}
                </span>
                <span className="w-10 shrink-0 pr-2 text-right text-muted-foreground">
                  {row.newLineNumber ?? ''}
                </span>
                <span className={diffMarkerClass(row.kind)}>{diffMarker(row.kind)}</span>
                <span className="pr-4 whitespace-pre">
                  {row.text}
                  {row.textTruncated ? '…' : ''}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      {document.truncated ? (
        <p className="border-t border-border bg-muted px-6 py-2 text-xs text-muted-foreground">
          Diff preview is capped at 4,000 rows.
        </p>
      ) : null}
      {document.retentionLimitReached ? (
        <p className="border-t border-border bg-muted px-6 py-2 text-xs text-muted-foreground">
          Diff loading stopped at the 1,000,000-character retained-state limit.
        </p>
      ) : null}
      {document.nextOffset !== null ? (
        <div className="border-t border-border px-6 py-3">
          <Button variant="outline" size="sm" disabled={!connected || loading} onClick={onLoadMore}>
            Load more diff
          </Button>
        </div>
      ) : null}
    </>
  )
}

function diffMarker(kind: 'context' | 'add' | 'delete'): string {
  return kind === 'add' ? '+' : kind === 'delete' ? '−' : ' '
}

function diffMarkerClass(kind: 'context' | 'add' | 'delete'): string {
  const color =
    kind === 'add'
      ? 'text-[color:var(--git-decoration-added)]'
      : kind === 'delete'
        ? 'text-[color:var(--git-decoration-deleted)]'
        : 'text-muted-foreground'
  return `w-5 shrink-0 text-center ${color}`
}

function diffErrorCopy(error: MobileWebBridgeClientError): string {
  if (error.code === 'conflict') {
    return 'This diff changed while more rows were loading.'
  }
  if (error.code === 'not_connected') {
    return 'Reconnect to the paired desktop to load this diff.'
  }
  if (error.code === 'unsupported_capability') {
    return 'This Orca Mobile shell does not expose source-control diffs.'
  }
  return 'The paired desktop could not provide this diff.'
}
