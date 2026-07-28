import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MOBILE_WEB_DIFF_MAX_ROWS,
  MOBILE_WEB_DIFF_PAGE_LIMIT,
  type MobileWebDiffRow,
  type MobileWebSourceControlDiffResult,
  type MobileWebSourceControlStatusEntry
} from '../../shared/mobile-web/source-control-operation-contract'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'

export const MOBILE_WEB_DIFF_RETAINED_MAX_CHARACTERS = 1_000_000

export type MobileWebDiffDocument =
  | {
      kind: 'text'
      revision: string
      rows: MobileWebDiffRow[]
      totalRows: number
      nextOffset: number | null
      truncated: boolean
      retainedCharacters: number
      retentionLimitReached: boolean
    }
  | { kind: 'binary' }
  | { kind: 'too-large'; characterCount?: number }

type DiffState = {
  client: MobileWebBridgeClient
  workspaceId: string
  entry: MobileWebSourceControlStatusEntry | null
  loading: boolean
  document: MobileWebDiffDocument | null
  error: MobileWebBridgeClientError | null
}

export function useMobileWebDiffDocument(args: {
  client: MobileWebBridgeClient
  workspaceId: string
  connected: boolean
}) {
  const { client, workspaceId, connected } = args
  const controllerRef = useRef<AbortController | null>(null)
  const [state, setState] = useState<DiffState>({
    client,
    workspaceId,
    entry: null,
    loading: false,
    document: null,
    error: null
  })

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setState((current) => ({ ...current, loading: false }))
  }, [])

  useEffect(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setState({
      client,
      workspaceId,
      entry: null,
      loading: false,
      document: null,
      error: null
    })
  }, [client, workspaceId])

  useEffect(() => {
    if (!connected) {
      cancel()
    }
  }, [cancel, connected])

  const requestPage = useCallback(
    (entry: MobileWebSourceControlStatusEntry, offset: number, expectedRevision?: string) => {
      if (!connected) {
        return
      }
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      setState((current) => ({
        client,
        workspaceId,
        entry,
        loading: true,
        document: offset === 0 ? null : current.document,
        error: null
      }))
      void client
        .sourceControlDiff(
          {
            workspaceId,
            relativePath: entry.relativePath,
            area: entry.area,
            offset,
            limit: MOBILE_WEB_DIFF_PAGE_LIMIT,
            ...(expectedRevision ? { expectedRevision } : {})
          },
          { signal: controller.signal }
        )
        .then(
          (result) => {
            if (controller.signal.aborted) {
              return
            }
            setState((current) => {
              if (current.client !== client || current.workspaceId !== workspaceId) {
                return current
              }
              try {
                return {
                  client,
                  workspaceId,
                  entry,
                  loading: false,
                  document: acceptDiffPage(current, entry, result, offset),
                  error: null
                }
              } catch (error) {
                return { ...current, loading: false, error: bridgeClientError(error) }
              }
            })
          },
          (error: unknown) => {
            if (!controller.signal.aborted) {
              setState((current) => ({
                ...current,
                loading: false,
                error: bridgeClientError(error)
              }))
            }
          }
        )
    },
    [client, connected, workspaceId]
  )

  const open = useCallback(
    (entry: MobileWebSourceControlStatusEntry) => requestPage(entry, 0),
    [requestPage]
  )
  const loadMore = useCallback(() => {
    const current = state
    if (
      current.client !== client ||
      current.workspaceId !== workspaceId ||
      !current.entry ||
      current.document?.kind !== 'text' ||
      current.document.nextOffset === null ||
      current.document.retentionLimitReached ||
      current.loading
    ) {
      return
    }
    requestPage(current.entry, current.document.nextOffset, current.document.revision)
  }, [client, requestPage, state, workspaceId])
  const retry = useCallback(() => {
    if (state.entry) {
      requestPage(state.entry, 0)
    }
  }, [requestPage, state.entry])

  const matches = state.client === client && state.workspaceId === workspaceId
  return {
    client,
    workspaceId,
    entry: matches ? state.entry : null,
    loading: matches ? state.loading : false,
    document: matches ? state.document : null,
    error: matches ? state.error : null,
    open,
    loadMore,
    retry,
    cancel
  }
}

function acceptDiffPage(
  current: DiffState,
  entry: MobileWebSourceControlStatusEntry,
  result: MobileWebSourceControlDiffResult,
  requestedOffset: number
): MobileWebDiffDocument {
  if (
    result.workspaceId !== current.workspaceId ||
    result.relativePath !== entry.relativePath ||
    result.area !== entry.area
  ) {
    throw new MobileWebBridgeClientError('invalid_message', false)
  }
  if (result.kind === 'binary') {
    return { kind: 'binary' }
  }
  if (result.kind === 'too-large') {
    return {
      kind: 'too-large',
      ...(result.characterCount === undefined ? {} : { characterCount: result.characterCount })
    }
  }
  if (result.offset !== requestedOffset || !hasContiguousRows(result.rows, requestedOffset)) {
    throw new MobileWebBridgeClientError('invalid_message', false)
  }

  const previous = requestedOffset === 0 ? null : current.document
  if (
    previous &&
    (previous.kind !== 'text' ||
      previous.revision !== result.revision ||
      previous.nextOffset !== requestedOffset)
  ) {
    throw new MobileWebBridgeClientError('invalid_message', false)
  }
  const retained = retainBoundedRows(previous?.kind === 'text' ? previous : null, result.rows)
  return {
    kind: 'text',
    revision: result.revision,
    rows: retained.rows,
    totalRows: result.totalRows,
    nextOffset: retained.limitReached ? null : result.nextOffset,
    truncated: result.truncated,
    retainedCharacters: retained.characters,
    retentionLimitReached: retained.limitReached
  }
}

function retainBoundedRows(
  previous: Extract<MobileWebDiffDocument, { kind: 'text' }> | null,
  rows: MobileWebDiffRow[]
) {
  const retained = previous?.rows.slice() ?? []
  let characters = previous?.retainedCharacters ?? 0
  let limitReached = false
  for (const row of rows) {
    if (
      retained.length >= MOBILE_WEB_DIFF_MAX_ROWS ||
      characters + row.text.length > MOBILE_WEB_DIFF_RETAINED_MAX_CHARACTERS
    ) {
      limitReached = true
      break
    }
    retained.push(row)
    characters += row.text.length
  }
  return { rows: retained, characters, limitReached }
}

function hasContiguousRows(rows: MobileWebDiffRow[], offset: number): boolean {
  return rows.every((row, index) => row.index === offset + index)
}

function bridgeClientError(error: unknown): MobileWebBridgeClientError {
  return error instanceof MobileWebBridgeClientError
    ? error
    : new MobileWebBridgeClientError('internal', false)
}
