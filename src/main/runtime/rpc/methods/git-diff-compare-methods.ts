import { defineMethod, type RpcMethod } from '../core'
import { remoteRpcContentBudget } from '../../../../shared/remote-rpc-content-budget'
import {
  GitBranchCompare,
  GitBranchDiff,
  GitCommitCompare,
  GitCommitDiff,
  GitDiff
} from './git-params'

// Why: clientKind is set only for WebSocket-transported requests, so desktop-local and in-process
// callers keep uncapped full-fidelity diffs.
function remoteDiffContentBudget(
  clientKind: 'mobile' | 'runtime' | undefined,
  requestId: string | undefined
): number | undefined {
  return clientKind && requestId ? remoteRpcContentBudget(requestId) : undefined
}

export const GIT_DIFF_COMPARE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'git.diff',
    params: GitDiff,
    handler: async (params, { runtime, clientKind, requestId }) =>
      runtime.getRuntimeGitDiff(
        params.worktree,
        params.filePath,
        params.staged,
        params.compareAgainstHead,
        remoteDiffContentBudget(clientKind, requestId)
      )
  }),
  defineMethod({
    name: 'git.branchCompare',
    params: GitBranchCompare,
    handler: async (params, { runtime }) =>
      runtime.getRuntimeGitBranchCompare(params.worktree, params.baseRef)
  }),
  defineMethod({
    name: 'git.commitCompare',
    params: GitCommitCompare,
    handler: async (params, { runtime }) =>
      runtime.getRuntimeGitCommitCompare(params.worktree, params.commitId)
  }),
  defineMethod({
    name: 'git.branchDiff',
    params: GitBranchDiff,
    handler: async (params, { runtime, clientKind, requestId }) =>
      runtime.getRuntimeGitBranchDiff(
        params.worktree,
        params.compare,
        params.filePath,
        params.oldPath,
        remoteDiffContentBudget(clientKind, requestId)
      )
  }),
  defineMethod({
    name: 'git.commitDiff',
    params: GitCommitDiff,
    handler: async (params, { runtime, clientKind, requestId }) =>
      runtime.getRuntimeGitCommitDiff(
        params.worktree,
        {
          commitOid: params.commitOid,
          parentOid: params.parentOid,
          filePath: params.filePath,
          oldPath: params.oldPath
        },
        remoteDiffContentBudget(clientKind, requestId)
      )
  })
]
