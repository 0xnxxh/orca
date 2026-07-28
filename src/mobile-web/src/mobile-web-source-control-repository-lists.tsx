import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { GitBranch, GitCommitHorizontal } from 'lucide-react'
import React from 'react'
import type {
  MobileWebSourceControlBranchesResult,
  MobileWebSourceControlHistoryItem,
  MobileWebSourceControlHistoryResult
} from '../../shared/mobile-web/source-control-history-contract'
import type { MobileWebRepositorySelection } from './use-mobile-web-source-control-repository'

const commitDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

export function MobileWebBranchList({
  result,
  loading,
  connected,
  selection,
  actionsDisabled,
  onCompare,
  onSwitch
}: {
  result: MobileWebSourceControlBranchesResult | null
  loading: boolean
  connected: boolean
  selection: MobileWebRepositorySelection | null
  actionsDisabled: boolean
  onCompare: (branch: string) => void
  onSwitch: (branch: string) => void
}): React.JSX.Element {
  if (!result) {
    return (
      <RepositoryListState>
        {loading ? 'Loading branches…' : offlineCopy(connected)}
      </RepositoryListState>
    )
  }
  if (result.branches.length === 0) {
    return <RepositoryListState>No local branches.</RepositoryListState>
  }
  return (
    <>
      <ul aria-label="Local branches" className="max-h-72 overflow-y-auto scrollbar-sleek">
        {result.branches.map((branch) => {
          const current = branch === result.current
          const selected = selection?.kind === 'branch' && selection.id === branch
          return (
            <li key={branch}>
              {current ? (
                <div
                  data-current="true"
                  className="flex min-h-9 items-center gap-2 bg-accent px-6 py-2 text-sm"
                >
                  <GitBranch className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{branch}</span>
                  <span className="text-xs text-muted-foreground">Current</span>
                </div>
              ) : (
                <div className={cn('flex items-center pr-2', selected && 'bg-accent')}>
                  <Button
                    aria-label={`Compare ${branch}`}
                    variant="ghost"
                    size="sm"
                    className="h-auto min-h-9 min-w-0 flex-1 justify-start rounded-none px-6 py-2"
                    data-current={selected ? 'true' : undefined}
                    aria-pressed={selected}
                    disabled={!connected || actionsDisabled}
                    onClick={() => onCompare(branch)}
                  >
                    <GitBranch className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-left font-mono text-xs">
                      {branch}
                    </span>
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={!connected || actionsDisabled}
                    onClick={() => onSwitch(branch)}
                  >
                    Switch
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {result.truncated ? (
        <p className="border-t border-border px-6 py-2 text-xs text-muted-foreground">
          Showing {result.branches.length.toLocaleString()} of {result.totalCount.toLocaleString()}{' '}
          local branches.
        </p>
      ) : null}
    </>
  )
}

export function MobileWebHistoryList({
  result,
  loading,
  connected,
  selection,
  canLoadMore,
  onCompare,
  onLoadMore
}: {
  result: MobileWebSourceControlHistoryResult | null
  loading: boolean
  connected: boolean
  selection: MobileWebRepositorySelection | null
  canLoadMore: boolean
  onCompare: (commit: MobileWebSourceControlHistoryItem) => void
  onLoadMore: () => void
}): React.JSX.Element {
  if (!result) {
    return (
      <RepositoryListState>
        {loading ? 'Loading history…' : offlineCopy(connected)}
      </RepositoryListState>
    )
  }
  if (result.items.length === 0) {
    return <RepositoryListState>No commits.</RepositoryListState>
  }
  return (
    <>
      <ul aria-label="Commit history" className="max-h-96 overflow-y-auto scrollbar-sleek">
        {result.items.map((commit) => (
          <li key={commit.id}>
            <Button
              variant="ghost"
              className={cn(
                'h-auto min-h-12 w-full justify-start rounded-none px-6 py-2 text-left',
                selection?.kind === 'commit' && selection.id === commit.id && 'bg-accent'
              )}
              data-current={
                selection?.kind === 'commit' && selection.id === commit.id ? 'true' : undefined
              }
              aria-pressed={selection?.kind === 'commit' && selection.id === commit.id}
              disabled={!connected}
              onClick={() => onCompare(commit)}
            >
              <GitCommitHorizontal className="size-4 shrink-0 self-start" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-normal">{commit.subject}</span>
                <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                  {commitMetadata(commit)}
                </span>
              </span>
            </Button>
          </li>
        ))}
      </ul>
      {canLoadMore ? (
        <div className="border-t border-border px-6 py-2">
          <Button
            variant="ghost"
            size="xs"
            className="w-full"
            disabled={!connected || loading}
            onClick={onLoadMore}
          >
            Load older commits
          </Button>
        </div>
      ) : result.hasMore ? (
        <p className="border-t border-border px-6 py-2 text-xs text-muted-foreground">
          Showing the newest {result.items.length.toLocaleString()} commits.
        </p>
      ) : null}
    </>
  )
}

function RepositoryListState({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="px-6 py-8 text-center text-sm text-muted-foreground">{children}</p>
}

function commitMetadata(commit: MobileWebSourceControlHistoryItem): string {
  const parts = [commit.displayId, commit.author, formattedCommitDate(commit.timestamp)]
  return parts.filter((value): value is string => Boolean(value)).join(' · ')
}

function formattedCommitDate(timestamp: number | undefined): string | undefined {
  if (timestamp === undefined) {
    return undefined
  }
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? undefined : commitDate.format(date)
}

function offlineCopy(connected: boolean): string {
  return connected ? 'Repository data is unavailable.' : 'Reconnect to load repository data.'
}
