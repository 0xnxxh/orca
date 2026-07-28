import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MOBILE_WEB_PROVIDER_COMMENT_BODY_MAX_CHARACTERS,
  type MobileWebProviderReview,
  type MobileWebProviderReviewFile
} from '../../shared/mobile-web/provider-review-contract'
import {
  MOBILE_WEB_PROVIDER_REVIEW_SUBMISSION_COMMENT_LIMIT,
  MOBILE_WEB_PROVIDER_REVIEW_SUBMISSION_SUMMARY_MAX_CHARACTERS,
  MOBILE_WEB_PROVIDER_REVIEW_SUBMISSION_TOTAL_MAX_CHARACTERS,
  type MobileWebProviderReviewQueuedComment,
  type MobileWebProviderReviewSubmissionAction
} from '../../shared/mobile-web/provider-review-submission-contract'
import type { MobileWebSourceControlStatusResult } from '../../shared/mobile-web/source-control-operation-contract'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'

export function useMobileWebProviderReviewSubmission({
  client,
  workspaceId,
  connected,
  status,
  review,
  refreshReview
}: {
  client: MobileWebBridgeClient
  workspaceId: string
  connected: boolean
  status: MobileWebSourceControlStatusResult | null
  review: MobileWebProviderReview | null
  refreshReview: () => Promise<void>
}) {
  const [comments, setComments] = useState<MobileWebProviderReviewQueuedComment[]>([])
  const [summary, setSummaryState] = useState('')
  const [action, setActionState] = useState<MobileWebProviderReviewSubmissionAction>('comment')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requiresRefresh, setRequiresRefresh] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const submissionId = useRef<string | null>(null)
  const activeRepositoryIdentity = useRef<string | null>(null)
  const activeReviewIdentity = useRef<string | null>(null)
  const repositoryIdentity =
    status?.head && status.branch ? `${workspaceId}\0${status.head}\0${status.branch}` : ''
  const reviewIdentity = review?.headSha
    ? `${workspaceId}\0${review.provider}\0${review.number}\0${review.headSha}`
    : ''
  const allowedActionsKey = review?.allowedSubmissionActions.join('\0') ?? ''

  const resetDraft = useCallback(() => {
    controller.current?.abort()
    setComments([])
    setSummaryState('')
    setActionState('comment')
    setSubmitting(false)
    setError(null)
    setRequiresRefresh(false)
    submissionId.current = null
  }, [])

  useEffect(() => {
    activeRepositoryIdentity.current = null
    activeReviewIdentity.current = null
    resetDraft()
  }, [resetDraft, workspaceId])

  useEffect(() => {
    if (!repositoryIdentity) {
      return
    }
    if (
      activeRepositoryIdentity.current !== null &&
      activeRepositoryIdentity.current !== repositoryIdentity
    ) {
      activeReviewIdentity.current = null
      resetDraft()
    }
    activeRepositoryIdentity.current = repositoryIdentity
  }, [repositoryIdentity, resetDraft])

  useEffect(() => {
    if (!reviewIdentity) {
      return
    }
    if (activeReviewIdentity.current !== reviewIdentity) {
      activeReviewIdentity.current = reviewIdentity
      resetDraft()
    }
    setActionState((current) =>
      review?.allowedSubmissionActions.includes(current)
        ? current
        : (review?.allowedSubmissionActions[0] ?? 'comment')
    )
  }, [allowedActionsKey, resetDraft, review, reviewIdentity])

  useEffect(
    () => () => {
      controller.current?.abort()
    },
    []
  )

  const resetSubmissionAttempt = useCallback(() => {
    submissionId.current = null
    setError(null)
    setRequiresRefresh(false)
  }, [])

  const queueComment = useCallback(
    async (file: MobileWebProviderReviewFile, line: number, body: string) => {
      const normalizedBody = body.trim()
      if (normalizedBody.length === 0) {
        setError('Enter a review comment before queueing it.')
        return false
      }
      if (normalizedBody.length > MOBILE_WEB_PROVIDER_COMMENT_BODY_MAX_CHARACTERS) {
        setError('Review comments are limited to 8,192 characters.')
        return false
      }
      if (
        !review?.headSha ||
        review.allowedSubmissionActions.length === 0 ||
        !file.commentableLines.includes(line)
      ) {
        return false
      }
      if (comments.length >= MOBILE_WEB_PROVIDER_REVIEW_SUBMISSION_COMMENT_LIMIT) {
        setError('This review already contains the maximum of 32 queued comments.')
        return false
      }
      if (
        retainedSubmissionCharacters(summary, comments) + normalizedBody.length >
        MOBILE_WEB_PROVIDER_REVIEW_SUBMISSION_TOTAL_MAX_CHARACTERS
      ) {
        setError('The queued review is limited to 65,536 retained characters.')
        return false
      }
      setComments((current) => [
        ...current,
        { id: createReviewSubmissionId(), path: file.path, line, body: normalizedBody }
      ])
      resetSubmissionAttempt()
      return true
    },
    [comments, resetSubmissionAttempt, review, summary]
  )

  const removeComment = useCallback(
    (id: string) => {
      setComments((current) => current.filter((comment) => comment.id !== id))
      resetSubmissionAttempt()
    },
    [resetSubmissionAttempt]
  )

  const setSummary = useCallback(
    (value: string) => {
      if (value.length > MOBILE_WEB_PROVIDER_REVIEW_SUBMISSION_SUMMARY_MAX_CHARACTERS) {
        setError('The review summary is limited to 8,192 characters.')
        return
      }
      if (
        retainedSubmissionCharacters(value, comments) >
        MOBILE_WEB_PROVIDER_REVIEW_SUBMISSION_TOTAL_MAX_CHARACTERS
      ) {
        setError('The queued review is limited to 65,536 retained characters.')
        return
      }
      setSummaryState(value)
      resetSubmissionAttempt()
    },
    [comments, resetSubmissionAttempt]
  )

  const setAction = useCallback(
    (value: MobileWebProviderReviewSubmissionAction) => {
      setActionState(value)
      resetSubmissionAttempt()
    },
    [resetSubmissionAttempt]
  )

  const submit = useCallback(async () => {
    const head = status?.head
    const branch = status?.branch
    if (
      !connected ||
      !head ||
      !branch ||
      !review?.headSha ||
      !review.allowedSubmissionActions.includes(action) ||
      requiresRefresh ||
      typeof client.providerSubmitReview !== 'function'
    ) {
      return false
    }
    controller.current?.abort()
    const nextController = new AbortController()
    controller.current = nextController
    submissionId.current ??= createReviewSubmissionId()
    setSubmitting(true)
    setError(null)
    try {
      await client.providerSubmitReview(
        {
          workspaceId,
          expectedHead: head,
          expectedBranch: branch,
          provider: review.provider,
          reviewNumber: review.number,
          expectedReviewHead: review.headSha,
          submissionId: submissionId.current,
          action,
          summary,
          comments
        },
        { signal: nextController.signal }
      )
      if (nextController.signal.aborted || controller.current !== nextController) {
        return false
      }
      setComments([])
      setSummaryState('')
      submissionId.current = null
      await refreshReview()
      return true
    } catch (submissionError) {
      if (!nextController.signal.aborted && controller.current === nextController) {
        setError(reviewSubmissionErrorMessage(submissionError))
        setRequiresRefresh(true)
      }
      return false
    } finally {
      if (controller.current === nextController) {
        controller.current = null
        setSubmitting(false)
      }
    }
  }, [
    action,
    client,
    comments,
    connected,
    refreshReview,
    requiresRefresh,
    review,
    status,
    summary,
    workspaceId
  ])

  const refreshBeforeRetry = useCallback(async () => {
    await refreshReview()
    submissionId.current = null
    setError(null)
    setRequiresRefresh(false)
  }, [refreshReview])

  return {
    comments,
    summary,
    action,
    submitting,
    error,
    requiresRefresh,
    queueComment,
    removeComment,
    setSummary,
    setAction,
    submit,
    refreshBeforeRetry
  }
}

export function createReviewSubmissionId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

function reviewSubmissionErrorMessage(error: unknown): string {
  if (error instanceof MobileWebBridgeClientError && error.code === 'conflict') {
    return 'The repository or review changed before submission. Refresh the review before retrying.'
  }
  if (error instanceof MobileWebBridgeClientError && error.code === 'unsupported_capability') {
    return 'This provider does not support the selected review action.'
  }
  return 'The review may have been partially submitted. Refresh the hosted review before retrying.'
}

function retainedSubmissionCharacters(
  summary: string,
  comments: readonly MobileWebProviderReviewQueuedComment[]
): number {
  return summary.trim().length + comments.reduce((total, comment) => total + comment.body.length, 0)
}
