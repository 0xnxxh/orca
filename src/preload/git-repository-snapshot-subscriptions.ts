import type {
  GitRepositorySnapshotRequest,
  GitRepositorySnapshotSubscriptionEvent
} from '../shared/git-repository-snapshot'

export type GitRepositorySnapshotSubscriptionHandle = {
  unsubscribe: () => void
}

type SubscriptionPayload = {
  subscriptionId: string
  event: GitRepositorySnapshotSubscriptionEvent
}

type GitRepositorySnapshotSubscriptionIpc = {
  invoke: (channel: string, args: unknown) => Promise<unknown>
  on: (channel: string, listener: (event: unknown, payload: SubscriptionPayload) => void) => void
  removeListener: (
    channel: string,
    listener: (event: unknown, payload: SubscriptionPayload) => void
  ) => void
}

const REVISION_CHANNEL = 'git:repositorySnapshotRevision'

function createSubscriptionId(): string {
  return globalThis.crypto.randomUUID()
}

export async function subscribeGitRepositorySnapshotFromPreload(
  ipc: GitRepositorySnapshotSubscriptionIpc,
  args: GitRepositorySnapshotRequest,
  callback: (event: GitRepositorySnapshotSubscriptionEvent) => void,
  createId = createSubscriptionId
): Promise<GitRepositorySnapshotSubscriptionHandle> {
  const subscriptionId = createId()
  let closed = false
  const listener = (_event: unknown, payload: SubscriptionPayload): void => {
    if (payload.subscriptionId === subscriptionId) {
      callback(payload.event)
    }
  }
  const release = (): boolean => {
    if (closed) {
      return false
    }
    closed = true
    ipc.removeListener(REVISION_CHANNEL, listener)
    return true
  }
  ipc.on(REVISION_CHANNEL, listener)
  try {
    await ipc.invoke('git:subscribeRepositorySnapshot', {
      ...args,
      subscriptionId
    })
  } catch (error) {
    release()
    throw error
  }
  return {
    unsubscribe: () => {
      if (!release()) {
        return
      }
      void ipc.invoke('git:unsubscribeRepositorySnapshot', { subscriptionId })
    }
  }
}
