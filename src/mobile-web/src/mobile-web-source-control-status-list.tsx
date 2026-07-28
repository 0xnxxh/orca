import { Button } from '@renderer/components/ui/button'
import { FileDiff, Loader2 } from 'lucide-react'
import React from 'react'
import type { MobileWebSourceControlStatusEntry } from '../../shared/mobile-web/source-control-operation-contract'
import type { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'
import {
  eligibleMutationEntries,
  type MobileWebSourceControlMutations
} from './use-mobile-web-source-control-mutations'

export function MobileWebSourceControlStatusList({
  entries,
  loading,
  error,
  connected,
  selected,
  mutations,
  externalBusy,
  onOpen,
  onRetry
}: {
  entries: MobileWebSourceControlStatusEntry[] | null
  loading: boolean
  error: MobileWebBridgeClientError | null
  connected: boolean
  selected: MobileWebSourceControlStatusEntry | null
  mutations: MobileWebSourceControlMutations
  externalBusy: boolean
  onOpen: (entry: MobileWebSourceControlStatusEntry) => void
  onRetry: () => void
}): React.JSX.Element {
  if (error && !entries) {
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 border-t border-border px-6 py-3 text-xs text-destructive"
      >
        <span>{statusErrorCopy(error)}</span>
        {error.retryable ? (
          <Button variant="outline" size="xs" disabled={!connected} onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    )
  }
  if (!entries) {
    return (
      <div className="flex min-h-24 items-center justify-center border-t border-border">
        {loading ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : null}
      </div>
    )
  }
  if (entries.length === 0) {
    return (
      <p className="border-t border-border px-6 py-8 text-center text-xs text-muted-foreground">
        No uncommitted changes.
      </p>
    )
  }
  return (
    <>
      <MutationToolbar
        entries={entries}
        connected={connected}
        mutations={mutations}
        externalBusy={externalBusy}
      />
      {mutations.error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-t border-border px-6 py-2 text-xs text-destructive"
        >
          <span>{mutationErrorCopy(mutations.error)}</span>
          <Button variant="ghost" size="xs" onClick={mutations.clearError}>
            Dismiss
          </Button>
        </div>
      ) : null}
      <ul className="border-t border-border">
        {entries.map((entry) => (
          <StatusRow
            key={`${entry.area}:${entry.relativePath}`}
            entry={entry}
            connected={connected}
            current={selected?.area === entry.area && selected.relativePath === entry.relativePath}
            mutations={mutations}
            externalBusy={externalBusy}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </>
  )
}

function MutationToolbar({
  entries,
  connected,
  mutations,
  externalBusy
}: {
  entries: MobileWebSourceControlStatusEntry[]
  connected: boolean
  mutations: MobileWebSourceControlMutations
  externalBusy: boolean
}): React.JSX.Element | null {
  const stageable = eligibleMutationEntries(entries, 'stage')
  const unstageable = eligibleMutationEntries(entries, 'unstage')
  const discardable = eligibleMutationEntries(entries, 'discard')
  const busy = mutations.busyOperation !== null || externalBusy
  if (stageable.length < 2 && unstageable.length < 2 && discardable.length < 2) {
    return null
  }
  return (
    <div
      aria-label="Bulk source control actions"
      className="flex flex-wrap gap-2 border-t border-border px-6 py-2"
    >
      {stageable.length > 1 ? (
        <Button
          variant="outline"
          size="xs"
          disabled={!connected || busy}
          onClick={() => void mutations.stage(stageable)}
        >
          {mutations.busyOperation === 'stage' ? <Loader2 className="animate-spin" /> : null}
          Stage {stageable.length}
        </Button>
      ) : null}
      {unstageable.length > 1 ? (
        <Button
          variant="outline"
          size="xs"
          disabled={!connected || busy}
          onClick={() => void mutations.unstage(unstageable)}
        >
          {mutations.busyOperation === 'unstage' ? <Loader2 className="animate-spin" /> : null}
          Unstage {unstageable.length}
        </Button>
      ) : null}
      {discardable.length > 1 ? (
        <Button
          variant="destructive"
          size="xs"
          disabled={!connected || busy}
          onClick={() => mutations.requestDiscard(discardable)}
        >
          Discard {discardable.length}
        </Button>
      ) : null}
    </div>
  )
}

function StatusRow({
  entry,
  connected,
  current,
  mutations,
  externalBusy,
  onOpen
}: {
  entry: MobileWebSourceControlStatusEntry
  connected: boolean
  current: boolean
  mutations: MobileWebSourceControlMutations
  externalBusy: boolean
  onOpen: (entry: MobileWebSourceControlStatusEntry) => void
}): React.JSX.Element {
  const unresolved = entry.conflictStatus === 'unresolved'
  const busy = mutations.busyOperation !== null || externalBusy
  const rowBusy = mutations.isBusyPath(entry.relativePath)
  return (
    <li className="flex items-center border-b border-border pr-2 last:border-b-0">
      <Button
        variant="ghost"
        data-current={current ? 'true' : undefined}
        aria-label={`Open diff for ${entry.relativePath}`}
        className="h-auto min-w-0 flex-1 justify-start rounded-none px-6 py-2 text-left data-[current=true]:bg-accent"
        disabled={!connected || unresolved}
        onClick={() => onOpen(entry)}
      >
        <FileDiff className={statusColorClass(entry.status)} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-xs">{entry.relativePath}</span>
          <span className="block text-[11px] text-muted-foreground">
            {areaLabel(entry.area)}
            {unresolved ? ' · Resolve the conflict on Desktop' : ''}
          </span>
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{lineStats(entry)}</span>
      </Button>
      {!unresolved ? (
        <div className="flex shrink-0 gap-1 pl-1">
          {entry.area === 'staged' ? (
            <Button
              variant="outline"
              size="xs"
              className="w-20"
              disabled={!connected || busy}
              onClick={() => void mutations.unstage([entry])}
            >
              {rowBusy ? <Loader2 className="animate-spin" /> : null}
              Unstage
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="xs"
                className="w-16"
                disabled={!connected || busy}
                onClick={() => void mutations.stage([entry])}
              >
                {rowBusy && mutations.busyOperation === 'stage' ? (
                  <Loader2 className="animate-spin" />
                ) : null}
                Stage
              </Button>
              <Button
                variant="destructive"
                size="xs"
                className="w-20"
                disabled={!connected || busy}
                onClick={() => mutations.requestDiscard([entry])}
              >
                Discard
              </Button>
            </>
          )}
        </div>
      ) : null}
    </li>
  )
}

function lineStats(entry: MobileWebSourceControlStatusEntry): string {
  if (entry.added === undefined && entry.removed === undefined) {
    return statusLabel(entry.status)
  }
  return `+${entry.added ?? 0} −${entry.removed ?? 0}`
}

function statusLabel(status: MobileWebSourceControlStatusEntry['status']): string {
  return { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', copied: 'C' }[
    status
  ]
}

function areaLabel(area: MobileWebSourceControlStatusEntry['area']): string {
  return area === 'staged' ? 'Staged' : area === 'untracked' ? 'Untracked' : 'Changes'
}

function statusColorClass(status: MobileWebSourceControlStatusEntry['status']): string {
  const classes = {
    added: 'text-[color:var(--git-decoration-added)]',
    deleted: 'text-[color:var(--git-decoration-deleted)]',
    renamed: 'text-[color:var(--git-decoration-renamed)]',
    untracked: 'text-[color:var(--git-decoration-untracked)]',
    copied: 'text-[color:var(--git-decoration-copied)]',
    modified: 'text-[color:var(--git-decoration-modified)]'
  }
  return classes[status]
}

function statusErrorCopy(error: MobileWebBridgeClientError): string {
  if (error.code === 'not_connected') {
    return 'Reconnect to refresh source control.'
  }
  if (error.code === 'unsupported_capability') {
    return 'This Orca Mobile shell does not expose source control.'
  }
  return 'The paired desktop could not load source control.'
}

function mutationErrorCopy(error: MobileWebBridgeClientError): string {
  if (error.code === 'conflict') {
    return 'The repository changed. Review the refreshed status before trying again.'
  }
  if (error.code === 'not_connected') {
    return 'Reconnect before changing source control.'
  }
  return 'The paired desktop could not complete the source-control action.'
}
