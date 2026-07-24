import {
  gitlabMergeRequestHeadLocalRef,
  isSafeReviewHeadFetchRemote,
  isValidReviewHeadNumber,
  REVIEW_HEAD_FETCH_TIMEOUT_MS
} from '../../shared/review-head-tracking-ref'
import { gitExecFileAsync } from '../git/runner'
import type { SshGitProvider } from '../providers/ssh-git-provider'

type LocalGitExecOptions = {
  cwd: string
  wslDistro?: string
}

// Why: the relay's read-only git.exec channel rejects `fetch`, so SSH repos
// must use the dedicated git.fetchGitLabMergeRequestHeadRef RPC. Mirrors
// fetchGitHubPullRequestHeadRef so both providers pin the durable head ref
// the same way.
export async function fetchGitLabMergeRequestHeadRef(
  repo: { path: string; connectionId?: string | null },
  sshGitProvider: SshGitProvider | null | undefined,
  remote: string,
  mrIid: number,
  options: { localGitExecOptions?: LocalGitExecOptions } = {}
): Promise<void> {
  if (!isValidReviewHeadNumber(mrIid)) {
    throw new Error(`Invalid merge request iid: ${mrIid}`)
  }
  if (!isSafeReviewHeadFetchRemote(remote)) {
    throw new Error('Merge request fetch remote must not start with "-".')
  }
  if (!repo.connectionId) {
    await gitExecFileAsync(
      [
        'fetch',
        '--no-tags',
        remote,
        `+refs/merge-requests/${mrIid}/head:${gitlabMergeRequestHeadLocalRef(mrIid)}`
      ],
      {
        ...(options.localGitExecOptions ?? { cwd: repo.path }),
        timeout: REVIEW_HEAD_FETCH_TIMEOUT_MS
      }
    )
    return
  }
  if (!sshGitProvider) {
    throw new Error('SSH Git provider is not available. Reconnect to this target and try again.')
  }
  await sshGitProvider.fetchGitLabMergeRequestHead(repo.path, remote, mrIid)
}
