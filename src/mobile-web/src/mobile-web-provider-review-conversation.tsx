import { Button } from '@renderer/components/ui/button'
import React, { useId, useState } from 'react'
import {
  MOBILE_WEB_PROVIDER_COMMENT_BODY_MAX_CHARACTERS,
  type MobileWebProviderReview,
  type MobileWebProviderReviewComment
} from '../../shared/mobile-web/provider-review-contract'

export function MobileWebProviderReviewConversation({
  review,
  connected,
  mutationKey,
  mutationError,
  mutationErrorKey,
  canOpenDiff,
  onOpenDiff,
  onComment,
  onReply,
  onSetThreadResolved
}: {
  review: MobileWebProviderReview
  connected: boolean
  mutationKey: string | null
  mutationError: string | null
  mutationErrorKey: string | null
  canOpenDiff: (comment: MobileWebProviderReviewComment) => boolean
  onOpenDiff: (comment: MobileWebProviderReviewComment) => void
  onComment: (body: string) => Promise<boolean>
  onReply: (comment: MobileWebProviderReviewComment, body: string) => Promise<boolean>
  onSetThreadResolved: (
    comment: MobileWebProviderReviewComment,
    resolved: boolean
  ) => Promise<boolean>
}): React.JSX.Element {
  return (
    <>
      <section className="space-y-2 border-t border-border pt-4" aria-label="Review conversation">
        <h3 className="text-sm font-medium">Conversation</h3>
        {review.comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          <div className="space-y-3">
            {review.comments.map((comment) => (
              <ReviewComment
                key={`${comment.id}:${comment.threadId ?? ''}`}
                comment={comment}
                connected={connected}
                mutationKey={mutationKey}
                error={commentMutationError(comment, mutationError, mutationErrorKey)}
                canOpenDiff={canOpenDiff(comment)}
                onOpenDiff={() => onOpenDiff(comment)}
                onReply={onReply}
                onSetThreadResolved={onSetThreadResolved}
              />
            ))}
          </div>
        )}
        {review.commentsTruncated ? (
          <p className="text-xs text-muted-foreground">Showing the 32 most recent comments.</p>
        ) : null}
      </section>
      <CommentComposer
        connected={connected}
        busy={mutationKey !== null}
        posting={mutationKey === 'comment'}
        error={mutationErrorKey === 'comment' ? mutationError : null}
        onComment={onComment}
      />
    </>
  )
}

function ReviewComment({
  comment,
  connected,
  mutationKey,
  error,
  canOpenDiff,
  onOpenDiff,
  onReply,
  onSetThreadResolved
}: {
  comment: MobileWebProviderReviewComment
  connected: boolean
  mutationKey: string | null
  error: string | null
  canOpenDiff: boolean
  onOpenDiff: () => void
  onReply: (comment: MobileWebProviderReviewComment, body: string) => Promise<boolean>
  onSetThreadResolved: (
    comment: MobileWebProviderReviewComment,
    resolved: boolean
  ) => Promise<boolean>
}): React.JSX.Element {
  const [replying, setReplying] = useState(false)
  const replyKey = comment.threadId ? `reply:${comment.threadId}:${comment.id}` : ''
  const threadKey = comment.threadId ? `thread:${comment.threadId}` : ''
  const busy = mutationKey !== null
  return (
    <article className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-medium">{comment.author || 'Unknown author'}</p>
        <p className="text-[11px] text-muted-foreground">{displayTimestamp(comment.createdAt)}</p>
      </div>
      {comment.kind === 'inline' ? (
        <InlineCommentLocation
          comment={comment}
          canOpenDiff={canOpenDiff}
          onOpenDiff={onOpenDiff}
        />
      ) : null}
      <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>
      {comment.allowedActions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {comment.allowedActions.includes('reply') ? (
            <Button
              variant="outline"
              size="xs"
              disabled={!connected || busy}
              onClick={() => setReplying((value) => !value)}
            >
              Reply
            </Button>
          ) : null}
          {comment.allowedActions.includes('set-resolved') ? (
            <Button
              variant="outline"
              size="xs"
              disabled={!connected || busy}
              onClick={() => void onSetThreadResolved(comment, comment.threadState !== 'resolved')}
            >
              {mutationKey === threadKey
                ? 'Updating…'
                : comment.threadState === 'resolved'
                  ? 'Reopen'
                  : 'Resolve'}
            </Button>
          ) : null}
        </div>
      ) : null}
      {replying ? (
        <ReplyComposer
          comment={comment}
          connected={connected}
          busy={busy}
          posting={mutationKey === replyKey}
          error={error}
          onReply={onReply}
          onClose={() => setReplying(false)}
        />
      ) : error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </article>
  )
}

