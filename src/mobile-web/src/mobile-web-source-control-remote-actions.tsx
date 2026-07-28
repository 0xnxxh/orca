import { Button } from '@renderer/components/ui/button'
import { Loader2 } from 'lucide-react'
import React from 'react'
import type { MobileWebSourceControlSync } from './use-mobile-web-source-control-sync'

export function MobileWebSourceControlRemoteActions({
  sync,
  connected
}: {
  sync: MobileWebSourceControlSync
  connected: boolean
}): React.JSX.Element {
  const repository = sync.repository
  const upstream = repository?.upstream
  const conflict = repository?.conflictOperation
  const blocked = !connected || sync.loading || sync.busy !== null || !repository
  const hasConflict = conflict !== undefined && conflict !== 'unknown'
  const canPull = !hasConflict && upstream?.hasUpstream === true && upstream.behind > 0
  const canPush =
    !hasConflict &&
    upstream !== undefined &&
    repository?.head !== null &&
    repository?.branch !== null &&
    (upstream.hasUpstream ? upstream.ahead > 0 : true)
  const canAbort = conflict === 'merge' || conflict === 'rebase'

  return (
    <section aria-label="Remote repository actions" className="border-y border-border px-6 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Remote</h3>
          <p className="mt-1 truncate text-xs text-muted-foreground">{remoteDescription(sync)}</p>
        </div>
        {sync.loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2" aria-busy={sync.busy !== null}>
        <ActionButton
          label="Fetch"
          busy={sync.busy === 'fetch'}
          disabled={blocked}
          onClick={() => void sync.fetch()}
        />
        <ActionButton
          label={upstream?.behind ? `Pull ${upstream.behind}` : 'Pull'}
          busy={sync.busy === 'pull'}
          disabled={blocked || !canPull}
          onClick={sync.requestPull}
        />
        <ActionButton
          label={
            upstream && !upstream.hasUpstream && !upstream.hasConfiguredPushTarget
              ? 'Publish'
              : upstream?.ahead
                ? `Push ${upstream.ahead}`
                : 'Push'
          }
          busy={sync.busy === 'push'}
          disabled={blocked || !canPush}
          onClick={sync.requestPush}
        />
        <ActionButton
          label="Rebase"
          busy={sync.busy === 'rebase'}
          disabled={blocked || hasConflict || !repository?.baseRef || !repository.head}
          onClick={sync.requestRebase}
        />
        {canAbort ? (
          <ActionButton
            label={`Abort ${conflict}`}
            busy={sync.busy === 'abort'}
            disabled={blocked}
            onClick={sync.requestAbort}
          />
        ) : null}
      </div>
      {sync.error ? (
        <div
          role="alert"
          className="mt-3 flex items-center justify-between gap-3 text-xs text-destructive"
        >
          <span>{remoteErrorCopy(sync.error.code)}</span>
          <Button variant="ghost" size="xs" onClick={sync.clearError}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function ActionButton({
  label,
  busy,
  disabled,
  onClick
}: {
  label: string
  busy: boolean
  disabled: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <Button variant="outline" size="xs" disabled={disabled} onClick={onClick}>
      {busy ? <Loader2 className="animate-spin" /> : null}
      {label}
    </Button>
  )
}

function remoteDescription(sync: MobileWebSourceControlSync): string {
  const repository = sync.repository
  if (!repository) {
    return sync.loading ? 'Checking upstream state' : 'Upstream state unavailable'
  }
  if (repository.conflictOperation !== 'unknown') {
    return `${repository.conflictOperation} in progress`
  }
  const upstream = repository.upstream
  if (!upstream.hasUpstream) {
    return upstream.hasConfiguredPushTarget ? 'Configured push target' : 'No tracked upstream'
  }
  const target = upstream.upstreamName ?? 'Configured upstream'
  return `${target} · ↓${upstream.behind.toLocaleString()} ↑${upstream.ahead.toLocaleString()}`
}

function remoteErrorCopy(code: string): string {
  if (code === 'conflict') {
    return 'The repository changed. Review the refreshed state before trying again.'
  }
  if (code === 'not_connected') {
    return 'Reconnect before changing the repository.'
  }
  return 'The paired Desktop could not complete the repository action.'
}
