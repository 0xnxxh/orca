import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  MobileWebProviderReview,
  MobileWebProviderReviewFile
} from '../../shared/mobile-web/provider-review-contract'
import type { MobileWebProviderReviewDiffResult } from '../../shared/mobile-web/provider-review-diff-contract'
import {
  MOBILE_WEB_DIFF_MAX_ROWS,
  MOBILE_WEB_DIFF_PAGE_LIMIT,
  type MobileWebDiffRow,
  type MobileWebSourceControlStatusResult
} from '../../shared/mobile-web/source-control-operation-contract'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'
import {
  MOBILE_WEB_DIFF_RETAINED_MAX_CHARACTERS,
  type MobileWebDiffDocument
} from './use-mobile-web-diff-document'

type ReviewDiffDocument =
  | (Extract<MobileWebDiffDocument, { kind: 'text' }> & {
      focusLine?: number
      focusRowIndex?: number
    })
  | Exclude<MobileWebDiffDocument, { kind: 'text' }>

type ReviewDiffState = {
  client: MobileWebBridgeClient
  workspaceId: string
  file: MobileWebProviderReviewFile | null
  loading: boolean
  document: ReviewDiffDocument | null
  error: MobileWebBridgeClientError | null
}

export function useMobileWebProviderReviewDiff(args: {
  client: MobileWebBridgeClient
  workspaceId: string
  connected: boolean
  status: MobileWebSourceControlStatusResult | null
  review: MobileWebProviderReview | null
}) {
  const { client, workspaceId, connected, status, review } = args
  const controllerRef = useRef<AbortController | null>(null)
  const [state, setState] = useState<ReviewDiffState>(() => initialState(client, workspaceId))

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setState((current) => ({ ...current, loading: false }))
  }, [])
  const close = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setState(initialState(client, workspaceId))
  }, [client, workspaceId])

  useEffect(
    () => close(),
    [
      client,
      workspaceId,
      status?.head,
      status?.branch,
      review?.provider,
      review?.number,
      review?.headSha,
      close
    ]
  )
  useEffect(() => {
    if (!connected) {
      cancel()
    }
  }, [cancel, connected])

  const requestPage = useCallback(
    (
      file: MobileWebProviderReviewFile,
      offset: number,
      expectedRevision?: string,
      focusLine?: number
    ) => {
      if (
        !connected ||
        !status?.head ||
        !status.branch ||
        !review?.headSha ||
        typeof client.providerReviewDiff !== 'function'
      ) {
        return
      }
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      setState((current) => ({
        client,
        workspaceId,
        file,
        loading: true,
        document: offset === 0 ? null : current.document,
        error: null
      }))
      void client
        .providerReviewDiff(
          {
            workspaceId,
            expectedHead: status.head,
            expectedBranch: status.branch,
            provider: review.provider,
            reviewNumber: review.number,
            expectedReviewHead: review.headSha,
            path: file.path,
            offset,
            limit: MOBILE_WEB_DIFF_PAGE_LIMIT,
            ...(expectedRevision ? { expectedRevision } : {}),
            ...(focusLine === undefined ? {} : { focusLine })
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
                  file,
                  loading: false,
                  document: acceptReviewDiffPage(current, file, result, offset, focusLine),
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
    [client, connected, review, status, workspaceId]
  )

  const open = useCallback(
    (file: MobileWebProviderReviewFile, focusLine?: number) =>
      requestPage(file, 0, undefined, focusLine),
    [requestPage]
  )
  const loadMore = useCallback(() => {
    if (
      !state.file ||
      state.document?.kind !== 'text' ||
      state.document.nextOffset === null ||
      state.document.retentionLimitReached ||
      state.loading
    ) {
      return
    }
    requestPage(state.file, state.document.nextOffset, state.document.revision)
  }, [requestPage, state])
  const retry = useCallback(() => {
    if (state.file) {
      requestPage(
        state.file,
        0,
        undefined,
        state.document?.kind === 'text' ? state.document.focusLine : undefined
      )
    }
  }, [requestPage, state.document, state.file])

  const matches = state.client === client && state.workspaceId === workspaceId
  return {
    file: matches ? state.file : null,
    loading: matches ? state.loading : false,
    document: matches ? state.document : null,
    error: matches ? state.error : null,
    open,
    loadMore,
    retry,
    cancel,
    close
  }
}

function acceptReviewDiffPage(
  current: ReviewDiffState,
  file: MobileWebProviderReviewFile,
  result: MobileWebProviderReviewDiffResult,
  requestedOffset: number,
  requestedFocusLine?: number
): ReviewDiffDocument {
  if (result.workspaceId !== current.workspaceId || result.path !== file.path) {
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
  if (
    (requestedFocusLine === undefined && result.offset !== requestedOffset) ||
    !hasContiguousRows(result.rows, result.offset) ||
    (requestedFocusLine !== undefined &&
      (result.focusLine !== requestedFocusLine || result.focusRowIndex === undefined))
  ) {
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
  const retained = retainRows(previous?.kind === 'text' ? previous : null, result.rows)
  return {
    kind: 'text',
    revision: result.revision,
    rows: retained.rows,
    totalRows: result.totalRows,
    nextOffset: retained.limitReached ? null : result.nextOffset,
    truncated: result.truncated,
    retainedCharacters: retained.characters,
    retentionLimitReached: retained.limitReached,
    ...(result.focusLine === undefined ? {} : { focusLine: result.focusLine }),
    ...(result.focusRowIndex === undefined ? {} : { focusRowIndex: result.focusRowIndex })
  }
}

function retainRows(
  previous: Extract<ReviewDiffDocument, { kind: 'text' }> | null,
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

function initialState(client: MobileWebBridgeClient, workspaceId: string): ReviewDiffState {
  return { client, workspaceId, file: null, loading: false, document: null, error: null }
}

function hasContiguousRows(rows: MobileWebDiffRow[], offset: number): boolean {
  return rows.every((row, index) => row.index === offset + index)
}

function bridgeClientError(error: unknown): MobileWebBridgeClientError {
  return error instanceof MobileWebBridgeClientError
    ? error
    : new MobileWebBridgeClientError('internal', false)
}
