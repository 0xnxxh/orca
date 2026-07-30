import type {
  GitRepositorySnapshotSubscriptionEvent,
  GitRepositorySnapshotRevisionEvent
} from '../../../shared/git-repository-snapshot'
import type { RuntimeGitRepositorySnapshotRevisionMessage } from '../../../shared/runtime-git-repository-snapshot-revision'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { isRuntimeSubscriptionReplayResponse } from '../../../shared/runtime-subscription-replay'
import type { GitPushTarget } from '../../../shared/types'
import type { DesktopGitRepositorySnapshotContext } from './desktop-git-repository-snapshot-client'
import { getRuntimeEnvironmentRevision } from './runtime-environment-revision'
import { getActiveRuntimeTarget } from './runtime-rpc-client'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'

export type RuntimeGitRepositorySnapshotRevisionCallbacks = {
  onSubscribed: (incarnation: number) => void
  onRevision: (event: GitRepositorySnapshotSubscriptionEvent) => void
  onUnavailable: (error: unknown) => void
  onReplay: () => void
  onEnd: () => void
}

export function getRuntimeGitRepositorySnapshotRevisionTargetKey(
  context: DesktopGitRepositorySnapshotContext
): string | null {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind !== 'environment' || !context.worktreeId) {
    return null
  }
  return `${target.environmentId}\0${getRuntimeEnvironmentRevision(target.environmentId)}\0${toRuntimeWorktreeSelector(context.worktreeId)}`
}

export async function subscribeRuntimeGitRepositorySnapshotRevision(
  context: DesktopGitRepositorySnapshotContext,
  options: {
    includeIgnored?: boolean
    bypassEffectiveUpstreamNegativeCache?: boolean
    reuseLineStats?: boolean
    pushTarget?: GitPushTarget
  },
  callbacks: RuntimeGitRepositorySnapshotRevisionCallbacks
): Promise<{ unsubscribe: () => void } | null> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind !== 'environment' || !context.worktreeId) {
    return null
  }
  const handle = await window.api.runtimeEnvironments.subscribe(
    {
      selector: target.environmentId,
      method: 'git.repositorySnapshotRevisions.subscribe',
      params: {
        worktree: toRuntimeWorktreeSelector(context.worktreeId),
        ...(options.includeIgnored === true ? { includeIgnored: true } : {}),
        ...(options.bypassEffectiveUpstreamNegativeCache === true
          ? { bypassEffectiveUpstreamNegativeCache: true }
          : {}),
        ...(options.reuseLineStats === true ? { reuseLineStats: true } : {}),
        ...(options.pushTarget ? { pushTarget: options.pushTarget } : {})
      },
      timeoutMs: 15_000,
      expectedEnvironmentPairingRevision: getRuntimeEnvironmentRevision(target.environmentId)
    },
    {
      onResponse: (response) => handleResponse(response, callbacks),
      onError: callbacks.onUnavailable,
      onClose: callbacks.onEnd
    }
  )
  return { unsubscribe: handle.unsubscribe }
}

function handleResponse(
  response: RuntimeRpcResponse<unknown>,
  callbacks: RuntimeGitRepositorySnapshotRevisionCallbacks
): void {
  if (isRuntimeSubscriptionReplayResponse(response)) {
    callbacks.onReplay()
  }
  if (response.ok === false) {
    callbacks.onUnavailable(response.error)
    return
  }
  const message = readMessage(response.result)
  if (!message) {
    callbacks.onUnavailable(new Error('Invalid repository snapshot revision stream message'))
    return
  }
  if (message.type === 'subscribed') {
    callbacks.onSubscribed(message.incarnation)
    return
  }
  if (message.type === 'revision') {
    callbacks.onRevision(message.event)
    return
  }
  callbacks.onEnd()
}

function readMessage(value: unknown): RuntimeGitRepositorySnapshotRevisionMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null
  }
  if (
    value.type === 'subscribed' &&
    typeof value.subscriptionId === 'string' &&
    value.subscriptionId.length > 0 &&
    isNonNegativeSafeInteger(value.incarnation)
  ) {
    return {
      type: 'subscribed',
      subscriptionId: value.subscriptionId,
      incarnation: value.incarnation
    }
  }
  if (value.type === 'revision') {
    const event = readRevisionEvent(value.event)
    return event ? { type: 'revision', event } : null
  }
  return value.type === 'end' ? { type: 'end' } : null
}

function readRevisionEvent(value: unknown): GitRepositorySnapshotSubscriptionEvent | null {
  if (
    !isRecord(value) ||
    (value.state !== 'invalidated' && value.state !== 'ready') ||
    !isNonNegativeSafeInteger(value.generation) ||
    !isNonNegativeSafeInteger(value.revision) ||
    !isNonNegativeSafeInteger(value.incarnation)
  ) {
    return null
  }
  const event: GitRepositorySnapshotRevisionEvent = {
    state: value.state,
    generation: value.generation,
    revision: value.revision
  }
  return { ...event, incarnation: value.incarnation }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
