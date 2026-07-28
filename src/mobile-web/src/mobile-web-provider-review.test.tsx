// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileWebProviderReviewResult } from '../../shared/mobile-web/provider-review-contract'
import type { MobileWebSourceControlStatusResult } from '../../shared/mobile-web/source-control-operation-contract'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebProviderReviewCard } from './mobile-web-provider-review'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 24,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 24,
        size: 24
      })),
    scrollToIndex: vi.fn()
  })
}))

const HEAD = 'a'.repeat(40)

afterEach(cleanup)

describe('mobile web provider review', () => {
  it('renders provider content as inert text and posts a GitLab comment with exact identity', async () => {
    const client = providerClient(reviewResult('workspace-1', 'gitlab'))
    render(
      createElement(MobileWebProviderReviewCard, {
        client,
        workspaceId: 'workspace-1',
        connected: true,
        status: statusResult('workspace-1')
      })
    )

    expect(await screen.findByText('Merge request #42: Review mobile bridge')).toBeTruthy()
    expect(screen.getByText('<script>inert comment</script>')).toBeTruthy()
    expect(
      screen.getByText(
        'GitLab receives queued discussions individually; verdict actions are unavailable.'
      )
    ).toBeTruthy()
    expect(screen.queryByLabelText('Review verdict')).toBeNull()
    fireEvent.change(screen.getByLabelText('Add comment'), {
      target: { value: 'Please verify Relay too.' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))

    await waitFor(() => expect(client.providerMutateReview).toHaveBeenCalledOnce())
    expect(client.providerMutateReview).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        expectedHead: HEAD,
        expectedBranch: 'feature/review',
        provider: 'gitlab',
        reviewNumber: 42,
        action: 'comment',
        body: 'Please verify Relay too.'
      },
      { signal: expect.any(AbortSignal) }
    )
    await waitFor(() => expect(client.providerReview).toHaveBeenCalledTimes(2))
    expect((screen.getByLabelText('Add comment') as HTMLTextAreaElement).value).toBe('')
  })

  it('aborts a pending review when the workspace identity changes', async () => {
    const first = providerClient(new Promise(() => undefined))
    const second = providerClient(reviewResult('workspace-2', 'github'))
    const view = render(
      createElement(MobileWebProviderReviewCard, {
        client: first,
        workspaceId: 'workspace-1',
        connected: true,
        status: statusResult('workspace-1')
      })
    )
    await waitFor(() => expect(first.providerReview).toHaveBeenCalledOnce())
    const signal = first.providerReview.mock.calls[0]?.[1]?.signal as AbortSignal

    view.rerender(
      createElement(MobileWebProviderReviewCard, {
        client: second,
        workspaceId: 'workspace-2',
        connected: true,
        status: statusResult('workspace-2')
      })
    )

    expect(signal.aborted).toBe(true)
    expect(await screen.findByText('Pull request #42: Review mobile bridge')).toBeTruthy()
  })

  it('keeps unsupported provider details read-only', async () => {
    const result = reviewResult('workspace-1', 'bitbucket')
    if (!result.review) {
      throw new Error('Expected review')
    }
    result.review.detailsState = 'unsupported'
    result.review.canComment = false
    result.review.comments = []
    const client = providerClient(result)
    render(
      createElement(MobileWebProviderReviewCard, {
        client,
        workspaceId: 'workspace-1',
        connected: true,
        status: statusResult('workspace-1')
      })
    )

    expect(
      await screen.findByText('Bitbucket review details are not available in this shell.')
    ).toBeTruthy()
    expect(screen.queryByLabelText('Add comment')).toBeNull()
  })

  it('replies to and resolves only the exact advertised GitHub thread', async () => {
    const result = reviewResult('workspace-1', 'github')
    if (!result.review) {
      throw new Error('Expected review')
    }
    result.review.comments = [
      {
        id: '9',
        author: 'ada',
        body: 'Please check this line.',
        createdAt: '2026-07-23T00:01:00.000Z',
        kind: 'inline',
        path: 'src/review.ts',
        line: 12,
        threadId: 'thread-1',
        threadState: 'open',
        allowedActions: ['reply', 'set-resolved']
      }
    ]
    const client = providerClient(result)
    render(
      createElement(MobileWebProviderReviewCard, {
        client,
        workspaceId: 'workspace-1',
        connected: true,
        status: statusResult('workspace-1')
      })
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Reply' }))
    fireEvent.change(screen.getByLabelText('Reply to ada'), {
      target: { value: 'Verified on Relay.' }
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Reply' })[1]!)
    await waitFor(() => expect(client.providerMutateReview).toHaveBeenCalledOnce())
    expect(client.providerMutateReview).toHaveBeenNthCalledWith(
      1,
      {
        workspaceId: 'workspace-1',
        expectedHead: HEAD,
        expectedBranch: 'feature/review',
        provider: 'github',
        reviewNumber: 42,
        action: 'reply',
        commentId: '9',
        threadId: 'thread-1',
        body: 'Verified on Relay.'
      },
      { signal: expect.any(AbortSignal) }
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Resolve' }))
    await waitFor(() => expect(client.providerMutateReview).toHaveBeenCalledTimes(2))
    expect(client.providerMutateReview).toHaveBeenNthCalledWith(
      2,
      {
        workspaceId: 'workspace-1',
        expectedHead: HEAD,
        expectedBranch: 'feature/review',
        provider: 'github',
        reviewNumber: 42,
        action: 'setThreadResolved',
        threadId: 'thread-1',
        resolved: true
      },
      { signal: expect.any(AbortSignal) }
    )
  })

  it('queues and submits an inline comment for the exact advertised review head, file, and line', async () => {
    const result = reviewResult('workspace-1', 'github')
    if (!result.review) {
      throw new Error('Expected review')
    }
    result.review.headSha = HEAD
    result.review.files = [
      {
        path: 'src/review.ts',
        status: 'modified',
        additions: 2,
        deletions: 1,
        isBinary: false,
        commentableLines: [12, 13],
        commentableLinesTruncated: false
      }
    ]
    const client = providerClient(result)
    render(
      createElement(MobileWebProviderReviewCard, {
        client,
        workspaceId: 'workspace-1',
        connected: true,
        status: statusResult('workspace-1')
      })
    )

    const files = within(await screen.findByRole('region', { name: 'Review files' }))
    fireEvent.click(files.getByRole('button', { name: 'Comment' }))
    fireEvent.change(files.getByLabelText('Comment on src/review.ts'), {
      target: { value: 'Keep this line host-authorized.' }
    })
    fireEvent.click(files.getByRole('button', { name: 'Queue comment' }))

    expect(client.providerMutateReview).not.toHaveBeenCalled()
    expect(await screen.findByText('Keep this line host-authorized.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Submit comments' }))

    await waitFor(() => expect(client.providerSubmitReview).toHaveBeenCalledOnce())
    expect(client.providerSubmitReview).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        expectedHead: HEAD,
        expectedBranch: 'feature/review',
        provider: 'github',
        reviewNumber: 42,
        expectedReviewHead: HEAD,
        submissionId: expect.stringMatching(/^[a-f0-9]{32}$/),
        action: 'comment',
        summary: '',
        comments: [
          {
            id: expect.stringMatching(/^[a-f0-9]{32}$/),
            path: 'src/review.ts',
            line: 12,
            body: 'Keep this line host-authorized.'
          }
        ]
      },
      { signal: expect.any(AbortSignal) }
    )
  })

  it('navigates a retained inline thread to its exact hosted-review diff line', async () => {
    const result = reviewResult('workspace-1', 'github')
    if (!result.review) {
      throw new Error('Expected review')
    }
    result.review.headSha = HEAD
    result.review.files = [
      {
        path: 'src/review.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        isBinary: false,
        commentableLines: [12],
        commentableLinesTruncated: false
      }
    ]
    result.review.comments = [
      {
        id: '9',
        author: 'ada',
        body: 'Please inspect this line.',
        createdAt: '2026-07-23T00:01:00.000Z',
        kind: 'inline',
        path: 'src/review.ts',
        line: 12,
        threadId: 'thread-1',
        threadState: 'open',
        allowedActions: ['reply', 'set-resolved']
      }
    ]
    const client = providerClient(result)
    client.providerReviewDiff.mockResolvedValue({
      workspaceId: 'workspace-1',
      observedHead: HEAD,
      branch: 'feature/review',
      provider: 'github',
      reviewNumber: 42,
      reviewHead: HEAD,
      path: 'src/review.ts',
      kind: 'text',
      revision: 'd'.repeat(64),
      offset: 0,
      totalRows: 1,
      rows: [
        {
          index: 0,
          kind: 'add',
          text: 'focused code',
          textTruncated: false,
          newLineNumber: 12
        }
      ],
      nextOffset: null,
      truncated: false,
      focusLine: 12,
      focusRowIndex: 0
    })
    render(
      createElement(MobileWebProviderReviewCard, {
        client,
        workspaceId: 'workspace-1',
        connected: true,
        status: statusResult('workspace-1')
      })
    )

    fireEvent.click(await screen.findByRole('button', { name: 'View in diff' }))
    await waitFor(() => expect(client.providerReviewDiff).toHaveBeenCalledOnce())
    expect(client.providerReviewDiff).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        expectedHead: HEAD,
        expectedBranch: 'feature/review',
        provider: 'github',
        reviewNumber: 42,
        expectedReviewHead: HEAD,
        path: 'src/review.ts',
        offset: 0,
        limit: 96,
        focusLine: 12
      },
      { signal: expect.any(AbortSignal) }
    )
    const diff = await screen.findByRole('region', { name: 'Hosted review diff' })
    expect(within(diff).getByText('focused code')).toBeTruthy()
    expect(within(diff).getByRole('listitem').getAttribute('aria-current')).toBe('true')
  })
})

