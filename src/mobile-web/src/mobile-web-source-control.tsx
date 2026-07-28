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
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebProviderReviewCard } from './mobile-web-provider-review'
import { MobileWebSourceControlDiff } from './mobile-web-source-control-diff'
import { MobileWebSourceControlCommitComposer } from './mobile-web-source-control-commit'
import { MobileWebSourceControlDiscardDialog } from './mobile-web-source-control-discard-dialog'
import { MobileWebSourceControlRepository } from './mobile-web-source-control-repository'
import { MobileWebSourceControlStatusList } from './mobile-web-source-control-status-list'
import { useMobileWebDiffDocument } from './use-mobile-web-diff-document'
import { useMobileWebSourceControlMutations } from './use-mobile-web-source-control-mutations'
import { useMobileWebSourceControlCommit } from './use-mobile-web-source-control-commit'
import { useMobileWebSourceControlStatus } from './use-mobile-web-source-control-status'

export function MobileWebSourceControl({
  client,
  workspaceId,
  connected
}: {
  client: MobileWebBridgeClient
  workspaceId: string
  connected: boolean
}): React.JSX.Element {
  const status = useMobileWebSourceControlStatus({ client, workspaceId, connected })
  const diff = useMobileWebDiffDocument({ client, workspaceId, connected })
  const mutations = useMobileWebSourceControlMutations({
    client,
    workspaceId,
    connected,
    status: status.result,
    onRefresh: status.retry
  })
  const commit = useMobileWebSourceControlCommit({
    client,
    workspaceId,
    connected,
    status: status.result,
    statusLoading: status.loading,
    mutationBusy: mutations.busyOperation !== null,
    onRefresh: status.retry
  })

  return (
    <>
      <Card className="mt-4" aria-busy={status.loading}>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>Changes</CardTitle>
            <CardDescription>{statusDescription(status.result)}</CardDescription>
          </div>
          <CardAction>
            <Button
              aria-label="Refresh changes"
              variant="outline"
              size="icon-sm"
              disabled={
                !connected ||
                status.loading ||
                mutations.busyOperation !== null ||
                commit.busy !== null
              }
              onClick={status.retry}
            >
              <RefreshCw className={status.loading ? 'animate-spin' : undefined} />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          <MobileWebSourceControlCommitComposer commit={commit} />
          <MobileWebSourceControlStatusList
            entries={status.result?.entries ?? null}
            loading={status.loading}
            error={status.error}
            connected={connected}
            selected={diff.entry}
            mutations={mutations}
            externalBusy={commit.busy !== null}
            onOpen={diff.open}
            onRetry={status.retry}
          />
          {status.result?.truncated ? (
            <p className="border-t border-border px-6 py-2 text-xs text-muted-foreground">
              Showing {status.result.entries.length.toLocaleString()} of{' '}
              {status.result.totalCount.toLocaleString()} changes.
            </p>
          ) : null}
          {status.liveRefresh === 'unavailable' ? (
            <p
              role="status"
              className="border-t border-border px-6 py-2 text-xs text-muted-foreground"
            >
              Live refresh is unavailable. Use Refresh to check again.
            </p>
          ) : null}
          <MobileWebSourceControlDiff
            entry={diff.entry}
            document={diff.document}
            loading={diff.loading}
            error={diff.error}
            connected={connected}
            onLoadMore={diff.loadMore}
            onRetry={diff.retry}
            onCancel={diff.cancel}
          />
        </CardContent>
      </Card>
      <MobileWebSourceControlRepository
        client={client}
        workspaceId={workspaceId}
        connected={connected}
        onRepositoryChanged={status.retry}
      />
      <MobileWebProviderReviewCard
        client={client}
        workspaceId={workspaceId}
        connected={connected}
        status={status.result}
      />
      <MobileWebSourceControlDiscardDialog
        targets={mutations.discardTargets}
        busy={mutations.busyOperation === 'discard'}
        error={mutations.error}
        onCancel={mutations.cancelDiscard}
        onConfirm={() => void mutations.confirmDiscard()}
      />
    </>
  )
}

function statusDescription(
  result: ReturnType<typeof useMobileWebSourceControlStatus>['result']
): string {
  if (!result) {
    return 'Loading provider-neutral Git status'
  }
  const count = result.totalCount
  const branch = result.branch ? `${result.branch} · ` : ''
  return `${branch}${count.toLocaleString()} ${count === 1 ? 'change' : 'changes'}`
}
