import { ghExecFileAsync } from '../git/runner'
import type { GitHubOwnerRepo } from '../../shared/types'
import {
  getHostedReviewLocalGitOptions,
  type HostedReviewExecutionOptions
} from '../source-control/hosted-review-git-options'
import { parseAuthStatus } from './auth-diagnose'
import {
  ghRepoExecOptions,
  getRemoteUrlForRepo,
  githubRepoContext,
  parseGitHubRemoteIdentity,
  type LocalGitExecOptions
} from './github-repository-identity'

export type GitHubEnterpriseRepoSlug = GitHubOwnerRepo & { host: string }

// Why: `gh` only ever manages github.com / GitHub Enterprise credentials, so a
// host `gh auth status` reports as logged-in is definitively a GitHub host. This
// mirrors the `glab auth status` signal GitLab self-hosted detection uses, so a
// GHES remote is not left to fall through to Gitea (#8312).
const HOST_AUTH_TTL_MS = 60_000
const HOST_AUTH_CACHE_MAX_ENTRIES = 512

type HostAuthCacheEntry = {
  authenticated: boolean
  expiresAt: number
}

const hostAuthCache = new Map<string, HostAuthCacheEntry>()
const hostAuthInFlight = new Map<string, Promise<boolean>>()

// Why: gh's authenticated hosts live in per-runtime config — a WSL distro and an
// SSH host each carry their own `hosts.yml` — so cache state must be keyed by the
// runtime that executes gh, not shared under one "local" bucket. Mirrors the
// runtime scoping used by owner/repo resolution.
function runtimeCacheKey(connectionId?: string | null, wslDistro?: string): string {
  return connectionId ?? `local:${wslDistro ?? 'host'}`
}

/** @internal - exposed for tests only */
export function _resetGitHubHostAuthCache(): void {
  hostAuthCache.clear()
  hostAuthInFlight.clear()
}

/** @internal - exposed for cache-bound tests only */
export function _getGitHubHostAuthCacheSize(): number {
  return hostAuthCache.size
}

function pruneHostAuthCache(now: number): void {
  for (const [key, entry] of hostAuthCache) {
    if (entry.expiresAt <= now) {
      hostAuthCache.delete(key)
    }
  }
  while (hostAuthCache.size > HOST_AUTH_CACHE_MAX_ENTRIES) {
    const oldestKey = hostAuthCache.keys().next().value
    if (oldestKey === undefined) {
      return
    }
    hostAuthCache.delete(oldestKey)
  }
}

// Only gh's own stdout/stderr — not the Error.message — counts as an
// authoritative answer. A spawn failure (gh missing, ENOENT) carries just a
// message and no command output, and must stay indeterminate rather than be
// read as "host not authenticated".
function ghCommandOutput(error: unknown): string {
  const execErr = error as { stdout?: unknown; stderr?: unknown }
  return [execErr?.stdout, execErr?.stderr]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
}

/**
 * Whether `gh` is authenticated to `host` from the repository's own runtime.
 *
 * The probe runs `gh auth status --hostname <host>` with the repo's execution
 * options (cwd / WSL distro, or SSH-local like the create path), so a GHES login
 * stored only in that runtime's gh config — or a `GH_ENTERPRISE_TOKEN` inferred
 * from it — is honored instead of the host/default-distro gh. Cached briefly per
 * runtime+host so provider-detection polling does not re-spawn gh each time.
 */
export async function isGitHubHostAuthenticated(
  host: string,
  repoPath: string,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<boolean> {
  const normalizedHost = host.toLowerCase()
  const cacheKey = `${runtimeCacheKey(connectionId, localGitOptions.wslDistro)}\0${normalizedHost}`
  const now = Date.now()
  pruneHostAuthCache(now)
  const cached = hostAuthCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return cached.authenticated
  }
  const inFlight = hostAuthInFlight.get(cacheKey)
  if (inFlight) {
    return inFlight
  }
  // Why: provider detection and review loading can probe the same runtime at
  // once; coalesce them so one host never spawns duplicate auth subprocesses.
  const probe = (async () => {
    const execOptions = {
      ...ghRepoExecOptions(githubRepoContext(repoPath, connectionId, localGitOptions)),
      // Why: scope any rate-limit breaker trip from this probe to the probed
      // host, not to gh's default account.
      host: normalizedHost
    }
    let authenticated: boolean
    try {
      await ghExecFileAsync(['auth', 'status', '--hostname', normalizedHost], execOptions)
      authenticated = true
    } catch (error) {
      const output = ghCommandOutput(error)
      if (!output) {
        // Indeterminate (gh missing / spawn failure) — do not cache so a later
        // probe (gh installed, tunnel ready, token added) can recover.
        return false
      }
      // gh exits non-zero when a host has a token problem but still prints the
      // per-host status; treat the host as GitHub only when it is actually listed.
      authenticated = parseAuthStatus(output).some(
        (account) => account.host.toLowerCase() === normalizedHost
      )
    }
    hostAuthCache.set(cacheKey, { authenticated, expiresAt: Date.now() + HOST_AUTH_TTL_MS })
    pruneHostAuthCache(Date.now())
    return authenticated
  })()
  hostAuthInFlight.set(cacheKey, probe)
  try {
    return await probe
  } finally {
    if (hostAuthInFlight.get(cacheKey) === probe) {
      hostAuthInFlight.delete(cacheKey)
    }
  }
}

/**
 * Resolve owner/repo for a GitHub Enterprise Server remote — a custom host the
 * user is gh-authenticated to. Returns null for github.com (already handled by
 * {@link getOwnerRepo}) and for hosts gh is not logged in to
 * (Gitea/Forgejo/self-hosted GitLab/etc.), so GHES routes to the GitHub provider
 * without a GitHub provider stealing another forge's remote.
 */
export async function getEnterpriseGitHubRepoSlugForRemote(
  repoPath: string,
  remoteName: string,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<GitHubEnterpriseRepoSlug | null> {
  const localGitOptions = getHostedReviewLocalGitOptions(options)
  const context = githubRepoContext(repoPath, connectionId, localGitOptions)
  let remoteUrl: string | null
  try {
    remoteUrl = await getRemoteUrlForRepo(context, remoteName)
  } catch {
    return null
  }
  const identity = remoteUrl ? parseGitHubRemoteIdentity(remoteUrl) : null
  if (!identity || identity.host === 'github.com') {
    return null
  }
  const authenticated = await isGitHubHostAuthenticated(
    identity.host,
    repoPath,
    connectionId,
    localGitOptions
  )
  return authenticated ? { owner: identity.owner, repo: identity.repo, host: identity.host } : null
}

export async function getEnterpriseGitHubRepoSlug(
  repoPath: string,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<GitHubEnterpriseRepoSlug | null> {
  return getEnterpriseGitHubRepoSlugForRemote(repoPath, 'origin', connectionId, options)
}
