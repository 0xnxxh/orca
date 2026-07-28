import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { RefreshCw } from 'lucide-react'
import React from 'react'
import type { MobileWebProviderReview } from '../../shared/mobile-web/provider-review-contract'
import type { MobileWebSourceControlStatusResult } from '../../shared/mobile-web/source-control-operation-contract'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebProviderReviewConversation } from './mobile-web-provider-review-conversation'
import { MobileWebProviderReviewDiff } from './mobile-web-provider-review-diff'
import { MobileWebProviderReviewFiles } from './mobile-web-provider-review-files'
import { MobileWebProviderReviewSubmission } from './mobile-web-provider-review-submission'
import { useMobileWebProviderReview } from './use-mobile-web-provider-review'
import { useMobileWebProviderReviewDiff } from './use-mobile-web-provider-review-diff'
import { useMobileWebProviderReviewSubmission } from './use-mobile-web-provider-review-submission'

export function MobileWebProviderReviewCard({
  client,
  workspaceId,
  connected,
  status
}: {
  client: MobileWebBridgeClient
  workspaceId: string
  connected: boolean
  status: MobileWebSourceControlStatusResult | null
}): React.JSX.Element {
  const reviewState = useMobileWebProviderReview({ client, workspaceId, connected, status })
  const review = reviewState.result?.review ?? null
  const diff = useMobileWebProviderReviewDiff({
    client,
    workspaceId,
    connected,
    status,
    review
  })
  const submission = useMobileWebProviderReviewSubmission({
    client,
    workspaceId,
    connected,
    status,
    review,
    refreshReview: reviewState.retry
  })
  return (
    <Card
      className="mt-4"
      aria-busy={reviewState.loading || reviewState.mutationKey !== null || submission.submitting}
    >
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>Hosted review</CardTitle>
          <CardDescription>
            {reviewDescription(status, review, reviewState.loading)}
          </CardDescription>
        </div>
        <CardAction>
          <Button
            aria-label="Refresh hosted review"
            variant="outline"
            size="icon-sm"
            disabled={
              !connected ||
              reviewState.loading ||
              reviewState.mutationKey !== null ||
              !status?.branch
            }
            onClick={() => void reviewState.retry()}
          >
            <RefreshCw className={reviewState.loading ? 'animate-spin' : undefined} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <ReviewContent
          review={review}
          connected={connected}
          loading={reviewState.loading}
          error={reviewState.error}
          mutationKey={reviewState.mutationKey}
          mutationError={reviewState.mutationError}
          mutationErrorKey={reviewState.mutationErrorKey}
          diff={diff}
          submission={submission}
          onComment={reviewState.comment}
          onReply={reviewState.reply}
          onSetThreadResolved={reviewState.setThreadResolved}
          onRetry={reviewState.retry}
        />
      </CardContent>
    </Card>
  )
}

