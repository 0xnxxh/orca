import { Button } from '@renderer/components/ui/button'
import {
  CardAction,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { GitBranch, Loader2, RefreshCw, TerminalSquare } from 'lucide-react'
import React, { useCallback, useEffect, useState } from 'react'
import type {
  MobileWebWorkspaceSnapshotResult,
  MobileWebWorkspaceSummary
} from '../../shared/mobile-web/bridge-operation-contract'
import { MobileWebBridgeClientError, type MobileWebBridgeClient } from './mobile-web-bridge-client'
import type { MobileWebNativeShellState } from './native-shell-channel'

type WorkspaceRequestState = {
  client: MobileWebBridgeClient | null
  loading: boolean
  snapshot: MobileWebWorkspaceSnapshotResult | null
  error: MobileWebBridgeClientError | null
}

export function MobileWebWorkspaces({
  client,
  connection,
  onOpen
}: Pick<MobileWebNativeShellState, 'client' | 'connection'> & {
  onOpen: (workspace: MobileWebWorkspaceSummary) => void
}): React.JSX.Element {
  const [retry, setRetry] = useState(0)
  const [request, setRequest] = useState<WorkspaceRequestState>({
    client: null,
    loading: false,
    snapshot: null,
    error: null
  })

  useEffect(() => {
    if (!client) {
      setRequest({ client: null, loading: false, snapshot: null, error: null })
      return
    }
    if (connection !== 'connected') {
      setRequest((current) =>
        current.client === client
          ? { ...current, loading: false }
          : { client, loading: false, snapshot: null, error: null }
      )
      return
    }

    let current = true
    setRequest((state) => ({
      client,
      loading: true,
      snapshot: state.client === client ? state.snapshot : null,
      error: null
    }))
    void client.workspaceSnapshot({ limit: 100 }).then(
      (snapshot) => {
        if (current) {
          setRequest({ client, loading: false, snapshot, error: null })
        }
      },
      (error: unknown) => {
        if (current) {
          setRequest((state) => ({
            client,
            loading: false,
            snapshot: state.client === client ? state.snapshot : null,
            error: bridgeClientError(error)
          }))
        }
      }
    )
    return () => {
      current = false
    }
  }, [client, connection, retry])

  const tryAgain = useCallback(() => setRetry((value) => value + 1), [])
  const snapshot = request.client === client ? request.snapshot : null
  const error = request.client === client ? request.error : null

  if (!client) {
    return <WorkspaceStatus title="Opening workspaces…" body="Waiting for the mobile shell." />
  }
  if (!snapshot && connection !== 'connected') {
    return (
      <WorkspaceStatus
        title={connection === 'offline' ? 'Desktop is offline' : 'Connecting to desktop…'}
        body="Workspaces will appear when the secure connection is available."
      />
    )
  }
  if (!snapshot && request.loading) {
    return <WorkspaceStatus title="Loading workspaces…" body="Reading the paired desktop." busy />
  }
  if (!snapshot && error) {
    return (
      <WorkspaceStatus
        title="Workspaces unavailable"
        body={workspaceErrorCopy(error)}
        action={
          error.retryable ? (
            <Button variant="outline" size="sm" onClick={tryAgain}>
              <RefreshCw />
              Try again
            </Button>
          ) : undefined
        }
      />
    )
  }
  if (!snapshot) {
    return <WorkspaceStatus title="Loading workspaces…" body="Reading the paired desktop." />
  }

  return (
    <section className="mx-auto w-full max-w-2xl p-4">
      {connection !== 'connected' ? (
        <p
          role="status"
          className="mb-3 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground"
        >
          {connectionCopy(connection)}
        </p>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="mb-3 flex items-center justify-between gap-3 rounded-md border border-border bg-muted px-3 py-2"
        >
          <p className="text-xs text-muted-foreground">{workspaceErrorCopy(error)}</p>
          {error.retryable ? (
            <Button
              className="shrink-0"
              variant="outline"
              size="xs"
              disabled={request.loading || connection !== 'connected'}
              onClick={tryAgain}
            >
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
      <Card aria-busy={request.loading}>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>Workspaces</CardTitle>
            <CardDescription>{workspaceCountCopy(snapshot)}</CardDescription>
          </div>
          <CardAction>
            <Button
              aria-label="Refresh workspaces"
              variant="outline"
              size="icon-sm"
              disabled={request.loading || connection !== 'connected'}
              onClick={tryAgain}
            >
              <RefreshCw className={request.loading ? 'animate-spin' : undefined} />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          {snapshot.workspaces.length === 0 ? (
            <div className="border-t border-border px-6 py-10 text-center">
              <p className="text-sm font-medium">No workspaces available</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Open a workspace on the paired desktop, then refresh this list.
              </p>
              <Button
                className="mt-4"
                variant="outline"
                size="sm"
                disabled={connection !== 'connected'}
                onClick={tryAgain}
              >
                <RefreshCw />
                Refresh
              </Button>
            </div>
          ) : (
            <ul className="border-t border-border">
              {snapshot.workspaces.map((workspace) => (
                <li
                  key={workspace.id}
                  data-current={workspace.isActive}
                  className="border-b border-border last:border-b-0 data-[current=true]:bg-accent"
                >
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start rounded-none px-6 py-3 text-left"
                    disabled={connection !== 'connected'}
                    onClick={() => onOpen(workspace)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{workspace.name}</p>
                          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                            {workspace.repo}
                          </p>
                        </div>
                        {workspace.isActive ? (
                          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                            Current
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex min-w-0 items-center gap-1">
                          <GitBranch className="size-3.5 shrink-0" />
                          <span className="truncate">{workspace.branch}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <TerminalSquare className="size-3.5" />
                          {workspace.liveTerminalCount}
                        </span>
                      </div>
                    </div>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {snapshot.truncated ? (
            <p className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
              Showing the first 100 workspaces.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}

function WorkspaceStatus({
  title,
  body,
  busy = false,
  action
}: {
  title: string
  body: string
  busy?: boolean
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="mx-auto flex min-h-[60dvh] w-full max-w-md items-center p-4">
      <Card className="w-full" aria-busy={busy}>
        <CardHeader>
          <div className="flex items-center gap-2">
            {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
            <CardTitle>{title}</CardTitle>
          </div>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
        {action ? <CardContent>{action}</CardContent> : null}
      </Card>
    </section>
  )
}

function workspaceCountCopy(snapshot: MobileWebWorkspaceSnapshotResult): string {
  const count = snapshot.workspaces.length
  return `${count} ${count === 1 ? 'workspace' : 'workspaces'} on this desktop`
}

function connectionCopy(connection: MobileWebNativeShellState['connection']): string {
  if (connection === 'offline') {
    return 'Offline — showing the last workspace list.'
  }
  if (connection === 'recovering') {
    return 'Restoring the secure connection — showing the last workspace list.'
  }
  return 'Connecting to the desktop — showing the last workspace list.'
}

function bridgeClientError(error: unknown): MobileWebBridgeClientError {
  return error instanceof MobileWebBridgeClientError
    ? error
    : new MobileWebBridgeClientError('internal', false)
}

function workspaceErrorCopy(error: MobileWebBridgeClientError): string {
  if (error.code === 'unsupported_capability') {
    return 'This Orca Mobile build does not expose workspace access.'
  }
  if (error.code === 'invalid_message') {
    return 'The desktop returned an incompatible workspace response.'
  }
  return 'The workspace list could not be loaded from the paired desktop.'
}
