import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Loader2, Sparkles } from 'lucide-react'
import React from 'react'
import { MOBILE_WEB_COMMIT_MESSAGE_MAX_CHARACTERS } from '../../shared/mobile-web/source-control-commit-contract'
import type { MobileWebSourceControlCommit } from './use-mobile-web-source-control-commit'

export function MobileWebSourceControlCommitComposer({
  commit
}: {
  commit: MobileWebSourceControlCommit
}): React.JSX.Element {
  const generating = commit.busy === 'generate'
  const committing = commit.busy === 'commit'
  return (
    <form
      aria-busy={commit.busy !== null}
      className="space-y-2 border-t border-border px-6 py-3"
      onSubmit={(event) => {
        event.preventDefault()
        void commit.commit()
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          aria-label="Commit message"
          value={commit.message}
          maxLength={MOBILE_WEB_COMMIT_MESSAGE_MAX_CHARACTERS}
          placeholder={commit.stagedCount > 0 ? 'Commit message' : 'No staged files'}
          disabled={commit.stagedCount === 0 || commit.busy !== null}
          onChange={(event) => commit.setMessage(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          className="w-24"
          disabled={!generating && !commit.canGenerate}
          onClick={() => {
            if (generating) {
              commit.cancelGeneration()
            } else {
              void commit.generate()
            }
          }}
        >
          {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {generating ? 'Cancel' : 'Generate'}
        </Button>
        <Button type="submit" className="w-20" disabled={!commit.canCommit}>
          {committing ? <Loader2 className="animate-spin" /> : null}
          Commit
        </Button>
      </div>
      <div className="flex min-h-6 items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          {commit.blockedReason ??
            `${commit.stagedCount.toLocaleString()} staged ${
              commit.stagedCount === 1 ? 'file' : 'files'
            }`}
        </p>
        {commit.error ? (
          <div role="alert" className="flex items-center gap-2 text-xs text-destructive">
            <span>{commit.error}</span>
            <Button type="button" variant="ghost" size="xs" onClick={commit.clearError}>
              Dismiss
            </Button>
          </div>
        ) : null}
      </div>
    </form>
  )
}
