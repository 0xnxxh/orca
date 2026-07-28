import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import React, { useId, useState } from 'react'
import type {
  MobileWebProviderReview,
  MobileWebProviderReviewFile
} from '../../shared/mobile-web/provider-review-contract'
import {
  MobileWebProviderReviewMutationError,
  MobileWebProviderReviewTextarea
} from './mobile-web-provider-review-conversation'

export function MobileWebProviderReviewFiles({
  review,
  connected,
  activeDiffPath,
  mutationKey,
  mutationError,
  mutationErrorKey,
  onOpenDiff,
  onInlineComment
}: {
  review: MobileWebProviderReview
  connected: boolean
  activeDiffPath: string | null
  mutationKey: string | null
  mutationError: string | null
  mutationErrorKey: string | null
  onOpenDiff: (file: MobileWebProviderReviewFile) => void
  onInlineComment: (
    file: MobileWebProviderReviewFile,
    line: number,
    body: string
  ) => Promise<boolean>
}): React.JSX.Element | null {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  if (review.files.length === 0) {
    return null
  }
  return (
    <section className="space-y-2 border-t border-border pt-4" aria-label="Review files">
      <h3 className="text-sm font-medium">Changed files</h3>
      <div className="space-y-2">
        {review.files.map((file) => (
          <ReviewFileRow
            key={file.path}
            file={file}
            reviewHeadAvailable={Boolean(review.headSha)}
            connected={connected}
            busy={mutationKey !== null}
            selected={selectedPath === file.path}
            activeDiff={activeDiffPath === file.path}
            mutationKey={mutationKey}
            error={mutationErrorKey?.startsWith(`inline:${file.path}:`) ? mutationError : null}
            onSelect={() => setSelectedPath(file.path)}
            onClose={() => setSelectedPath(null)}
            onOpenDiff={() => onOpenDiff(file)}
            onInlineComment={onInlineComment}
          />
        ))}
      </div>
      {review.filesTruncated ? (
        <p className="text-xs text-muted-foreground">
          Showing the first 48 files returned for this review.
        </p>
      ) : null}
    </section>
  )
}

function ReviewFileRow({
  file,
  reviewHeadAvailable,
  connected,
  busy,
  selected,
  activeDiff,
  mutationKey,
  error,
  onSelect,
  onClose,
  onOpenDiff,
  onInlineComment
}: {
  file: MobileWebProviderReviewFile
  reviewHeadAvailable: boolean
  connected: boolean
  busy: boolean
  selected: boolean
  activeDiff: boolean
  mutationKey: string | null
  error: string | null
  onSelect: () => void
  onClose: () => void
  onOpenDiff: () => void
  onInlineComment: (
    file: MobileWebProviderReviewFile,
    line: number,
    body: string
  ) => Promise<boolean>
}): React.JSX.Element {
  const commentable = reviewHeadAvailable && file.commentableLines.length > 0 && !file.isBinary
  return (
    <article className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate font-mono text-xs">{file.path}</p>
          <p className="text-[11px] text-muted-foreground">
            {file.status} · +{file.additions} −{file.deletions}
            {file.isBinary ? ' · binary' : ''}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="xs"
            disabled={!connected || busy || !reviewHeadAvailable}
            onClick={onOpenDiff}
          >
            {activeDiff ? 'Reload diff' : 'View diff'}
          </Button>
          <Button
            variant="outline"
            size="xs"
            disabled={!connected || busy || !commentable}
            onClick={onSelect}
          >
            Comment
          </Button>
        </div>
      </div>
      {!commentable ? (
        <p className="text-xs text-muted-foreground">
          {file.isBinary
            ? 'Inline comments are unavailable for binary files.'
            : 'No commentable modified lines were retained for this file.'}
        </p>
      ) : null}
      {selected ? (
        <InlineCommentComposer
          file={file}
          connected={connected}
          busy={busy}
          mutationKey={mutationKey}
          error={error}
          onClose={onClose}
          onInlineComment={onInlineComment}
        />
      ) : null}
    </article>
  )
}

function InlineCommentComposer({
  file,
  connected,
  busy,
  mutationKey,
  error,
  onClose,
  onInlineComment
}: {
  file: MobileWebProviderReviewFile
  connected: boolean
  busy: boolean
  mutationKey: string | null
  error: string | null
  onClose: () => void
  onInlineComment: (
    file: MobileWebProviderReviewFile,
    line: number,
    body: string
  ) => Promise<boolean>
}): React.JSX.Element {
  const inputId = useId()
  const [line, setLine] = useState(file.commentableLines[0]!)
  const [body, setBody] = useState('')
  const key = `inline:${file.path}:${line}`
  const submit = async () => {
    if (await onInlineComment(file, line, body)) {
      setBody('')
      onClose()
    }
  }
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <label htmlFor={inputId} className="text-xs font-medium">
        Comment on {file.path}
      </label>
      <Select
        value={String(line)}
        disabled={!connected || busy}
        onValueChange={(value) => setLine(Number(value))}
      >
        <SelectTrigger className="w-full" size="sm" aria-label={`Line for ${file.path}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {file.commentableLines.map((candidate) => (
            <SelectItem key={candidate} value={String(candidate)}>
              Line {candidate}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <MobileWebProviderReviewTextarea
        id={inputId}
        value={body}
        disabled={!connected || busy}
        onChange={setBody}
      />
      {file.commentableLinesTruncated ? (
        <p className="text-[11px] text-muted-foreground">
          Only the retained commentable lines are available.
        </p>
      ) : null}
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
          {mutationKey === key ? 'Queueing…' : 'Queue comment'}
        </Button>
      </div>
    </div>
  )
}
