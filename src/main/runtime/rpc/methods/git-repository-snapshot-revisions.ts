import { defineStreamingMethod, type RpcAnyMethod } from '../core'
import { GitRepositorySnapshotParams } from './git-params'
import { runGitRepositorySnapshotRevisionStream } from './git-repository-snapshot-revision-stream'

let subscriptionSequence = 0

export const GIT_REPOSITORY_SNAPSHOT_REVISION_METHODS: readonly RpcAnyMethod[] = [
  defineStreamingMethod({
    name: 'git.repositorySnapshotRevisions.subscribe',
    params: GitRepositorySnapshotParams,
    handler: async (params, { runtime, connectionId, signal }, emit) => {
      const options =
        params.includeIgnored === undefined &&
        params.bypassEffectiveUpstreamNegativeCache === undefined &&
        params.reuseLineStats === undefined
          ? undefined
          : {
              ...(params.includeIgnored === true ? { includeIgnored: true } : {}),
              ...(params.bypassEffectiveUpstreamNegativeCache === true
                ? { bypassEffectiveUpstreamNegativeCache: true }
                : {}),
              ...(params.reuseLineStats === true ? { reuseLineStats: true } : {})
            }
      subscriptionSequence += 1
      await runGitRepositorySnapshotRevisionStream({
        runtime,
        worktree: params.worktree,
        options,
        pushTarget: params.pushTarget,
        connectionId,
        signal,
        subscriptionId: `git-repository-snapshot-${connectionId ?? 'inproc'}-${subscriptionSequence}`,
        emit
      })
    }
  })
]
