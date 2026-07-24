import type { GitHubPrStartPoint, GitPushTarget } from '../../shared/types'
import { fetchCompareBaseRefWithLocalFallback } from '../git/compare-base-ref-fetch'
import { isMissingRemoteRefGitError } from '../git/fetch-error-classification'
import { getPullRequestPushTarget, getWorkItem } from './client'
import { githubPullRequestHeadLocalRef } from '../../shared/review-head-tracking-ref'

type GitExec = (args: string[]) => Promise<{ stdout: string; stderr: string }>

type ResolveGitHubPrStartPointArgs = {
  repoPath: string
  prNumber: number
  headRefName?: string
  baseRefName?: string
  isCrossRepository?: boolean
  connectionId?: string | null
  localGitOptions?: { wslDistro?: string }
  gitExec: GitExec
  fetchRemoteTrackingRef: (remote: string, branch: string) => Promise<void>
  fetchPullRequestHeadRef: (remote: string, prNumber: number) => Promise<void>
  resolveRemote: () => Promise<string>
}

type ResolveGitHubPrStartPointResult = GitHubPrStartPoint | { error: string }

function localGitOptionArgs(
  options: { wslDistro?: string } | undefined
): [] | [{ wslDistro?: string }] {
  return options && Object.keys(options).length > 0 ? [options] : []
}

