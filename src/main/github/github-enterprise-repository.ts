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
import { parseWslPath } from '../wsl'

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

// Why: connection-backed Git operations execute remotely, but gh intentionally
// executes on the native host. Only WSL selects a distinct gh config/runtime.
function runtimeCacheKey(repoPath: string, wslDistro?: string): string {
  const resolvedDistro = wslDistro ?? parseWslPath(repoPath)?.distro
  return `local:${resolvedDistro?.toLowerCase() ?? 'host'}`
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
 * The probe inventories gh's configured hosts and matches `host` locally. It
 * deliberately does not pass an untrusted remote host to gh because ambient
 * enterprise tokens could otherwise be sent to that host during validation.
 * Cached briefly per runtime+host so provider-detection polling stays cheap.
 */
export async function isGitHubHostAuthenticated(
  host: string,
  repoPath: string,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<boolean> {
  const normalizedHost = host.toLowerCase()
  const cacheKey = `${runtimeCacheKey(repoPath, localGitOptions.wslDistro)}\0${normalizedHost}`
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
      ...ghRepoExecOptions(githubRepoContext(repoPath, connectionId, localGitOptions))
    }
    let authenticated: boolean
    try {
      const { stdout, stderr } = await ghExecFileAsync(['auth', 'status'], execOptions)
      authenticated = parseAuthStatus(`${stdout}\n${stderr}`).some(
        (account) => account.host.toLowerCase() === normalizedHost
      )
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

/** Safely validate a project-selected host without giving the untrusted host
 * to gh. Global project calls have no repository cwd, so they use native gh. */
export function isGitHubHostAuthenticatedForGlobalCli(host: string): Promise<boolean> {
  return isGitHubHostAuthenticated(host, '', 'project-host-validation')
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