function providerClient(
  result: MobileWebProviderReviewResult | Promise<MobileWebProviderReviewResult>
): MobileWebBridgeClient & {
  providerReview: ReturnType<typeof vi.fn>
  providerReviewDiff: ReturnType<typeof vi.fn>
  providerMutateReview: ReturnType<typeof vi.fn>
  providerSubmitReview: ReturnType<typeof vi.fn>
} {
  return {
    providerReview: vi.fn().mockResolvedValue(result),
    providerReviewDiff: vi.fn(),
    providerMutateReview: vi.fn().mockResolvedValue({
      workspaceId: 'workspace-1',
      provider: 'gitlab',
      reviewNumber: 42,
      action: 'comment',
      outcome: 'completed'
    }),
    providerSubmitReview: vi.fn(async (payload) => ({
      workspaceId: payload.workspaceId,
      provider: payload.provider,
      reviewNumber: payload.reviewNumber,
      expectedReviewHead: payload.expectedReviewHead,
      submissionId: payload.submissionId,
      action: payload.action,
      submittedCommentIds: payload.comments.map((comment: { id: string }) => comment.id),
      outcome: 'completed'
    }))
  } as unknown as MobileWebBridgeClient & {
    providerReview: ReturnType<typeof vi.fn>
    providerReviewDiff: ReturnType<typeof vi.fn>
    providerMutateReview: ReturnType<typeof vi.fn>
    providerSubmitReview: ReturnType<typeof vi.fn>
  }
}

