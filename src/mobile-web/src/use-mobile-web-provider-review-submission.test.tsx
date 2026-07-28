// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MOBILE_WEB_PROVIDER_COMMENT_BODY_MAX_CHARACTERS,
  type MobileWebProviderReview,
  type MobileWebProviderReviewFile
} from '../../shared/mobile-web/provider-review-contract'
import {
  MOBILE_WEB_PROVIDER_REVIEW_SUBMISSION_COMMENT_LIMIT,
  MOBILE_WEB_PROVIDER_REVIEW_SUBMISSION_SUMMARY_MAX_CHARACTERS
} from '../../shared/mobile-web/provider-review-submission-contract'
import type { MobileWebSourceControlStatusResult } from '../../shared/mobile-web/source-control-operation-contract'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { useMobileWebProviderReviewSubmission } from './use-mobile-web-provider-review-submission'

const HEAD = 'a'.repeat(40)
const NEXT_HEAD = 'b'.repeat(40)
const THIRD_HEAD = 'c'.repeat(40)
const FILE: MobileWebProviderReviewFile = {
  path: 'src/review.ts',
  status: 'modified',
  additions: 2,
  deletions: 1,
  isBinary: false,
  commentableLines: [12],
  commentableLinesTruncated: false
}

afterEach(cleanup)

describe('useMobileWebProviderReviewSubmission', () => {
  it('preserves drafts through transient null state and resets on repository identity changes', async () => {
    const refreshReview = vi.fn().mockResolvedValue(undefined)
    const client = submissionClient()
    const initial = submissionProps(client, refreshReview)
    const hook = renderHook((props: HookProps) => useMobileWebProviderReviewSubmission(props), {
      initialProps: initial
    })

    await queue(hook.result.current, 'Keep this draft.')
    hook.rerender({ ...initial, review: null })
    expect(hook.result.current.comments).toHaveLength(1)
    hook.rerender({ ...initial, status: null, review: null })
    expect(hook.result.current.comments).toHaveLength(1)
    hook.rerender({ ...initial, review: providerReview(HEAD) })
    expect(hook.result.current.comments).toHaveLength(1)

    hook.rerender({ ...initial, status: sourceControlStatus('workspace-1', NEXT_HEAD) })
    await waitFor(() => expect(hook.result.current.comments).toHaveLength(0))
  })

  it('resets drafts on review-head and workspace changes', async () => {
    const refreshReview = vi.fn().mockResolvedValue(undefined)
    const client = submissionClient()
    const initial = submissionProps(client, refreshReview)
    const hook = renderHook((props: HookProps) => useMobileWebProviderReviewSubmission(props), {
      initialProps: initial
    })

    await queue(hook.result.current, 'Bound to the first review head.')
    hook.rerender({ ...initial, review: providerReview(NEXT_HEAD) })
    await waitFor(() => expect(hook.result.current.comments).toHaveLength(0))

    await queue(hook.result.current, 'Bound to the first workspace.')
    hook.rerender({
      ...initial,
      workspaceId: 'workspace-2',
      status: sourceControlStatus('workspace-2', HEAD),
      review: providerReview(THIRD_HEAD)
    })
    await waitFor(() => expect(hook.result.current.comments).toHaveLength(0))
  })

  it('rejects empty, oversized, aggregate-overflow, and excess queued comments', async () => {
    const hook = renderSubmissionHook()

    await act(async () => {
      expect(await hook.result.current.queueComment(FILE, 12, '   ')).toBe(false)
    })
    expect(hook.result.current.error).toContain('Enter a review comment')

    await act(async () => {
      expect(
        await hook.result.current.queueComment(
          FILE,
          12,
          'x'.repeat(MOBILE_WEB_PROVIDER_COMMENT_BODY_MAX_CHARACTERS + 1)
        )
      ).toBe(false)
    })
    expect(hook.result.current.error).toContain('8,192 characters')

    await act(async () => {
      for (let index = 0; index < MOBILE_WEB_PROVIDER_REVIEW_SUBMISSION_COMMENT_LIMIT; index += 1) {
        expect(await hook.result.current.queueComment(FILE, 12, `Comment ${index}`)).toBe(true)
      }
    })
    expect(hook.result.current.comments).toHaveLength(
      MOBILE_WEB_PROVIDER_REVIEW_SUBMISSION_COMMENT_LIMIT
    )
    await act(async () => {
      expect(await hook.result.current.queueComment(FILE, 12, 'One too many')).toBe(false)
    })
    expect(hook.result.current.error).toContain('maximum of 32')

    act(() => {
      for (const comment of hook.result.current.comments) {
        hook.result.current.removeComment(comment.id)
      }
      hook.result.current.setSummary(
        's'.repeat(MOBILE_WEB_PROVIDER_REVIEW_SUBMISSION_SUMMARY_MAX_CHARACTERS)
      )
    })
    await act(async () => {
      for (let index = 0; index < 7; index += 1) {
        expect(
          await hook.result.current.queueComment(
            FILE,
            12,
            'x'.repeat(MOBILE_WEB_PROVIDER_COMMENT_BODY_MAX_CHARACTERS)
          )
        ).toBe(true)
      }
    })
    await act(async () => {
      expect(
        await hook.result.current.queueComment(
          FILE,
          12,
          'x'.repeat(MOBILE_WEB_PROVIDER_COMMENT_BODY_MAX_CHARACTERS)
        )
      ).toBe(false)
    })
    expect(hook.result.current.error).toContain('65,536 retained characters')
  })

  it('requires a refresh after an ambiguous failure before allowing a new submission', async () => {
    const refreshReview = vi.fn().mockResolvedValue(undefined)
    const providerSubmitReview = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider response lost'))
      .mockImplementationOnce(async (payload) => submissionResult(payload))
    const client = submissionClient(providerSubmitReview)
    const hook = renderHook(
      () => useMobileWebProviderReviewSubmission(submissionProps(client, refreshReview)),
      {}
    )
    await queue(hook.result.current, 'Do not replay this blindly.')

    await act(async () => {
      expect(await hook.result.current.submit()).toBe(false)
    })
    expect(hook.result.current.requiresRefresh).toBe(true)
    expect(hook.result.current.comments).toHaveLength(1)
    expect(providerSubmitReview).toHaveBeenCalledOnce()

    await act(async () => {
      expect(await hook.result.current.submit()).toBe(false)
    })
    expect(providerSubmitReview).toHaveBeenCalledOnce()

    await act(async () => {
      await hook.result.current.refreshBeforeRetry()
    })
    expect(hook.result.current.requiresRefresh).toBe(false)
    expect(hook.result.current.comments).toHaveLength(1)

    await act(async () => {
      expect(await hook.result.current.submit()).toBe(true)
    })
    expect(providerSubmitReview).toHaveBeenCalledTimes(2)
    expect(providerSubmitReview.mock.calls[1]?.[0].submissionId).not.toBe(
      providerSubmitReview.mock.calls[0]?.[0].submissionId
    )
    expect(hook.result.current.comments).toHaveLength(0)
  })
})

