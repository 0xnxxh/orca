import { Button } from '@renderer/components/ui/button'
import { Loader2 } from 'lucide-react'
import React from 'react'
import type { MobileWebSourceControlCompareEntry } from '../../shared/mobile-web/source-control-history-contract'
import type { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'
import type {
  MobileWebRepositoryComparison,
  MobileWebRepositorySelection
} from './use-mobile-web-source-control-repository'

export function MobileWebSourceControlCompare({
  selection,
  comparison,
  loading,
  error,
  connected,
  onRetry
}: {
  selection: MobileWebRepositorySelection | null
  comparison: MobileWebRepositoryComparison | null
  loading: boolean
  error: MobileWebBridgeClientError | null
  connected: boolean
  onRetry: () => void
}): React.JSX.Element | null {
  if (!selection) {
    return null
  }
  return (
    <section aria-label="Repository comparison" className="border-t border-border">
      <div className="flex items-start justify-between gap-3 px-6 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{comparisonTitle(selection)}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {comparisonDescription(comparison, loading, error)}
          </p>
        </div>
        {loading ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : null}
      </div>
      {error ? (
        <div className="px-6 pb-3">
          <Button variant="outline" size="xs" disabled={!connected} onClick={onRetry}>
            Retry comparison
          </Button>
        </div>
      ) : null}
      {comparison?.status === 'ready' ? <CompareEntries entries={comparison.entries} /> : null}
      {comparison?.truncated ? (
        <p className="border-t border-border px-6 py-2 text-xs text-muted-foreground">
          Showing {comparison.entries.length.toLocaleString()} of{' '}
          {comparison.changedFiles.toLocaleString()} changed files.
        </p>
      ) : null}
    </section>
  )
}

function CompareEntries({
  entries
}: {
  entries: MobileWebSourceControlCompareEntry[]
}): React.JSX.Element {
  if (entries.length === 0) {
    return <p className="px-6 pb-4 text-sm text-muted-foreground">No file changes.</p>
  }
  return (
    <ul aria-label="Comparison files" className="max-h-72 overflow-y-auto scrollbar-sleek">
      {entries.map((entry) => (
        <li
          key={`${entry.status}:${entry.oldRelativePath ?? ''}:${entry.relativePath}`}
          className="flex min-h-8 items-center gap-2 border-t border-border/50 px-6 py-1.5 text-xs"
        >
          <span className="w-4 shrink-0 font-mono text-muted-foreground">
            {statusLabel(entry.status)}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono">{entry.relativePath}</span>
          <span className="shrink-0 font-mono">
            {entry.added ? (
              <span className="text-[var(--git-decoration-added)]">+{entry.added} </span>
            ) : null}
            {entry.removed ? (
              <span className="text-[var(--git-decoration-deleted)]">-{entry.removed}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

function comparisonTitle(selection: MobileWebRepositorySelection): string {
  return selection.kind === 'branch' ? `Changes from ${selection.label}` : selection.label
}

function comparisonDescription(
  comparison: MobileWebRepositoryComparison | null,
  loading: boolean,
  error: MobileWebBridgeClientError | null
): string {
  if (loading) {
    return 'Loading provider-neutral comparison'
  }
  if (error) {
    return 'Comparison is unavailable.'
  }
  if (!comparison) {
    return 'Select a branch or commit to compare.'
  }
  if (comparison.status !== 'ready') {
    return comparisonStatusCopy(comparison.status)
  }
  const fileCopy = `${comparison.changedFiles.toLocaleString()} ${
    comparison.changedFiles === 1 ? 'changed file' : 'changed files'
  }`
  return 'commitsAhead' in comparison && comparison.commitsAhead !== undefined
    ? `${comparison.commitsAhead.toLocaleString()} commits ahead · ${fileCopy}`
    : fileCopy
}

function comparisonStatusCopy(status: MobileWebRepositoryComparison['status']): string {
  if (status === 'invalid-base') {
    return 'The selected branch cannot be resolved.'
  }
  if (status === 'unborn-head') {
    return 'The current branch does not have a committed HEAD.'
  }
  if (status === 'no-merge-base') {
    return 'The branches do not share a merge base.'
  }
  if (status === 'invalid-commit') {
    return 'The selected commit cannot be resolved.'
  }
  return 'Comparison is unavailable.'
}

function statusLabel(status: MobileWebSourceControlCompareEntry['status']): string {
  const labels = {
    modified: 'M',
    added: 'A',
    deleted: 'D',
    renamed: 'R',
    copied: 'C'
  } as const
  return labels[status]
}
