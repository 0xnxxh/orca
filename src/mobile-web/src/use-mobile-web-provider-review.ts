import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  MobileWebProviderReviewComment,
  MobileWebProviderReviewFile,
  MobileWebProviderReviewMutationPayload,
  MobileWebProviderReviewResult
} from '../../shared/mobile-web/provider-review-contract'
import type { MobileWebSourceControlStatusResult } from '../../shared/mobile-web/source-control-operation-contract'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'

export function useMobileWebProviderReview({
  client,
  workspaceId,
  connected,
  status
}: {
  client: MobileWebBridgeClient
  workspaceId: string
  connected: boolean
  status: MobileWebSourceControlStatusResult | null
}) {
  const head = status?.head
  const branch = status?.branch
  const [result, setResult] = useState<MobileWebProviderReviewResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mutationKey, setMutationKey] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [mutationErrorKey, setMutationErrorKey] = useState<string | null>(null)
  const readController = useRef<AbortController | null>(null)
  const mutationController = useRef<AbortController | null>(null)

  const retry = useCallback(async () => {
    readController.current?.abort()
    if (!connected || !head || !branch || typeof client.providerReview !== 'function') {
      setResult(null)
      setLoading(false)
      setError(null)
      return
    }
    const controller = new AbortController()
    readController.current = controller
    setLoading(true)
    setError(null)
    try {
      const next = await client.providerReview(
        { workspaceId, expectedHead: head, expectedBranch: branch },
        { signal: controller.signal }
      )
      if (!controller.signal.aborted && readController.current === controller) {
        setResult(next)
      }
    } catch (requestError) {
      if (!controller.signal.aborted && readController.current === controller) {
        setResult(null)
        setError(reviewRequestErrorMessage(requestError))
      }
    } finally {
      if (readController.current === controller) {
        readController.current = null
        setLoading(false)
      }
    }
  }, [branch, client, connected, head, workspaceId])

  useEffect(() => {
    void retry()
    return () => {
      readController.current?.abort()
      mutationController.current?.abort()
    }
  }, [retry])

  const mutate = useCallback(
    async (payload: MobileWebProviderReviewMutationPayload, key: string) => {
      const review = result?.review
      if (
        !connected ||
        !head ||
        !branch ||
        !review?.canComment ||
        typeof client.providerMutateReview !== 'function'
      ) {
        return false
      }
      mutationController.current?.abort()
      const controller = new AbortController()
      mutationController.current = controller
      setMutationKey(key)
      setMutationError(null)
      setMutationErrorKey(null)
      try {
        await client.providerMutateReview(payload, { signal: controller.signal })
        if (controller.signal.aborted || mutationController.current !== controller) {
          return false
        }
        await retry()
        return true
      } catch (requestError) {
        if (!controller.signal.aborted && mutationController.current === controller) {
          setMutationError(reviewMutationErrorMessage(requestError, payload.action))
          setMutationErrorKey(key)
        }
        return false
      } finally {
        if (mutationController.current === controller) {
          mutationController.current = null
          setMutationKey(null)
        }
      }
    },
    [branch, client, connected, head, result, retry]
  )

  const mutationIdentity = useCallback(() => {
    const review = result?.review
    return review && head && branch
      ? {
          workspaceId,
          expectedHead: head,
          expectedBranch: branch,
          provider: review.provider,
          reviewNumber: review.number
        }
      : null
  }, [branch, head, result, workspaceId])

  const comment = useCallback(
    async (body: string) => {
      const identity = mutationIdentity()
      return identity ? mutate({ ...identity, action: 'comment', body }, 'comment') : false
    },
    [mutate, mutationIdentity]
  )

  const reply = useCallback(
    async (target: MobileWebProviderReviewComment, body: string) => {
      const identity = mutationIdentity()
      if (!identity || !target.threadId || !target.allowedActions.includes('reply')) {
        return false
      }
      return mutate(
        {
          ...identity,
          action: 'reply',
          commentId: target.id,
          threadId: target.threadId,
          body
        },
        `reply:${target.threadId}:${target.id}`
      )
    },
    [mutate, mutationIdentity]
  )

  const inlineComment = useCallback(
    async (file: MobileWebProviderReviewFile, line: number, body: string) => {
      const identity = mutationIdentity()
      const reviewHead = result?.review?.headSha
      if (!identity || !reviewHead || !file.commentableLines.includes(line)) {
        return false
      }
      return mutate(
        {
          ...identity,
          action: 'inlineComment',
          expectedReviewHead: reviewHead,
          path: file.path,
          line,
          body
        },
        `inline:${file.path}:${line}`
      )
    },
    [mutate, mutationIdentity, result]
  )

  const setThreadResolved = useCallback(
    async (target: MobileWebProviderReviewComment, resolved: boolean) => {
      const identity = mutationIdentity()
      if (!identity || !target.threadId || !target.allowedActions.includes('set-resolved')) {
        return false
      }
      return mutate(
        {
          ...identity,
          action: 'setThreadResolved',
          threadId: target.threadId,
          resolved
        },
        `thread:${target.threadId}`
      )
    },
    [mutate, mutationIdentity]
  )

  return {
    result,
    loading,
    error,
    mutationKey,
    mutationError,
    mutationErrorKey,
    retry,
    comment,
    reply,
    inlineComment,
    setThreadResolved
  }
}

function reviewRequestErrorMessage(error: unknown): string {
  if (error instanceof MobileWebBridgeClientError && error.code === 'conflict') {
    return 'Repository state changed. Refresh changes before loading the review.'
  }
  if (error instanceof MobileWebBridgeClientError && error.code === 'not_connected') {
    return 'Reconnect to load the hosted review.'
  }
  return 'Hosted review details are unavailable.'
}

function reviewMutationErrorMessage(
  error: unknown,
  action: MobileWebProviderReviewMutationPayload['action']
): string {
  if (error instanceof MobileWebBridgeClientError && error.code === 'conflict') {
    return 'The repository, hosted review, or thread changed. Refresh before trying again.'
  }
  if (error instanceof MobileWebBridgeClientError && error.code === 'not_connected') {
    return 'Reconnect before updating the hosted review.'
  }
  return action === 'setThreadResolved'
    ? 'The thread state could not be confirmed. Refresh before retrying.'
    : 'The comment may not have been posted. Check the hosted review before retrying.'
}