function ReviewContent({
  review,
  connected,
  loading,
  error,
  mutationKey,
  mutationError,
  mutationErrorKey,
  diff,
  submission,
  onComment,
  onReply,
  onSetThreadResolved,
  onRetry
}: {
  review: MobileWebProviderReview | null
  connected: boolean
  loading: boolean
  error: string | null
  mutationKey: ReturnType<typeof useMobileWebProviderReview>['mutationKey']
  mutationError: ReturnType<typeof useMobileWebProviderReview>['mutationError']
  mutationErrorKey: ReturnType<typeof useMobileWebProviderReview>['mutationErrorKey']
  diff: ReturnType<typeof useMobileWebProviderReviewDiff>
  submission: ReturnType<typeof useMobileWebProviderReviewSubmission>
  onComment: (body: string) => Promise<boolean>
  onReply: ReturnType<typeof useMobileWebProviderReview>['reply']
  onSetThreadResolved: ReturnType<typeof useMobileWebProviderReview>['setThreadResolved']
  onRetry: () => Promise<void>
}): React.JSX.Element {
  if (error) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{error}</p>
        <Button variant="outline" size="xs" disabled={!connected || loading} onClick={onRetry}>
          Retry
        </Button>
      </div>
    )
  }
  if (!review) {
    return (
      <p className="text-sm text-muted-foreground">
        {loading ? 'Checking this branch for a hosted review…' : 'No hosted review was found.'}
      </p>
    )
  }
  return (
    <>
      <ReviewSummary review={review} />
      {review.detailsState !== 'loaded' ? (
        <p role="status" className="text-sm text-muted-foreground">
          {review.detailsState === 'unsupported'
            ? `${providerLabel(review.provider)} review details are not available in this shell.`
            : 'Review conversation details are temporarily unavailable.'}
        </p>
      ) : (
        <>
          <MobileWebProviderReviewFiles
            review={review}
            connected={connected && review.canComment}
            activeDiffPath={diff.file?.path ?? null}
            mutationKey={mutationKey}
            mutationError={mutationError}
            mutationErrorKey={mutationErrorKey}
            onOpenDiff={diff.open}
            onInlineComment={submission.queueComment}
          />
          <MobileWebProviderReviewDiff diff={diff} connected={connected} />
          <MobileWebProviderReviewSubmission
            review={review}
            connected={connected && review.canComment}
            submission={submission}
          />
          <MobileWebProviderReviewConversation
            review={review}
            connected={connected && review.canComment}
            mutationKey={mutationKey}
            mutationError={mutationError}
            mutationErrorKey={mutationErrorKey}
            canOpenDiff={(comment) =>
              Boolean(
                review.headSha &&
                comment.path &&
                comment.line &&
                review.files.some((file) => file.path === comment.path)
              )
            }
            onOpenDiff={(comment) => {
              const file = review.files.find((candidate) => candidate.path === comment.path)
              if (file && comment.line) {
                diff.open(file, comment.line)
              }
            }}
            onComment={onComment}
            onReply={onReply}
            onSetThreadResolved={onSetThreadResolved}
          />
        </>
      )}
    </>
  )
}

function ReviewSummary({ review }: { review: MobileWebProviderReview }): React.JSX.Element {
  return (
    <section className="space-y-3" aria-label="Hosted review summary">
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{providerLabel(review.provider)}</Badge>
        <Badge variant="secondary">{stateLabel(review.state)}</Badge>
        <Badge variant="outline">{checksLabel(review.checksStatus)}</Badge>
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium">
          {reviewLabel(review.provider)} #{review.number}: {review.title || 'Untitled review'}
        </h3>
        {review.body ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{review.body}</p>
        ) : null}
      </div>
    </section>
  )
}

function reviewDescription(
  status: MobileWebSourceControlStatusResult | null,
  review: MobileWebProviderReview | null,
  loading: boolean
): string {
  if (!status?.branch || !status.head) {
    return 'Check out a branch to discover its hosted review'
  }
  if (review) {
    return `${status.branch} · ${providerLabel(review.provider)} #${review.number}`
  }
  return loading ? `Checking ${status.branch}` : status.branch
}

function providerLabel(provider: MobileWebProviderReview['provider']): string {
  switch (provider) {
    case 'github':
      return 'GitHub'
    case 'gitlab':
      return 'GitLab'
    case 'bitbucket':
      return 'Bitbucket'
    case 'azure-devops':
      return 'Azure DevOps'
    case 'gitea':
      return 'Gitea'
  }
}

function reviewLabel(provider: MobileWebProviderReview['provider']): string {
  return provider === 'gitlab' ? 'Merge request' : 'Pull request'
}

function stateLabel(state: MobileWebProviderReview['state']): string {
  return state === 'draft' ? 'Draft' : `${state.charAt(0).toUpperCase()}${state.slice(1)}`
}

function checksLabel(status: MobileWebProviderReview['checksStatus']): string {
  return status === 'neutral'
    ? 'No check result'
    : `Checks ${status === 'pending' ? 'pending' : status}`
}
