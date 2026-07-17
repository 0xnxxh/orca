import type { GitHubOwnerRepo, IssueSourcePreference } from '../../shared/types'
import {
  githubRepoIdentityKey,
  isDefaultGitHubHost
} from '../../shared/github-repository-identity-key'
import { getOwnerRepoForRemote, type LocalGitExecOptions } from './gh-utils'
import {
  getEnterpriseGitHubRepoSlug,
  getEnterpriseGitHubRepoSlugForRemote
} from './github-enterprise-repository'

export type GitHubApiRepository = GitHubOwnerRepo

// Why: the enterprise branch spawns an uncached `git remote get-url` (an SSH
// round trip on connection-backed repos) — hot paths like per-file contents
// and viewed-state toggles resolve per call, so cache like ownerRepoCache does.
const ORIGIN_REPO_CACHE_TTL_MS = 30_000
const ORIGIN_REPO_CACHE_MAX_ENTRIES = 512
const originRepoCache = new Map<string, { value: GitHubApiRepository | null; expiresAt: number }>()
const originRepoInFlight = new Map<string, Promise<GitHubApiRepository | null>>()

function originRepoCacheKey(
  repoPath: string,
  remoteName: string,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): string {
  return `${connectionId ?? 'local'}\0${localGitOptions.wslDistro ?? ''}\0${repoPath}\0${remoteName}`
}

/** @internal - exposed for tests only */
export function _resetOriginGitHubApiRepositoryCache(): void {
  originRepoCache.clear()
  originRepoInFlight.clear()
}

/** @internal - exposed for cache-bound tests only */
export function _getOriginGitHubApiRepositoryCacheSize(): number {
  return originRepoCache.size
}

function pruneOriginRepoCache(now: number): void {
  for (const [key, entry] of originRepoCache) {
    if (entry.expiresAt <= now) {
      originRepoCache.delete(key)
    }
  }
  while (originRepoCache.size > ORIGIN_REPO_CACHE_MAX_ENTRIES) {
    const oldestKey = originRepoCache.keys().next().value
    if (oldestKey === undefined) {
      return
    }
    originRepoCache.delete(oldestKey)
  }
}

/**
 * Host-qualified repository identity for one remote: github.com remotes come
 * from the cached slug parser; any other GitHub-shaped host is auth-gated so a
 * non-GitHub forge never routes to the GitHub provider.
 */
export async function getGitHubApiRepositoryForRemote(
  repoPath: string,
  remoteName: string,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitHubApiRepository | null> {
  // Why: generic PR resolution prefers upstream, but this API represents the
  // caller-selected remote exactly (#7331).
  const ownerRepo = await getOwnerRepoForRemote(
    repoPath,
    remoteName,
    connectionId,
    localGitOptions
  )
  if (ownerRepo) {
    return { ...ownerRepo, host: 'github.com' }
  }
  const cacheKey = originRepoCacheKey(repoPath, remoteName, connectionId, localGitOptions)
  const now = Date.now()
  pruneOriginRepoCache(now)
  const cached = originRepoCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return cached.value
  }
  const inFlight = originRepoInFlight.get(cacheKey)
  if (inFlight) {
    return inFlight
  }
  const probe = (async () => {
    const enterpriseOptions =
      Object.keys(localGitOptions).length > 0 ? { localGitExecOptions: localGitOptions } : {}
    const slug =
      remoteName === 'origin'
        ? await getEnterpriseGitHubRepoSlug(repoPath, connectionId, enterpriseOptions)
        : await getEnterpriseGitHubRepoSlugForRemote(
            repoPath,
            remoteName,
            connectionId,
            enterpriseOptions
          )
    originRepoCache.set(cacheKey, { value: slug, expiresAt: Date.now() + ORIGIN_REPO_CACHE_TTL_MS })
    pruneOriginRepoCache(Date.now())
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

export async function getOriginGitHubApiRepository(
  repoPath: string,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitHubApiRepository | null> {
  return getGitHubApiRepositoryForRemote(repoPath, 'origin', connectionId, localGitOptions)
}

/** Hosted mirror of getIssueOwnerRepo: issues prefer `upstream` over `origin`. */
export async function getIssueGitHubApiRepository(
  repoPath: string,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitHubApiRepository | null> {
  const upstream = await getGitHubApiRepositoryForRemote(
    repoPath,
    'upstream',
    connectionId,
    localGitOptions
  )
  if (upstream) {
    return upstream
  }
  return getGitHubApiRepositoryForRemote(repoPath, 'origin', connectionId, localGitOptions)
}

export type GitHubApiRepositoryCandidates = {
  candidates: GitHubApiRepository[]
  headRepo: GitHubApiRepository | null
}

/** Hosted mirror of resolvePRRepositoryCandidates: upstream first, then origin. */
export async function resolveGitHubApiRepositoryCandidates(
  repoPath: string,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitHubApiRepositoryCandidates> {
  const [upstream, origin] = await Promise.all([
    getGitHubApiRepositoryForRemote(repoPath, 'upstream', connectionId, localGitOptions),
    getGitHubApiRepositoryForRemote(repoPath, 'origin', connectionId, localGitOptions)
  ])
  const seen = new Set<string>()
  const candidates: GitHubApiRepository[] = []
  for (const candidate of [upstream, origin]) {
    if (!candidate) {
      continue
    }
    const key = githubRepoIdentityKey(candidate)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    candidates.push(candidate)
  }
  return { candidates, headRepo: origin }
}

export type ResolvedGitHubApiRepositorySource = {
  source: GitHubApiRepository | null
  /** True when explicit upstream is gone and resolver fell back to origin. */
  fellBack: boolean
}

/** Hosted mirror of resolveIssueSource — same preference semantics. */
export async function resolveIssueGitHubApiRepositorySource(
  repoPath: string,
  preference: IssueSourcePreference | undefined,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<ResolvedGitHubApiRepositorySource> {
  if (preference === 'upstream') {
    const upstream = await getGitHubApiRepositoryForRemote(
      repoPath,
      'upstream',
      connectionId,
      localGitOptions
    )
    if (upstream) {
      return { source: upstream, fellBack: false }
    }
    const origin = await getGitHubApiRepositoryForRemote(
      repoPath,
      'origin',
      connectionId,
      localGitOptions
    )
    return { source: origin, fellBack: origin !== null }
  }
  if (preference === 'origin') {
    return {
      source: await getGitHubApiRepositoryForRemote(
        repoPath,
        'origin',
        connectionId,
        localGitOptions
      ),
      fellBack: false
    }
  }
  return {
    source: await getIssueGitHubApiRepository(repoPath, connectionId, localGitOptions),
    fellBack: false
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

/**
 * Positional `HOST/OWNER/REPO` argv value (e.g. `gh repo view <slug>`).
 * Positional slugs bypass the runner's `--repo` qualifier, so they must be
 * qualified here whenever the host is known.
 */
export function githubRepositorySlugArg(repository: GitHubApiRepository): string {
  const slug = `${repository.owner}/${repository.repo}`
  // Why: github.com must be explicit too; otherwise process-level GH_HOST can
  // redirect positional `gh repo view OWNER/REPO` calls to an Enterprise host.
  return repository.host ? `${repository.host}/${slug}` : slug
}
