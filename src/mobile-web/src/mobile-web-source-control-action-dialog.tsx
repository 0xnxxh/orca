import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog-foundation'
import React from 'react'
import type {
  MobileWebSourceControlPendingAction,
  MobileWebSourceControlSync
} from './use-mobile-web-source-control-sync'

export function MobileWebSourceControlActionDialog({
  sync
}: {
  sync: MobileWebSourceControlSync
}): React.JSX.Element {
  const action = sync.pending
  const copy = actionCopy(action, sync)
  return (
    <Dialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open && sync.busy === null) {
          sync.cancelPending()
        }
      }}
    >
      <DialogContent className="max-w-sm" showCloseButton={sync.busy === null}>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="ghost" disabled={sync.busy !== null} onClick={sync.cancelPending}>
            Cancel
          </Button>
          <Button
            variant="default"
            disabled={!action || sync.busy !== null}
            onClick={() => void sync.confirmPending()}
          >
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function actionCopy(
  action: MobileWebSourceControlPendingAction | null,
  sync: MobileWebSourceControlSync
): { title: string; description: string; confirm: string } {
  if (!action) {
    return { title: 'Repository action', description: '', confirm: 'Continue' }
  }
  if (action.kind === 'checkout') {
    return {
      title: `Switch to ${action.branch}?`,
      description:
        'Uncommitted changes remain in the working tree. Git will refuse the switch if they would be overwritten.',
      confirm: 'Switch branch'
    }
  }
  if (action.kind === 'pull') {
    const behind = sync.repository?.upstream.behind ?? 0
    return action.strategy === 'fast-forward'
      ? {
          title: `Pull ${behind.toLocaleString()} ${behind === 1 ? 'commit' : 'commits'}?`,
          description: 'This fast-forwards the current branch from its configured upstream.',
          confirm: 'Pull'
        }
      : {
          title: 'Pull and merge divergent changes?',
          description:
            'The local and upstream branches both contain commits. Git may create a merge commit or stop for conflicts.',
          confirm: 'Pull and merge'
        }
  }
  if (action.kind === 'push') {
    if (action.mode === 'publish') {
      return {
        title: `Publish ${sync.repository?.branch ?? 'this branch'}?`,
        description:
          'This sends the current branch to the configured remote and establishes its upstream.',
        confirm: 'Publish branch'
      }
    }
    return {
      title: 'Push local commits?',
      description:
        'This sends commits to the configured remote. Force push is not available from this mobile flow.',
      confirm: 'Push'
    }
  }
  if (action.kind === 'rebase') {
    return {
      title: `Rebase onto ${action.baseRef}?`,
      description:
        'This rewrites local commits on the configured base and may stop for conflicts. It does not force push.',
      confirm: 'Rebase'
    }
  }
  return {
    title: `Abort ${action.conflictOperation}?`,
    description: `Git will stop the ${action.conflictOperation} and restore its pre-operation state.`,
    confirm: `Abort ${action.conflictOperation}`
  }
}