function statusResult(workspaceId: string): MobileWebSourceControlStatusResult {
  return {
    workspaceId,
    branch: 'feature/review',
    head: HEAD,
    conflictOperation: 'unknown',
    entries: [],
    totalCount: 0,
    truncated: false
  }
}

function reviewResult(
  workspaceId: string,
  provider: 'github' | 'gitlab' | 'bitbucket'
): MobileWebProviderReviewResult {
  return {
    workspaceId,
    observedHead: HEAD,
    branch: 'feature/review',
    review: {
      provider,
      number: 42,
      title: 'Review mobile bridge',
      state: 'open',
      checksStatus: 'success',
      mergeable: 'MERGEABLE',
      reviewDecision: null,
      updatedAt: '2026-07-23T00:00:00.000Z',
      body: 'Review body',
      comments: [
        {
          id: '1',
          author: 'ada',
          body: '<script>inert comment</script>',
          createdAt: '2026-07-23T00:01:00.000Z',
          kind: 'conversation',
          allowedActions: []
        }
      ],
      commentsTruncated: false,
      files: [],
      filesTruncated: false,
      author: null,
      reviewRequests: [],
      latestReviews: [],
      checks: [],
      detailsState: 'loaded',
      canComment: true,
      allowedSubmissionActions:
        provider === 'github'
          ? ['comment', 'approve', 'request-changes']
          : provider === 'gitlab'
            ? ['comment']
            : []
    }
  }
}