export async function resolveGitHubPrStartPoint(
  args: ResolveGitHubPrStartPointArgs
): Promise<ResolveGitHubPrStartPointResult> {
  let headRefName = args.headRefName?.trim() ?? ''
  let baseRefName = args.baseRefName?.trim() ?? ''
  let isCrossRepository = args.isCrossRepository === true
  let pushTarget: GitPushTarget | undefined
  let maintainerCanModify: boolean | undefined

  const resolvePushTarget = async (): Promise<void> => {
    if (pushTarget) {
      return
    }
    try {
      const resolved = await getPullRequestPushTarget(
        args.repoPath,
        args.prNumber,
        args.connectionId ?? null,
        ...localGitOptionArgs(args.localGitOptions)
      )
      pushTarget = resolved?.pushTarget
      maintainerCanModify = resolved?.maintainerCanModify
    } catch {
      // Why: deleted/inaccessible fork metadata can prevent push-target
      // discovery, but GitHub still exposes the PR head ref for checkout.
      pushTarget = undefined
    }
  }

  if (!headRefName) {
    const item = await getWorkItem(
      args.repoPath,
      args.prNumber,
      'pr',
      args.connectionId ?? null,
      ...localGitOptionArgs(args.localGitOptions)
    )
    if (!item || item.type !== 'pr') {
      return { error: `PR #${args.prNumber} not found.` }
    }
    headRefName = (item.branchName ?? '').trim()
    baseRefName = (item.baseRefName ?? '').trim()
    if (!headRefName) {
      return { error: `PR #${args.prNumber} has no head branch.` }
    }
    if (item.isCrossRepository === true) {
      isCrossRepository = true
    }
  }

  if (isCrossRepository) {
    await resolvePushTarget()
  }

  let remote: string
  try {
    remote = await args.resolveRemote()
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not resolve git remote.' }
  }

  const compareBaseRef = baseRefName ? `refs/remotes/${remote}/${baseRefName}` : undefined

  const fetchCompareBaseRef = (): Promise<boolean> =>
    fetchCompareBaseRefWithLocalFallback({
      compareBaseRef,
      fetchCompareBaseRef: () => args.fetchRemoteTrackingRef(remote, baseRefName),
      gitExec: args.gitExec,
      logLabel: '[github:resolvePrStartPoint]',
      logContext: { remote, baseRefName, prNumber: args.prNumber }
    })

  const fetchPullRequestHeadSha = async (): Promise<{ baseBranch: string } | { error: string }> => {
    const pullRef = `refs/pull/${args.prNumber}/head`
    // Why: the durable per-PR ref avoids shared FETCH_HEAD races and keeps the commit reachable through create.
    const localRef = githubPullRequestHeadLocalRef(args.prNumber)
    const resolveDurableHeadSha = async (): Promise<string | null> => {
      try {
        const { stdout } = await args.gitExec(['rev-parse', '--verify', `${localRef}^{commit}`])
        return stdout.trim() || null
      } catch {
        return null
      }
    }
    try {
      await args.fetchPullRequestHeadRef(remote, args.prNumber)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Why: mirror compare-base — a transient fetch failure must not fail the
      // resolve when a prior fetch already pinned the durable head ref.
      const localSha = await resolveDurableHeadSha()
      if (localSha) {
        console.warn('[github:resolvePrStartPoint] PR head fetch failed; using durable local ref', {
          remote,
          prNumber: args.prNumber,
          error: message.split('\n')[0]
        })
        return { baseBranch: localSha }
      }
      return {
        error: `Failed to fetch ${pullRef}: ${message.split('\n')[0]}`
      }
    }
    const sha = await resolveDurableHeadSha()
    if (!sha) {
      return { error: `Could not resolve fork PR #${args.prNumber} head after fetch.` }
    }
    return { baseBranch: sha }
  }

  // Why: fork PR heads live on a remote we don't have configured, so
  // `git fetch <remote> <headRefName>` would fail. GitHub exposes every
  // PR head (fork or same-repo) as refs/pull/<N>/head on the upstream repo.
  if (isCrossRepository) {
    const result = await fetchPullRequestHeadSha()
    if ('error' in result) {
      return result
    }
    const compareBaseFetched = await fetchCompareBaseRef()
    // Why: adopt the contributor's branch name locally (mirroring the same-repo
    // return below) so fork-PR worktrees aren't renamed with the maintainer's
    // branch prefix (e.g. `me/866`). The push refspec still targets the fork.
    return {
      ...result,
      ...(compareBaseFetched && compareBaseRef ? { compareBaseRef } : {}),
      headSha: result.baseBranch,
      branchNameOverride: headRefName,
      ...(pushTarget ? { pushTarget } : {}),
      ...(maintainerCanModify !== undefined ? { maintainerCanModify } : {})
    }
  }

  try {
    await args.fetchRemoteTrackingRef(remote, headRefName)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Why: missing fork metadata can make a fork PR look like a same-repo
    // branch. Only that missing-ref case should fall back to refs/pull.
    if (isMissingRemoteRefGitError(error)) {
      const result = await fetchPullRequestHeadSha()
      if (!('error' in result)) {
        await resolvePushTarget()
        const compareBaseFetched = await fetchCompareBaseRef()
        return {
          ...result,
          ...(compareBaseFetched && compareBaseRef ? { compareBaseRef } : {}),
          headSha: result.baseBranch,
          branchNameOverride: headRefName,
          ...(pushTarget ? { pushTarget } : {}),
          ...(maintainerCanModify !== undefined ? { maintainerCanModify } : {})
        }
      }
      // Why: the branch fetch missed and the pull-head fallback is what actually
      // failed, so surface its (more actionable) error rather than the branch miss.
      return result
    }
    return {
      error: `Failed to fetch ${remote}/${headRefName}: ${message.split('\n')[0]}`
    }
  }

  const remoteRef = `${remote}/${headRefName}`
  let headSha: string
  try {
    const { stdout } = await args.gitExec(['rev-parse', '--verify', remoteRef])
    headSha = stdout.trim()
  } catch {
    return { error: `Remote ref ${remoteRef} does not exist after fetch.` }
  }
  if (!headSha) {
    return { error: `Empty SHA resolving PR #${args.prNumber} head.` }
  }
  const compareBaseFetched = await fetchCompareBaseRef()

  return {
    baseBranch: headSha,
    ...(compareBaseFetched && compareBaseRef ? { compareBaseRef } : {}),
    headSha,
    branchNameOverride: headRefName,
    pushTarget: { remoteName: remote, branchName: headRefName }
  }
}
