import type { GitPushTarget } from '../../../../shared/types'
import type { RuntimeGitRepositorySnapshotRevisionMessage } from '../../../../shared/runtime-git-repository-snapshot-revision'
import type { RuntimeGitRepositorySnapshotRevisionSubscription } from '../../orca-runtime-git'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { GitProviderStatusOptions } from '../../../providers/types'

export async function runGitRepositorySnapshotRevisionStream(args: {
  runtime: OrcaRuntimeService
  worktree: string
  options: GitProviderStatusOptions | undefined
  pushTarget: GitPushTarget | undefined
  connectionId?: string
  signal?: AbortSignal
  subscriptionId: string
  emit: (message: RuntimeGitRepositorySnapshotRevisionMessage) => void
}): Promise<void> {
  if (args.signal?.aborted) {
    return
  }
  await new Promise<void>((resolve, reject) => {
    let closed = false
    let setupFailed = false
    let endEmitted = false
    let subscription: RuntimeGitRepositorySnapshotRevisionSubscription | null = null
    let setupPromise: Promise<RuntimeGitRepositorySnapshotRevisionSubscription> | null = null
    let cleanupPromise: Promise<void> | null = null
    const cleanup = (): Promise<void> => {
      if (cleanupPromise) {
        return cleanupPromise
      }
      closed = true
      args.signal?.removeEventListener('abort', handleAbort)
      cleanupPromise = (async () => {
        if (!subscription && setupPromise) {
          subscription = await setupPromise.catch(() => null)
        }
        subscription?.unsubscribe()
        if (!setupFailed && !endEmitted) {
          endEmitted = true
          args.emit({ type: 'end' })
        }
        if (!setupFailed) {
          resolve()
        }
      })()
      return cleanupPromise
    }
    function handleAbort(): void {
      args.runtime.cleanupSubscription(args.subscriptionId)
    }

    args.signal?.addEventListener('abort', handleAbort, { once: true })
    args.runtime.registerSubscriptionCleanup(args.subscriptionId, cleanup, args.connectionId)
    setupPromise = args.runtime.subscribeRuntimeGitRepositorySnapshotRevision(
      args.worktree,
      args.options,
      args.pushTarget,
      (event) => {
        if (!closed) {
          args.emit({ type: 'revision', event })
        }
      }
    )
    void setupPromise
      .then((nextSubscription) => {
        subscription = nextSubscription
        if (closed) {
          return
        }
        args.emit({
          type: 'subscribed',
          subscriptionId: args.subscriptionId,
          incarnation: nextSubscription.incarnation
        })
      })
      .catch(async (error) => {
        if (closed) {
          return
        }
        setupFailed = true
        await args.runtime.cleanupSubscriptionAndWait(args.subscriptionId).catch(() => undefined)
        reject(error)
      })
    if (args.signal?.aborted) {
      handleAbort()
    }
  })
}
