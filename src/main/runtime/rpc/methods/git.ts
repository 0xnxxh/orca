import { defineMethod, type RpcMethod } from '../core'
import { GIT_DIFF_COMPARE_METHODS } from './git-diff-compare-methods'
import { GIT_SOURCE_CONTROL_AI_METHODS } from './git-source-control-ai-methods'
import { GIT_STAGE_DISCARD_METHODS } from './git-stage-discard-methods'
import {
  GitCheckIgnored,
  GitCheckout,
  GitCommit,
  GitForkSync,
  GitHistory,
  GitPush,
  GitRebaseFromBase,
  GitRemoteCommitUrl,
  GitRemoteFileUrl,
  GitStatusParams,
  GitSubmoduleStatus,
  GitTargetedRemote,
  WorktreeSelector
} from './git-params'

export const GIT_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'git.status',
    params: GitStatusParams,
    handler: async (params, { runtime, signal }) => {
      const options =
        params.includeIgnored === undefined &&
        params.bypassEffectiveUpstreamNegativeCache === undefined &&
        params.reuseLineStats === undefined &&
        params.branchLineTotalMergeBase === undefined &&
        signal === undefined
          ? undefined
          : {
              ...(params.includeIgnored === undefined
                ? {}
                : { includeIgnored: params.includeIgnored }),
              ...(params.bypassEffectiveUpstreamNegativeCache === true
                ? { bypassEffectiveUpstreamNegativeCache: true }
                : {}),
              ...(params.reuseLineStats === true ? { reuseLineStats: true } : {}),
              ...(params.branchLineTotalMergeBase === undefined
                ? {}
                : { branchLineTotalMergeBase: params.branchLineTotalMergeBase }),
              ...(signal ? { signal } : {})
            }
      return options === undefined
        ? runtime.getRuntimeGitStatus(params.worktree)
        : runtime.getRuntimeGitStatus(params.worktree, options)
    }
  }),
  defineMethod({
    name: 'git.checkIgnored',
    params: GitCheckIgnored,
    handler: async (params, { runtime }) =>
      runtime.checkRuntimeGitIgnoredPaths(params.worktree, params.paths)
  }),
  defineMethod({
    name: 'git.submoduleStatus',
    params: GitSubmoduleStatus,
    handler: async (params, { runtime }) =>
      runtime.getRuntimeGitSubmoduleStatus(params.worktree, params.submodulePath, params.area)
  }),
  defineMethod({
    name: 'git.history',
    params: GitHistory,
    handler: async (params, { runtime }) =>
      runtime.getRuntimeGitHistory(params.worktree, {
        limit: params.limit,
        baseRef: params.baseRef
      })
  }),
  defineMethod({
    name: 'git.conflictOperation',
    params: WorktreeSelector,
    handler: async (params, { runtime }) => runtime.getRuntimeGitConflictOperation(params.worktree)
  }),
  defineMethod({
    name: 'git.abortMerge',
    params: WorktreeSelector,
    handler: async (params, { runtime }) => runtime.abortRuntimeGitMerge(params.worktree)
  }),
  defineMethod({
    name: 'git.abortRebase',
    params: WorktreeSelector,
    handler: async (params, { runtime }) => runtime.abortRuntimeGitRebase(params.worktree)
  }),
  defineMethod({
    name: 'git.checkout',
    params: GitCheckout,
    handler: async (params, { runtime }) =>
      runtime.checkoutRuntimeGitBranch(params.worktree, params.branch)
  }),
  defineMethod({
    name: 'git.localBranches',
    params: WorktreeSelector,
    handler: async (params, { runtime }) => runtime.listRuntimeGitLocalBranches(params.worktree)
  }),
  ...GIT_DIFF_COMPARE_METHODS,
  defineMethod({
    name: 'git.upstreamStatus',
    params: GitTargetedRemote,
    handler: async (params, { runtime }) =>
      params.pushTarget === undefined
        ? runtime.getRuntimeGitUpstreamStatus(params.worktree)
        : runtime.getRuntimeGitUpstreamStatus(params.worktree, params.pushTarget)
  }),
  defineMethod({
    name: 'git.fetch',
    params: GitTargetedRemote,
    handler: async (params, { runtime }) =>
      params.pushTarget === undefined
        ? runtime.fetchRuntimeGit(params.worktree)
        : runtime.fetchRuntimeGit(params.worktree, params.pushTarget)
  }),
  defineMethod({
    name: 'git.forkSync',
    params: GitForkSync,
    handler: async (params, { runtime }) =>
      runtime.syncRuntimeGitForkDefaultBranch(params.worktree, params.expectedUpstream)
  }),
  defineMethod({
    name: 'git.pull',
    params: GitTargetedRemote,
    handler: async (params, { runtime }) =>
      params.pushTarget === undefined
        ? runtime.pullRuntimeGit(params.worktree)
        : runtime.pullRuntimeGit(params.worktree, params.pushTarget)
  }),
  defineMethod({
    name: 'git.fastForward',
    params: GitTargetedRemote,
    handler: async (params, { runtime }) =>
      params.pushTarget === undefined
        ? runtime.fastForwardRuntimeGit(params.worktree)
        : runtime.fastForwardRuntimeGit(params.worktree, params.pushTarget)
  }),
  defineMethod({
    name: 'git.rebaseFromBase',
    params: GitRebaseFromBase,
    handler: async (params, { runtime }) =>
      runtime.rebaseRuntimeGitFromBase(params.worktree, params.baseRef)
  }),
  defineMethod({
    name: 'git.push',
    params: GitPush,
    handler: async (params, { runtime }) =>
      runtime.pushRuntimeGit(
        params.worktree,
        params.publish,
        params.pushTarget,
        params.forceWithLease
      )
  }),
  defineMethod({
    name: 'git.commit',
    params: GitCommit,
    handler: async (params, { runtime }) =>
      runtime.commitRuntimeGit(params.worktree, params.message)
  }),
  ...GIT_SOURCE_CONTROL_AI_METHODS,
  ...GIT_STAGE_DISCARD_METHODS,
  defineMethod({
    name: 'git.remoteFileUrl',
    params: GitRemoteFileUrl,
    handler: async (params, { runtime }) =>
      runtime.getRuntimeGitRemoteFileUrl(params.worktree, params.relativePath, params.line)
  }),
  defineMethod({
    name: 'git.remoteCommitUrl',
    params: GitRemoteCommitUrl,
    handler: async (params, { runtime }) =>
      runtime.getRuntimeGitRemoteCommitUrl(params.worktree, params.sha)
  })
]
