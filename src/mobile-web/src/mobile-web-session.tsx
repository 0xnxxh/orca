import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { ArrowLeft, Loader2, Plus, RefreshCw } from 'lucide-react'
import React, { useCallback, useEffect, useState } from 'react'
import type {
  MobileWebSessionSnapshotResult,
  MobileWebWorkspaceActivationResult,
  MobileWebWorkspaceSummary
} from '../../shared/mobile-web/bridge-operation-contract'
import { MobileWebBridgeClientError, type MobileWebBridgeClient } from './mobile-web-bridge-client'
import {
  type MobileWebSessionPendingAction,
  useMobileWebSessionActions
} from './mobile-web-session-actions'
import { MobileWebFiles } from './mobile-web-files'
import { MobileWebSourceControl } from './mobile-web-source-control'
import { MobileWebSessionTabRow } from './mobile-web-session-tab-row'
import { MobileWebTerminal } from './mobile-web-terminal'
import type { MobileWebNativeShellState } from './native-shell-channel'

type SessionRequestState = {
  client: MobileWebBridgeClient
  workspaceId: string
  loading: boolean
  snapshot: MobileWebSessionSnapshotResult | null
  activation: MobileWebWorkspaceActivationResult | null
  error: MobileWebBridgeClientError | null
}

export function MobileWebSession({
  client,
  connection,
  workspace,
  onBack
}: {
  client: MobileWebBridgeClient
  connection: MobileWebNativeShellState['connection']
  workspace: MobileWebWorkspaceSummary
  onBack: () => void
}): React.JSX.Element {
  const [retry, setRetry] = useState(0)
  const [request, setRequest] = useState<SessionRequestState>({
    client,
    workspaceId: workspace.id,
    loading: false,
    snapshot: null,
    activation: null,
    error: null
  })
  const acceptSnapshot = useCallback(
    (nextSnapshot: MobileWebSessionSnapshotResult, allowSameVersion = false) => {
      setRequest((state) => {
        if (state.client !== client || state.workspaceId !== workspace.id) {
          return state
        }
        return {
          ...state,
          snapshot: shouldAcceptSnapshot(state.snapshot, nextSnapshot, allowSameVersion)
            ? nextSnapshot
            : state.snapshot,
          error: null
        }
      })
    },
    [client, workspace.id]
  )
  const actions = useMobileWebSessionActions({
    client,
    connected: connection === 'connected',
    workspaceId: workspace.id,
    onSnapshot: acceptSnapshot
  })

  useEffect(() => {
    if (connection !== 'connected') {
      setRequest((current) => ({ ...current, loading: false }))
      return
    }
    let current = true
    let unsubscribe = (): void => {}
    setRequest((state) => ({
      client,
      workspaceId: workspace.id,
      loading: true,
      snapshot:
        state.client === client && state.workspaceId === workspace.id ? state.snapshot : null,
      activation:
        state.client === client && state.workspaceId === workspace.id ? state.activation : null,
      error: null
    }))
    void enterWorkspace(client, workspace.id).then(
      ({ activation, snapshot }) => {
        if (current) {
          setRequest({
            client,
            workspaceId: workspace.id,
            loading: false,
            snapshot,
            activation,
            error: null
          })
          const subscription = client.sessionSubscribe(
            { workspaceId: workspace.id },
            (nextSnapshot) => {
              if (!current) {
                return
              }
              acceptSnapshot(nextSnapshot)
            },
            (subscriptionError) => {
              if (current) {
                setRequest((state) => ({ ...state, error: subscriptionError }))
              }
            }
          )
          unsubscribe = subscription.unsubscribe
          void subscription.ready.catch(() => null)
        }
      },
      (error: unknown) => {
        if (current) {
          setRequest((state) => ({
            ...state,
            loading: false,
            error: bridgeClientError(error)
          }))
        }
      }
    )
    return () => {
      current = false
      unsubscribe()
    }
  }, [acceptSnapshot, client, connection, retry, workspace.id])

  const tryAgain = useCallback(() => setRetry((value) => value + 1), [])
  const matchesWorkspace = request.client === client && request.workspaceId === workspace.id
  const snapshot = matchesWorkspace ? request.snapshot : null
  const error = matchesWorkspace ? request.error : null
  const activation = matchesWorkspace ? request.activation : null
  const displayError = actions.error ?? error

  return (
    <section className="mx-auto w-full max-w-2xl p-4">
      <div className="mb-3 flex items-center gap-2">
        <Button aria-label="Back to workspaces" variant="ghost" size="icon-sm" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium">{workspace.name}</h1>
          <p className="truncate font-mono text-xs text-muted-foreground">{workspace.branch}</p>
        </div>
      </div>
      {connection !== 'connected' ? (
        <p
          role="status"
          className="mb-3 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground"
        >
          {connectionCopy(connection)}
        </p>
      ) : null}
      {activation?.sleepingAgentWake === 'unsupported-headless' ? (
        <p
          role="status"
          className="mb-3 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground"
        >
          Sleeping agents need an open Orca Desktop window before they can resume.
        </p>
      ) : null}
      {displayError ? (
        <SessionError
          error={displayError}
          canRetry={connection === 'connected' && !request.loading}
          onRetry={tryAgain}
        />
      ) : null}
      <Card aria-busy={request.loading}>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>Session</CardTitle>
            <CardDescription>{sessionDescription(snapshot, request.loading)}</CardDescription>
          </div>
          <CardAction>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="xs"
                disabled={request.loading || actions.pending !== null || connection !== 'connected'}
                onClick={actions.create}
              >
                {actions.pending === 'create' ? <Loader2 className="animate-spin" /> : <Plus />}
                Terminal
              </Button>
              <Button
                aria-label="Refresh session"
                variant="outline"
                size="icon-sm"
                disabled={request.loading || actions.pending !== null || connection !== 'connected'}
                onClick={tryAgain}
              >
                <RefreshCw className={request.loading ? 'animate-spin' : undefined} />
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          <SessionBody
            client={client}
            workspaceId={workspace.id}
            snapshot={snapshot}
            loading={request.loading}
            connected={connection === 'connected'}
            pending={actions.pending}
            onActivate={actions.activate}
            onClose={actions.close}
          />
        </CardContent>
      </Card>
      <MobileWebSourceControl
        client={client}
        workspaceId={workspace.id}
        connected={connection === 'connected'}
      />
      <MobileWebFiles
        client={client}
        workspaceId={workspace.id}
        connected={connection === 'connected'}
      />
    </section>
  )
}