function InlineCommentLocation({
  comment,
  canOpenDiff,
  onOpenDiff
}: {
  comment: MobileWebProviderReviewComment
  canOpenDiff: boolean
  onOpenDiff: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="font-mono text-[11px] text-muted-foreground">
        {comment.path ?? 'Inline comment'}
        {comment.line ? `:${comment.line}` : ''}
        {comment.threadState ? ` · ${comment.threadState}` : ''}
      </p>
      {canOpenDiff ? (
        <Button variant="link" size="xs" className="h-auto p-0" onClick={onOpenDiff}>
          View in diff
        </Button>
      ) : null}
    </div>
  )
}

function ReplyComposer({
  comment,
  connected,
  busy,
  posting,
  error,
  onReply,
  onClose
}: {
  comment: MobileWebProviderReviewComment
  connected: boolean
  busy: boolean
  posting: boolean
  error: string | null
  onReply: (comment: MobileWebProviderReviewComment, body: string) => Promise<boolean>
  onClose: () => void
}): React.JSX.Element {
  const inputId = useId()
  const [body, setBody] = useState('')
  const submit = async () => {
    if (await onReply(comment, body)) {
      setBody('')
      onClose()
    }
  }
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <label htmlFor={inputId} className="text-xs font-medium">
        Reply to {comment.author || 'comment'}
      </label>
      <MobileWebProviderReviewTextarea
        id={inputId}
        value={body}
        disabled={!connected || busy}
        onChange={setBody}
      />
      {error ? <MobileWebProviderReviewMutationError message={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="xs" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="xs"
          disabled={!connected || busy || body.trim().length === 0}
          onClick={() => void submit()}
        >
          {posting ? 'Posting…' : 'Reply'}
        </Button>
      </div>
    </div>
  )
}

function CommentComposer({
  connected,
  busy,
  posting,
  error,
  onComment
}: {
  connected: boolean
  busy: boolean
  posting: boolean
  error: string | null
  onComment: (body: string) => Promise<boolean>
}): React.JSX.Element {
  const [body, setBody] = useState('')
  const submit = async () => {
    if (await onComment(body)) {
      setBody('')
    }
  }
  return (
    <section className="space-y-2 border-t border-border pt-4" aria-label="Add review comment">
      <label htmlFor="mobile-web-review-comment" className="text-sm font-medium">
        Add comment
      </label>
      <MobileWebProviderReviewTextarea
        id="mobile-web-review-comment"
        value={body}
        disabled={!connected || busy}
        onChange={setBody}
      />
      {error ? <MobileWebProviderReviewMutationError message={error} /> : null}
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!connected || busy || body.trim().length === 0}
          onClick={() => void submit()}
        >
          {posting ? 'Posting…' : 'Comment'}
        </Button>
      </div>
    </section>
  )
}

export function MobileWebProviderReviewTextarea({
  id,
  value,
  disabled,
  onChange
}: {
  id: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <textarea
      id={id}
      className="min-h-24 w-full resize-y rounded-md border border-input bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
      value={value}
      maxLength={MOBILE_WEB_PROVIDER_COMMENT_BODY_MAX_CHARACTERS}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

export function MobileWebProviderReviewMutationError({
  message
}: {
  message: string
}): React.JSX.Element {
  return (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  )
}

function commentMutationError(
  comment: MobileWebProviderReviewComment,
  error: string | null,
  errorKey: string | null
): string | null {
  if (!comment.threadId || !errorKey) {
    return null
  }
  return errorKey === `reply:${comment.threadId}:${comment.id}` ||
    errorKey === `thread:${comment.threadId}`
    ? error
    : null
}

function displayTimestamp(value: string): string {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString()
}
