import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MOBILE_WEB_SOURCE_CONTROL_MUTATION_LIMIT,
  type MobileWebSourceControlMutationEntry,
  type MobileWebSourceControlMutationOperation
} from '../../shared/mobile-web/source-control-mutation-contract'
import type {
  MobileWebSourceControlStatusEntry,
  MobileWebSourceControlStatusResult
} from '../../shared/mobile-web/source-control-operation-contract'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'

type MutationState = {
  client: MobileWebBridgeClient
  workspaceId: string
  operation: MobileWebSourceControlMutationOperation | null
  relativePaths: string[]
  error: MobileWebBridgeClientError | null
}

export function useMobileWebSourceControlMutations(args: {
  client: MobileWebBridgeClient
  workspaceId: string
  connected: boolean
  status: MobileWebSourceControlStatusResult | null
  onRefresh: () => void
}) {
  const { client, workspaceId, connected, status, onRefresh } = args
  const controllerRef = useRef<AbortController | null>(null)
  const [discardTargets, setDiscardTargets] = useState<MobileWebSourceControlStatusEntry[] | null>(
    null
  )
  const [state, setState] = useState<MutationState>({
    client,
    workspaceId,
    operation: null,
    relativePaths: [],
    error: null
  })

  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
      controllerRef.current = null
      setDiscardTargets(null)
    }
  }, [client, workspaceId])

  const run = useCallback(
    async (
      operation: MobileWebSourceControlMutationOperation,
      candidates: readonly MobileWebSourceControlStatusEntry[]
    ): Promise<boolean> => {
      if (!connected || controllerRef.current) {
        return false
      }
      const entries = eligibleMutationEntries(candidates, operation)
      if (entries.length === 0) {
        return false
      }
      const controller = new AbortController()
      controllerRef.current = controller
      const relativePaths = entries.map((entry) => entry.relativePath)
      setState({ client, workspaceId, operation, relativePaths, error: null })
      try {
        const payload = {
          workspaceId,
          expectedHead: status?.head ?? null,
          entries: entries.map(mutationEntrySnapshot)
        }
        if (operation === 'stage') {
          await client.sourceControlStage(payload, { signal: controller.signal })
        } else if (operation === 'unstage') {
          await client.sourceControlUnstage(payload, { signal: controller.signal })
        } else {
          await client.sourceControlDiscard(
            { ...payload, confirmation: 'discard-confirmed' },
            { signal: controller.signal }
          )
        }
        if (controller.signal.aborted) {
          return false
        }
        setState({ client, workspaceId, operation: null, relativePaths: [], error: null })
        onRefresh()
        return true
      } catch (error) {
        if (controller.signal.aborted) {
          return false
        }
        const bridgeError = mutationError(error)
        setState({
          client,
          workspaceId,
          operation: null,
          relativePaths: [],
          error: bridgeError
        })
        if (bridgeError.code === 'conflict') {
          onRefresh()
        }
        return false
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null
        }
      }
    },
    [client, connected, onRefresh, status?.head, workspaceId]
  )

  const matches = state.client === client && state.workspaceId === workspaceId
  const busyOperation = matches ? state.operation : null
  const mutationErrorValue = matches ? state.error : null
  const isBusyPath = useCallback(
    (relativePath: string) => matches && state.relativePaths.includes(relativePath),
    [matches, state.relativePaths]
  )

  return {
    busyOperation,
    error: mutationErrorValue,
    discardTargets,
    stage: useCallback(
      (entries: readonly MobileWebSourceControlStatusEntry[]) => run('stage', entries),
      [run]
    ),
    unstage: useCallback(
      (entries: readonly MobileWebSourceControlStatusEntry[]) => run('unstage', entries),
      [run]
    ),
    requestDiscard: useCallback(
      (entries: readonly MobileWebSourceControlStatusEntry[]) => {
        if (!busyOperation) {
          const eligible = eligibleMutationEntries(entries, 'discard')
          setDiscardTargets(eligible.length > 0 ? eligible : null)
        }
      },
      [busyOperation]
    ),
    confirmDiscard: useCallback(async () => {
      if (discardTargets && (await run('discard', discardTargets))) {
        setDiscardTargets(null)
      }
    }, [discardTargets, run]),
    cancelDiscard: useCallback(() => {
      if (!busyOperation) {
        setDiscardTargets(null)
      }
    }, [busyOperation]),
    clearError: useCallback(() => {
      setState((current) =>
        current.client === client && current.workspaceId === workspaceId
          ? { ...current, error: null }
          : current
      )
    }, [client, workspaceId]),
    isBusyPath
  }
}

export function eligibleMutationEntries(
  entries: readonly MobileWebSourceControlStatusEntry[],
  operation: MobileWebSourceControlMutationOperation
): MobileWebSourceControlStatusEntry[] {
  const paths = new Set<string>()
  return entries
    .filter((entry) => {
      const eligible =
        operation === 'unstage'
          ? entry.area === 'staged'
          : entry.area !== 'staged' && entry.conflictStatus !== 'unresolved'
      if (!eligible || paths.has(entry.relativePath)) {
        return false
      }
      paths.add(entry.relativePath)
      return true
    })
    .slice(0, MOBILE_WEB_SOURCE_CONTROL_MUTATION_LIMIT)
}

function mutationEntrySnapshot(
  entry: MobileWebSourceControlStatusEntry
): MobileWebSourceControlMutationEntry {
  return {
    relativePath: entry.relativePath,
    ...(entry.oldRelativePath ? { oldRelativePath: entry.oldRelativePath } : {}),
    status: entry.status,
    area: entry.area,
    ...(entry.conflictStatus ? { conflictStatus: entry.conflictStatus } : {})
  }
}

function mutationError(error: unknown): MobileWebBridgeClientError {
  return error instanceof MobileWebBridgeClientError
    ? error
    : new MobileWebBridgeClientError('internal', false)
}

export type MobileWebSourceControlMutations = ReturnType<typeof useMobileWebSourceControlMutations>
