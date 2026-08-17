import type { LocalGitExecOptions } from './github-repository-identity'

export function githubApiRepositoryProbeCacheKey(
  repoPath: string,
  remoteName: string,
  connectionId: string | null | undefined,
  localGitOptions: LocalGitExecOptions,
  requireVerifiedSshProbe: boolean
): string {
  return `${connectionId ?? 'local'}\0${localGitOptions.wslDistro ?? ''}\0${repoPath}\0${remoteName}\0${requireVerifiedSshProbe ? 'verified' : 'tolerant'}`
}

export function resolveGitHubApiRepositoryProbe<T>(
  value: T | undefined,
  requireVerifiedSshProbe: boolean
): T | null {
  if (value === undefined && requireVerifiedSshProbe) {
    throw new Error('GitHub repository identity is unverifiable.')
  }
  return value ?? null
}
