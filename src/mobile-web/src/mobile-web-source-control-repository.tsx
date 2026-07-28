import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { RefreshCw } from 'lucide-react'
import React from 'react'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebSourceControlActionDialog } from './mobile-web-source-control-action-dialog'
import { MobileWebSourceControlCompare } from './mobile-web-source-control-compare'
import { MobileWebSourceControlRemoteActions } from './mobile-web-source-control-remote-actions'
import {
  MobileWebBranchList,
  MobileWebHistoryList
} from './mobile-web-source-control-repository-lists'
import { useMobileWebSourceControlRepository } from './use-mobile-web-source-control-repository'

export function MobileWebSourceControlRepository({
  client,
  workspaceId,
  connected,
  onRepositoryChanged
}: {
  client: MobileWebBridgeClient
  workspaceId: string
  connected: boolean
  onRepositoryChanged: () => void
}): React.JSX.Element {
  const repository = useMobileWebSourceControlRepository({
    client,
    workspaceId,
    connected,
    onRepositoryChanged
  })
  return (
    <>
      <Card
        className="mt-4"
        aria-busy={repository.loading || repository.sync.loading || repository.sync.busy !== null}
      >
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>Repository</CardTitle>
            <CardDescription>{repositoryDescription(repository)}</CardDescription>
          </div>
          <CardAction>
            <Button
              aria-label="Refresh branches, history, and upstream"
              variant="outline"
              size="icon-sm"
              disabled={
                !connected ||
                repository.loading ||
                repository.comparisonLoading ||
                repository.sync.loading ||
                repository.sync.busy !== null
              }
              onClick={() => {
                repository.retry()
                repository.sync.retry()
              }}
            >
              <RefreshCw
                className={
                  repository.loading || repository.sync.loading ? 'animate-spin' : undefined
                }
              />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          {repository.error ? (
            <div role="alert" className="border-y border-border px-6 py-3 text-sm">
              <p>Branches and history are unavailable.</p>
              <Button
                variant="outline"
                size="xs"
                className="mt-2"
                disabled={!connected || repository.loading}
                onClick={repository.retry}
              >
                Retry
              </Button>
            </div>
          ) : null}
          <MobileWebSourceControlRemoteActions sync={repository.sync} connected={connected} />
          <Tabs defaultValue="branches">
            <TabsList className="mx-6 flex w-auto">
              <TabsTrigger value="branches">Branches</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
            <TabsContent value="branches">
              <MobileWebBranchList
                result={repository.branches}
                loading={repository.loading}
                connected={connected}
                selection={repository.selection}
                actionsDisabled={
                  repository.sync.busy !== null ||
                  repository.sync.loading ||
                  !repository.sync.repository
                }
                onCompare={repository.compareBranch}
                onSwitch={repository.sync.requestCheckout}
              />
            </TabsContent>
            <TabsContent value="history">
              <MobileWebHistoryList
                result={repository.history}
                loading={repository.loading}
                connected={connected}
                selection={repository.selection}
                canLoadMore={repository.canLoadMoreHistory}
                onCompare={repository.compareCommit}
                onLoadMore={repository.loadMoreHistory}
              />
            </TabsContent>
          </Tabs>
          <MobileWebSourceControlCompare
            selection={repository.selection}
            comparison={repository.comparison}
            loading={repository.comparisonLoading}
            error={repository.comparisonError}
            connected={connected}
            onRetry={repository.retryComparison}
          />
        </CardContent>
      </Card>
      <MobileWebSourceControlActionDialog sync={repository.sync} />
    </>
  )
}

function repositoryDescription(
  repository: ReturnType<typeof useMobileWebSourceControlRepository>
): string {
  if (!repository.branches || !repository.history) {
    return repository.loading ? 'Loading branches and history' : 'Provider-neutral Git metadata'
  }
  const branches = repository.branches.totalCount
  const commits = repository.history.items.length
  return `${branches.toLocaleString()} ${branches === 1 ? 'branch' : 'branches'} · ${commits.toLocaleString()} recent ${commits === 1 ? 'commit' : 'commits'}`
}
