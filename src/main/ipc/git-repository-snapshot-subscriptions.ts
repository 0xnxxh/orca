import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import type { WebContents } from 'electron'
import type {
  GitRepositorySnapshotRequest,
  GitRepositorySnapshotRevisionEvent,
  GitRepositorySnapshotSubscriptionEvent
} from '../../shared/git-repository-snapshot'
import { assertGitPushTargetShape } from '../../shared/git-push-target-validation'
import { subscribeGitRepositorySnapshot } from '../git/status'
import type { Store } from '../persistence'
import type { SshGitProvider } from '../providers/ssh-git-provider'
import {
  getSshGitProvider,
  getSshGitProviderGeneration,
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE,
  subscribeSshGitProviderRegistry
} from '../providers/ssh-git-dispatch'
import { resolveLocalGitRepositorySnapshotRequest } from './git-repository-snapshot-request'

const SUBSCRIBE_CHANNEL = 'git:subscribeRepositorySnapshot'
const UNSUBSCRIBE_CHANNEL = 'git:unsubscribeRepositorySnapshot'
export const GIT_REPOSITORY_SNAPSHOT_REVISION_CHANNEL = 'git:repositorySnapshotRevision'

type RetainedSubscription = {
  id: string
  args: GitRepositorySnapshotRequest
  sender: WebContents
  senderId: number
  incarnation: number
  bindingToken: number
  unsubscribeOwner: () => void
  removeDestroyedListener: () => void
}

const subscriptions = new Map<string, RetainedSubscription>()
let disposeRegistryListener: (() => void) | null = null

function closeSubscription(subscription: RetainedSubscription): void {
  if (subscriptions.get(subscription.id) !== subscription) {
    return
  }
  subscriptions.delete(subscription.id)
  subscription.bindingToken += 1
  subscription.unsubscribeOwner()
  subscription.removeDestroyedListener()
}

function sendEvent(
  subscription: RetainedSubscription,
  event: GitRepositorySnapshotRevisionEvent,
  token: number
): void {
  if (
    subscriptions.get(subscription.id) !== subscription ||
    subscription.bindingToken !== token ||
    subscription.sender.isDestroyed()
  ) {
    return
  }
  const payload: GitRepositorySnapshotSubscriptionEvent = Object.freeze({
    ...event,
    incarnation: subscription.incarnation
  })
  try {
    subscription.sender.send(GIT_REPOSITORY_SNAPSHOT_REVISION_CHANNEL, {
      subscriptionId: subscription.id,
      event: payload
    })
  } catch {
    closeSubscription(subscription)
  }
}

function bindSshProvider(
  subscription: RetainedSubscription,
  provider: SshGitProvider,
  incarnation: number
): void {
  subscription.bindingToken += 1
  const token = subscription.bindingToken
  subscription.incarnation = incarnation
  subscription.unsubscribeOwner = provider.subscribeRepositorySnapshot(
    subscription.args.worktreePath,
    {
      includeIgnored: subscription.args.includeIgnored,
      bypassEffectiveUpstreamNegativeCache: subscription.args.bypassEffectiveUpstreamNegativeCache,
      reuseLineStats: subscription.args.reuseLineStats
    },
    subscription.args.pushTarget,
    (event) => sendEvent(subscription, event, token)
  )
}

function handleSshProviderChange(event: {
  connectionId: string
  generation: number
  provider: SshGitProvider | undefined
}): void {
  for (const subscription of subscriptions.values()) {
    if (subscription.args.connectionId !== event.connectionId) {
      continue
    }
    subscription.bindingToken += 1
    subscription.unsubscribeOwner()
    subscription.unsubscribeOwner = () => {}
    subscription.incarnation = event.generation
    sendEvent(
      subscription,
      { state: 'invalidated', generation: 0, revision: 0 },
      subscription.bindingToken
    )
    if (event.provider && subscriptions.get(subscription.id) === subscription) {
      bindSshProvider(subscription, event.provider, event.generation)
    }
  }
}

export function disposeGitRepositorySnapshotSubscriptionHandlers(): void {
  for (const subscription of Array.from(subscriptions.values())) {
    closeSubscription(subscription)
  }
  disposeRegistryListener?.()
  disposeRegistryListener = null
  ipcMain.removeHandler(SUBSCRIBE_CHANNEL)
  ipcMain.removeHandler(UNSUBSCRIBE_CHANNEL)
}

export function registerGitRepositorySnapshotSubscriptionHandlers(store: Store): void {
  disposeGitRepositorySnapshotSubscriptionHandlers()
  disposeRegistryListener = subscribeSshGitProviderRegistry(handleSshProviderChange)

  ipcMain.handle(
    SUBSCRIBE_CHANNEL,
    async (
      event,
      args: GitRepositorySnapshotRequest & { subscriptionId?: string }
    ): Promise<{ subscriptionId: string }> => {
      if (args.pushTarget) {
        assertGitPushTargetShape(args.pushTarget)
      }
      const id =
        typeof args.subscriptionId === 'string' && args.subscriptionId.length > 0
          ? args.subscriptionId
          : randomUUID()
      if (subscriptions.has(id)) {
        throw new Error('Git repository snapshot subscription id already exists')
      }
      const sender = event.sender
      let destroyedListenerAttached = false
      const subscription: RetainedSubscription = {
        id,
        args,
        sender,
        senderId: sender.id,
        incarnation: 0,
        bindingToken: 0,
        unsubscribeOwner: () => {},
        removeDestroyedListener: () => {
          if (!destroyedListenerAttached) {
            return
          }
          destroyedListenerAttached = false
          sender.removeListener('destroyed', closeOnDestroyed)
        }
      }
      const closeOnDestroyed = (): void => closeSubscription(subscription)
      sender.once('destroyed', closeOnDestroyed)
      destroyedListenerAttached = true
      subscriptions.set(id, subscription)
      try {
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
          }
          bindSshProvider(subscription, provider, getSshGitProviderGeneration(args.connectionId))
        } else {
          const request = await resolveLocalGitRepositorySnapshotRequest(store, args)
          if (subscriptions.get(subscription.id) !== subscription || sender.isDestroyed()) {
            closeSubscription(subscription)
            return { subscriptionId: id }
          }
          const token = subscription.bindingToken
          subscription.unsubscribeOwner = subscribeGitRepositorySnapshot(
            request.worktreePath,
            request.options,
            args.pushTarget,
            (revisionEvent) => sendEvent(subscription, revisionEvent, token)
          )
        }
      } catch (error) {
        closeSubscription(subscription)
        throw error
      }
      if (sender.isDestroyed()) {
        closeSubscription(subscription)
      }
      return { subscriptionId: id }
    }
  )

  ipcMain.handle(
    UNSUBSCRIBE_CHANNEL,
    (event, args: { subscriptionId: string }): { unsubscribed: boolean } => {
      const subscription = subscriptions.get(args.subscriptionId)
      if (!subscription || subscription.senderId !== event.sender.id) {
        return { unsubscribed: false }
      }
      closeSubscription(subscription)
      return { unsubscribed: true }
    }
  )
}

export function getGitRepositorySnapshotSubscriptionCountForTests(): number {
  return subscriptions.size
}
