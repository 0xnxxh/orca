import type { GitHubOwnerRepo } from '../../shared/types'
import { isDefaultGitHubHost } from '../../shared/github-repository-identity-key'
import { getOwnerRepoForRemote, type LocalGitExecOptions } from './gh-utils'
import { getEnterpriseGitHubRepoSlug } from './github-enterprise-repository'

export type GitHubApiRepository = GitHubOwnerRepo

// Why: the enterprise branch spawns an uncached `git remote get-url` (an SSH
// round trip on connection-backed repos) — hot paths like per-file contents
// and viewed-state toggles resolve per call, so cache like ownerRepoCache does.
const ORIGIN_REPO_CACHE_TTL_MS = 30_000
const originRepoCache = new Map<string, { value: GitHubApiRepository | null; expiresAt: number }>()
const originRepoInFlight = new Map<string, Promise<GitHubApiRepository | null>>()

function originRepoCacheKey(
  repoPath: string,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): string {
  return `${connectionId ?? 'local'}\0${localGitOptions.wslDistro ?? ''}\0${repoPath}`
}

/** @internal - exposed for tests only */
export function _resetOriginGitHubApiRepositoryCache(): void {
  originRepoCache.clear()
  originRepoInFlight.clear()
}

export async function getOriginGitHubApiRepository(
  repoPath: string,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitHubApiRepository | null> {
  // Why: this resolver represents the checkout origin; generic PR resolution
  // prefers upstream on fork checkouts (#7331).
  const ownerRepo = await getOwnerRepoForRemote(
    repoPath,
    'origin',
    connectionId,
    localGitOptions
  )
  if (ownerRepo) {
    return { ...ownerRepo, host: 'github.com' }
  }
  const cacheKey = originRepoCacheKey(repoPath, connectionId, localGitOptions)
  const cached = originRepoCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }
  const inFlight = originRepoInFlight.get(cacheKey)
  if (inFlight) {
    return inFlight
  }
  const probe = (async () => {
    const enterpriseOptions =
      Object.keys(localGitOptions).length > 0 ? { localGitExecOptions: localGitOptions } : {}
    const slug = await getEnterpriseGitHubRepoSlug(repoPath, connectionId, enterpriseOptions)
    originRepoCache.set(cacheKey, { value: slug, expiresAt: Date.now() + ORIGIN_REPO_CACHE_TTL_MS })
    return slug
  })()
  originRepoInFlight.set(cacheKey, probe)
  try {
    return await probe
  } finally {
    if (originRepoInFlight.get(cacheKey) === probe) {
      originRepoInFlight.delete(cacheKey)
    }
  }
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

export function isGitHubDotComRepository(repository: GitHubApiRepository): boolean {
  return isDefaultGitHubHost(repository.host)
}

// Why: the gh runner host-qualifies argv from `options.host`, so every known
// host must be carried through. Pinning github.com prevents a process-level
// GH_HOST from silently redirecting an otherwise unambiguous API request.
export function githubHostExecOptions(repository: GitHubApiRepository | null | undefined): {
  host?: string
} {
  return repository?.host ? { host: repository.host } : {}
}

export function githubRepositoryWebHost(repository: GitHubApiRepository): string {
  return repository.host ?? 'github.com'
}