async function enterWorkspace(
  client: MobileWebBridgeClient,
  workspaceId: string
): Promise<{
  activation: MobileWebWorkspaceActivationResult
  snapshot: MobileWebSessionSnapshotResult
}> {
  const activation = await client.workspaceActivate({ workspaceId })
  const snapshot = await client.sessionSnapshot({ workspaceId })
  return { activation, snapshot }
}

function SessionBody({
  client,
  workspaceId,
  snapshot,
  loading,
  connected,
  pending,
  onActivate,
  onClose
}: {
  client: MobileWebBridgeClient
  workspaceId: string
  snapshot: MobileWebSessionSnapshotResult | null
  loading: boolean
  connected: boolean
  pending: MobileWebSessionPendingAction
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
}): React.JSX.Element {
  if (!snapshot) {
    return (
      <div className="flex min-h-40 items-center justify-center border-t border-border px-6 py-10">
        {loading ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : null}
      </div>
    )
  }
  if (snapshot.tabs.length === 0) {
    return (
      <div className="border-t border-border px-6 py-10 text-center">
        <p className="text-sm font-medium">No open session tabs</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Open a terminal, file, or browser tab on this workspace.
        </p>
      </div>
    )
  }
  return (
    <>
      <ul className="border-t border-border">
        {snapshot.tabs.map((tab) => (
          <MobileWebSessionTabRow
            key={`${tab.type}:${tab.id}`}
            tab={tab}
            connected={connected}
            pending={pending}
            onActivate={onActivate}
            onClose={onClose}
          />
        ))}
      </ul>
      {snapshot.truncated ? (
        <p className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
          Showing the first 200 session tabs.
        </p>
      ) : null}
      {snapshot.activeTabType === 'terminal' && snapshot.activeTabId ? (
        <MobileWebTerminal
          client={client}
          workspaceId={workspaceId}
          tabId={snapshot.activeTabId}
          connected={connected}
        />
      ) : null}
    </>
  )
}

function SessionError({
  error,
  canRetry,
  onRetry
}: {
  error: MobileWebBridgeClientError
  canRetry: boolean
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div
      role="alert"
      className="mb-3 flex items-center justify-between gap-3 rounded-md border border-border bg-muted px-3 py-2"
    >
      <p className="text-xs text-muted-foreground">{sessionErrorCopy(error)}</p>
      {error.retryable ? (
        <Button variant="outline" size="xs" disabled={!canRetry} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}

function sessionDescription(
  snapshot: MobileWebSessionSnapshotResult | null,
  loading: boolean
): string {
  if (!snapshot) {
    return loading ? 'Opening workspace on the paired desktop…' : 'Session unavailable'
  }
  const count = snapshot.tabs.length
  return `${count} open ${count === 1 ? 'tab' : 'tabs'} · version ${snapshot.snapshotVersion}`
}

function shouldAcceptSnapshot(
  current: MobileWebSessionSnapshotResult | null,
  next: MobileWebSessionSnapshotResult,
  allowSameVersion: boolean
): boolean {
  return (
    !current ||
    current.publicationEpoch !== next.publicationEpoch ||
    next.snapshotVersion > current.snapshotVersion ||
    (allowSameVersion && next.snapshotVersion === current.snapshotVersion)
  )
}

function connectionCopy(connection: MobileWebNativeShellState['connection']): string {
  if (connection === 'offline') {
    return 'Desktop is offline — showing the last session snapshot.'
  }
  if (connection === 'recovering') {
    return 'Restoring the secure connection — session is retained.'
  }
  return 'Connecting to the desktop — session is retained.'
}

function bridgeClientError(error: unknown): MobileWebBridgeClientError {
  return error instanceof MobileWebBridgeClientError
    ? error
    : new MobileWebBridgeClientError('internal', false)
}

function sessionErrorCopy(error: MobileWebBridgeClientError): string {
  if (error.code === 'unsupported_capability') {
    return 'This Orca Mobile build does not expose workspace sessions.'
  }
  if (error.code === 'invalid_message') {
    return 'The desktop returned an incompatible session response.'
  }
  if (error.code === 'conflict') {
    return 'The desktop kept this tab open because its session state changed.'
  }
  return 'The workspace session could not be loaded from the paired desktop.'
}
