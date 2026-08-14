// Why: a remote URL can name a forge through an alias host (SSH-over-443, `www.`), and every
// comparison of a probed remote against a pasted URL must fold those to the same identity.

function normalizeRemoteHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
}

export function normalizeGitHubRemoteHost(host: string): string {
  const normalizedHost = normalizeRemoteHost(host)
  // Why: GitHub documents ssh.github.com as SSH-over-HTTPS for github.com repos.
  return normalizedHost === 'ssh.github.com' ? 'github.com' : normalizedHost
}

export function normalizeGitLabRemoteHost(host: string): string {
  const normalizedHost = normalizeRemoteHost(host)
  // Why: GitLab documents altssh.gitlab.com as SSH-over-443 for gitlab.com projects.
  return normalizedHost === 'altssh.gitlab.com' ? 'gitlab.com' : normalizedHost
}

/**
 * A host with no dot is an OpenSSH `Host` alias (`git@github-work:owner/repo`) that only
 * ~/.ssh/config can expand; `git remote -v` never resolves it, so it is unknown, not wrong.
 */
export function isUnresolvedSshHostAlias(host: string): boolean {
  return !normalizeRemoteHost(host).includes('.')
}