type HookProps = Parameters<typeof useMobileWebProviderReviewSubmission>[0]
type SubmissionState = ReturnType<typeof useMobileWebProviderReviewSubmission>

function renderSubmissionHook() {
  const client = submissionClient()
  return renderHook(() =>
    useMobileWebProviderReviewSubmission(
      submissionProps(client, vi.fn().mockResolvedValue(undefined))
    )
  )
}

async function queue(submission: SubmissionState, body: string): Promise<void> {
  await act(async () => {
    expect(await submission.queueComment(FILE, 12, body)).toBe(true)
  })
}

function submissionProps(
  client: MobileWebBridgeClient,
  refreshReview: () => Promise<void>
): HookProps {
  return {
    client,
    workspaceId: 'workspace-1',
    connected: true,
    status: sourceControlStatus('workspace-1', HEAD),
    review: providerReview(HEAD),
    refreshReview
  }
}

function sourceControlStatus(
  workspaceId: string,
  head: string
): MobileWebSourceControlStatusResult {
  return {
    workspaceId,
    branch: 'feature/review',
    head,
    conflictOperation: 'unknown',
    entries: [],
    totalCount: 0,
    truncated: false
  }
}

function providerReview(headSha: string): MobileWebProviderReview {
  return {
    provider: 'github',
    number: 42,
    title: 'Review mobile bridge',
    state: 'open',
    checksStatus: 'success',
    mergeable: 'MERGEABLE',
    reviewDecision: null,
    updatedAt: '2026-07-23T00:00:00.000Z',
    headSha,
    body: '',
    comments: [],
    commentsTruncated: false,
    files: [FILE],
    filesTruncated: false,
    author: null,
    reviewRequests: [],
    latestReviews: [],
    checks: [],
    detailsState: 'loaded',
    canComment: true,
    allowedSubmissionActions: ['comment', 'approve', 'request-changes']
  }
}

function submissionClient(
  providerSubmitReview = vi.fn(async (payload) => submissionResult(payload))
) {
  return { providerSubmitReview } as unknown as MobileWebBridgeClient
}

function submissionResult(payload: {
  workspaceId: string
  provider: string
  reviewNumber: number
  expectedReviewHead: string
  submissionId: string
  action: string
  comments: { id: string }[]
}) {
  return {
    workspaceId: payload.workspaceId,
    provider: payload.provider,
    reviewNumber: payload.reviewNumber,
    expectedReviewHead: payload.expectedReviewHead,
    submissionId: payload.submissionId,
    action: payload.action,
    submittedCommentIds: payload.comments.map((comment) => comment.id),
    outcome: 'completed'
  }
}
