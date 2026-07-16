import type { GitHubOwnerRepo } from '../../shared/types'
import { getOwnerRepo, type LocalGitExecOptions } from './gh-utils'
import { getEnterpriseGitHubRepoSlug } from './github-enterprise-repository'

export type GitHubApiRepository = GitHubOwnerRepo

export async function getOriginGitHubApiRepository(
  repoPath: string,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitHubApiRepository | null> {
  const ownerRepo = await getOwnerRepo(repoPath, connectionId, localGitOptions)
  if (ownerRepo) {
    return { ...ownerRepo, host: 'github.com' }
  }
  const enterpriseOptions =
    Object.keys(localGitOptions).length > 0 ? { localGitExecOptions: localGitOptions } : {}
  return getEnterpriseGitHubRepoSlug(repoPath, connectionId, enterpriseOptions)
}

export async function resolveGitHubApiRepository(
  repoPath: string,
  repository?: GitHubApiRepository | null,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitHubApiRepository | null> {
  if (repository?.host) {
    return repository
  }
  const originRepository = await getOriginGitHubApiRepository(
    repoPath,
    connectionId,
    localGitOptions
  )
  if (!repository) {
    return originRepository
  }
  // Why: older clients only send owner/repo. The origin still supplies the
  // execution host for fork-base slugs on the same GitHub Enterprise server.
  if (originRepository?.host) {
    return { ...repository, host: originRepository.host }
  }
  // Why: connection-backed gh has no cwd to infer a host from. An unhosted
  // legacy identity is unsafe there because gh would target its default account.
  return connectionId ? null : repository
}

export function githubApiHostArgs(repository: GitHubApiRepository): string[] {
  const host = repository.host
  return host && host.toLowerCase() !== 'github.com' ? ['--hostname', host] : []
}

export function isGitHubDotComRepository(repository: GitHubApiRepository): boolean {
  return !repository.host || repository.host.toLowerCase() === 'github.com'
}

// Why: owner/repo shorthand targets gh's default host, and SSH-backed repos
// have no local cwd from which gh can infer an Enterprise hostname.
export function githubCliRepositoryArgument(repository: GitHubApiRepository): string {
  return !isGitHubDotComRepository(repository)
    ? `${repository.host}/${repository.owner}/${repository.repo}`
    : `${repository.owner}/${repository.repo}`
}

export function githubRepositoryWebHost(repository: GitHubApiRepository): string {
  return repository.host ?? 'github.com'
}
