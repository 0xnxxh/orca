import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MOBILE_WEB_COMMIT_MESSAGE_MAX_CHARACTERS,
  MOBILE_WEB_COMMIT_STAGED_ENTRY_LIMIT,
  type MobileWebSourceControlCommitEntry
} from '../../shared/mobile-web/source-control-commit-contract'
import type { MobileWebSourceControlStatusResult } from '../../shared/mobile-web/source-control-operation-contract'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'

const COMMIT_MESSAGE_GENERATION_WEB_TIMEOUT_MS = 70_000

type CommitAction = {
  kind: 'commit' | 'generate'
  controller: AbortController
}

export function useMobileWebSourceControlCommit(args: {
  client: MobileWebBridgeClient
  workspaceId: string
  connected: boolean
  status: MobileWebSourceControlStatusResult | null
  statusLoading: boolean
  mutationBusy: boolean
  onRefresh: () => void
}) {
  const { client, workspaceId, connected, status, statusLoading, mutationBusy, onRefresh } = args
  const [message, setMessageState] = useState('')
  const [busy, setBusy] = useState<CommitAction['kind'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const actionRef = useRef<CommitAction | null>(null)
  const stagedEntries = useMemo(() => commitEntrySnapshot(status), [status])
  const blockedReason = commitBlockedReason(status, stagedEntries)
  const snapshot = useMemo(
    () =>
      status?.head && !blockedReason
        ? { workspaceId, expectedHead: status.head, stagedEntries }
        : null,
    [blockedReason, stagedEntries, status?.head, workspaceId]
  )

  useEffect(() => {
    setMessageState('')
    setBusy(null)
    setError(null)
    return () => {
      actionRef.current?.controller.abort()
      actionRef.current = null
    }
  }, [client, workspaceId])

  const commit = useCallback(async (): Promise<boolean> => {
    const trimmedMessage = message.trim()
    if (
      !snapshot ||
      !connected ||
      statusLoading ||
      mutationBusy ||
      actionRef.current ||
      trimmedMessage.length === 0
    ) {
      return false
    }
    const action = startAction('commit', actionRef, setBusy, setError)
    try {
      const result = await client.sourceControlCommit(
        { ...snapshot, message: trimmedMessage },
        { signal: action.controller.signal }
      )
      if (action.controller.signal.aborted) {
        return false
      }
      if (result.status === 'failed') {
        setError(result.error)
        return false
      }
      setMessageState('')
      onRefresh()
      return true
    } catch (caught) {
      return handleCommitError(caught, action.controller, setError, onRefresh)
    } finally {
      finishAction(action, actionRef, setBusy)
    }
  }, [client, connected, message, mutationBusy, onRefresh, snapshot, statusLoading])

  const generate = useCallback(async (): Promise<boolean> => {
    if (!snapshot || !connected || statusLoading || mutationBusy || actionRef.current) {
      return false
    }
    const action = startAction('generate', actionRef, setBusy, setError)
    try {
      const result = await client.sourceControlGenerateCommitMessage(snapshot, {
        signal: action.controller.signal,
        timeoutMs: COMMIT_MESSAGE_GENERATION_WEB_TIMEOUT_MS
      })
      if (action.controller.signal.aborted || result.status === 'cancelled') {
        return false
      }
      if (result.status === 'failed') {
        setError(result.error)
        return false
      }
      setMessageState(result.message)
      return true
    } catch (caught) {
      return handleCommitError(caught, action.controller, setError, onRefresh)
    } finally {
      finishAction(action, actionRef, setBusy)
    }
  }, [client, connected, mutationBusy, onRefresh, snapshot, statusLoading])

  const cancelGeneration = useCallback(() => {
    const action = actionRef.current
    if (!action || action.kind !== 'generate') {
      return
    }
    action.controller.abort()
    actionRef.current = null
    setBusy(null)
    void client.sourceControlCancelCommitMessageGeneration({ workspaceId }).catch(() => undefined)
  }, [client, workspaceId])

  return {
    message,
    setMessage: useCallback((next: string) => {
      setMessageState(next.slice(0, MOBILE_WEB_COMMIT_MESSAGE_MAX_CHARACTERS))
      setError(null)
    }, []),
    busy,
    error,
    clearError: useCallback(() => setError(null), []),
    stagedCount: stagedEntries.length,
    blockedReason,
    canCommit:
      Boolean(snapshot) &&
      connected &&
      !statusLoading &&
      !mutationBusy &&
      busy === null &&
      message.trim().length > 0,
    canGenerate: Boolean(snapshot) && connected && !statusLoading && !mutationBusy && busy === null,
    commit,
    generate,
    cancelGeneration
  }
}

function commitEntrySnapshot(
  status: MobileWebSourceControlStatusResult | null
): MobileWebSourceControlCommitEntry[] {
  if (!status) {
    return []
  }
  const paths = new Set<string>()
  return status.entries
    .filter((entry) => {
      if (entry.area !== 'staged' || paths.has(entry.relativePath)) {
        return false
      }
      paths.add(entry.relativePath)
      return true
    })
    .slice(0, MOBILE_WEB_COMMIT_STAGED_ENTRY_LIMIT)
    .map((entry) => ({
      relativePath: entry.relativePath,
      ...(entry.oldRelativePath ? { oldRelativePath: entry.oldRelativePath } : {}),
      status: entry.status,
      area: 'staged' as const,
      ...(entry.conflictStatus ? { conflictStatus: entry.conflictStatus } : {})
    }))
}

function commitBlockedReason(
  status: MobileWebSourceControlStatusResult | null,
  stagedEntries: readonly MobileWebSourceControlCommitEntry[]
): string | null {
  if (!status || stagedEntries.length === 0) {
    return 'Stage changes to create a commit.'
  }
  if (status.truncated) {
    return 'Commit on Desktop when the mobile change list is truncated.'
  }
  if (!status.head) {
    return 'Commit on Desktop until the repository has a current HEAD.'
  }
  if (status.entries.some((entry) => entry.conflictStatus === 'unresolved')) {
    return 'Resolve conflicts on Desktop before committing.'
  }
  return null
}

function startAction(
  kind: CommitAction['kind'],
  ref: React.MutableRefObject<CommitAction | null>,
  setBusy: (value: CommitAction['kind'] | null) => void,
  setError: (value: string | null) => void
): CommitAction {
  const action = { kind, controller: new AbortController() }
  ref.current = action
  setBusy(kind)
  setError(null)
  return action
}

function finishAction(
  action: CommitAction,
  ref: React.MutableRefObject<CommitAction | null>,
  setBusy: (value: CommitAction['kind'] | null) => void
): void {
  if (ref.current === action) {
    ref.current = null
    setBusy(null)
  }
}

function handleCommitError(
  caught: unknown,
  controller: AbortController,
  setError: (value: string | null) => void,
  onRefresh: () => void
): false {
  if (controller.signal.aborted) {
    return false
  }
  const error =
    caught instanceof MobileWebBridgeClientError
      ? caught
      : new MobileWebBridgeClientError('internal', false)
  if (error.code === 'conflict') {
    setError('The repository changed. Review the refreshed status before trying again.')
    onRefresh()
  } else if (error.code === 'not_connected') {
    setError('Reconnect before committing.')
  } else {
    setError('The paired Desktop could not complete the commit action.')
  }
  return false
}

export type MobileWebSourceControlCommit = ReturnType<typeof useMobileWebSourceControlCommit>
