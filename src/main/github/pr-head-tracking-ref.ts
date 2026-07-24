import { gitExecFileAsync } from '../git/runner'
import { githubPullRequestHeadLocalRef } from '../../shared/review-head-tracking-ref'
import type { SshGitProvider } from '../providers/ssh-git-provider'

// Re-exported so existing github/* callers keep a single import site.
export { githubPullRequestHeadLocalRef }

type LocalGitExecOptions = {
  cwd: string
  wslDistro?: string
}

// Why: the relay's read-only git.exec channel rejects `fetch`, so SSH repos
// must use the dedicated git.fetchRemoteTrackingRef RPC.
export async function fetchPrHeadTrackingRef(
  repo: { path: string; connectionId?: string | null },
  sshGitProvider: SshGitProvider | null | undefined,
  remote: string,
  branch: string,
  options: { localGitExecOptions?: LocalGitExecOptions } = {}
): Promise<void> {
  const ref = `refs/remotes/${remote}/${branch}`
  if (!repo.connectionId) {
    await gitExecFileAsync(
      ['fetch', remote, `+refs/heads/${branch}:${ref}`],
      options.localGitExecOptions ?? { cwd: repo.path }
    )
    return
  }
  if (!sshGitProvider) {
    throw new Error('SSH Git provider is not available. Reconnect to this target and try again.')
  }
  await sshGitProvider.fetchRemoteTrackingRef(repo.path, remote, branch, ref)
}

export async function fetchGitHubPullRequestHeadRef(
  repo: { path: string; connectionId?: string | null },
  sshGitProvider: SshGitProvider | null | undefined,
  remote: string,
  prNumber: number,
  options: { localGitExecOptions?: LocalGitExecOptions } = {}
): Promise<void> {
  if (!repo.connectionId) {
    await gitExecFileAsync(
      [
        'fetch',
        '--no-tags',
        remote,
        `+refs/pull/${prNumber}/head:${githubPullRequestHeadLocalRef(prNumber)}`
      ],
      options.localGitExecOptions ?? { cwd: repo.path }
    )
    return
  }
  if (!sshGitProvider) {
    throw new Error('SSH Git provider is not available. Reconnect to this target and try again.')
  }
  await sshGitProvider.fetchGitHubPullRequestHead(repo.path, remote, prNumber)
}
