import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import React from 'react'
import type { MobileWebProviderReview } from '../../shared/mobile-web/provider-review-contract'
import type { MobileWebProviderReviewSubmissionAction } from '../../shared/mobile-web/provider-review-submission-contract'
import { MobileWebProviderReviewTextarea } from './mobile-web-provider-review-conversation'
import type { useMobileWebProviderReviewSubmission } from './use-mobile-web-provider-review-submission'

type SubmissionState = ReturnType<typeof useMobileWebProviderReviewSubmission>

export function MobileWebProviderReviewSubmission({
  review,
  connected,
  submission
}: {
  review: MobileWebProviderReview
  connected: boolean
  submission: SubmissionState
}): React.JSX.Element | null {
  if (review.allowedSubmissionActions.length === 0) {
    return null
  }
  const empty =
    submission.comments.length === 0 &&
    submission.summary.trim().length === 0 &&
    submission.action === 'comment'
  const requestChangesWithoutSummary =
    submission.action === 'request-changes' && submission.summary.trim().length === 0
  return (
    <section className="space-y-3 border-t border-border pt-4" aria-label="Submit review">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Submit review</h3>
        <p className="text-xs text-muted-foreground">
          {review.provider === 'github'
            ? 'Queued comments and the selected verdict are submitted together.'
            : 'GitLab receives queued discussions individually; verdict actions are unavailable.'}
        </p>
      </div>
      {submission.comments.length > 0 ? (
        <div className="space-y-2" aria-label="Queued review comments">
          {submission.comments.map((comment) => (
            <article
              key={comment.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="min-w-0 space-y-1">
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {comment.path}:{comment.line}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>
              </div>
              <Button
                variant="ghost"
                size="xs"
                disabled={submission.submitting}
                onClick={() => submission.removeComment(comment.id)}
              >
                Remove
              </Button>
            </article>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Use Comment on a changed file to queue an inline review comment.
        </p>
      )}
      <div className="space-y-2">
        <label htmlFor="mobile-web-review-summary" className="text-xs font-medium">
          Review summary
        </label>
        <MobileWebProviderReviewTextarea
          id="mobile-web-review-summary"
          value={submission.summary}
          disabled={!connected || submission.submitting}
          onChange={submission.setSummary}
        />
      </div>
      {review.allowedSubmissionActions.length > 1 ? (
        <Select
          value={submission.action}
          disabled={!connected || submission.submitting}
          onValueChange={(value) =>
            submission.setAction(value as MobileWebProviderReviewSubmissionAction)
          }
        >
          <SelectTrigger className="w-full" size="sm" aria-label="Review verdict">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {review.allowedSubmissionActions.map((action) => (
              <SelectItem key={action} value={action}>
                {submissionActionLabel(action)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {requestChangesWithoutSummary ? (
        <p className="text-xs text-muted-foreground">
          Describe the requested changes before submitting.
        </p>
      ) : null}
      {submission.error ? (
        <p role="alert" className="text-xs text-destructive">
          {submission.error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        {submission.requiresRefresh ? (
          <Button
            variant="outline"
            size="sm"
            disabled={!connected || submission.submitting}
            onClick={() => void submission.refreshBeforeRetry()}
          >
            Refresh review
          </Button>
        ) : null}
        <Button
          size="sm"
          disabled={
            !connected ||
            submission.submitting ||
            submission.requiresRefresh ||
            empty ||
            requestChangesWithoutSummary
          }
          onClick={() => void submission.submit()}
        >
          {submission.submitting ? 'Submitting…' : submissionActionLabel(submission.action)}
        </Button>
      </div>
    </section>
  )
}

function submissionActionLabel(action: MobileWebProviderReviewSubmissionAction): string {
  if (action === 'approve') {
    return 'Approve'
  }
  return action === 'request-changes' ? 'Request changes' : 'Submit comments'
}
