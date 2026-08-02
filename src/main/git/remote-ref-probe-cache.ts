import { getSshGitProviderGeneration } from '../providers/ssh-git-dispatch'
import { runCoalescedProbe, type CoalescedProbes } from './coalesced-probe'
import { isTransientGitProbeError, readRemoteUrl } from './remote-url-probe'

/**
 * The "is this repo mine?" probe every forge integration runs: read the remote's
 * URL once per repo/runtime, cache what the provider's parser made of it, and
 * never cache an answer a failed probe never gave.
 */

const REPO_REF_CACHE_MAX_ENTRIES = 512

/**
 * Why: "not this provider" only holds until someone edits the repo's remotes —
 * and a repo first probed before it had any remote answers that way too.
 * Nothing here watches `.git/config`, and a watcher cannot cover the SSH and WSL
 * runtimes this cache also serves, so negatives expire instead: one probe per
 * repo per interval is what lets a remote added mid-session be picked up without
 * a restart. Positives stay, as they did before.
 */
const NEGATIVE_ENTRY_TTL_MS = 5 * 60_000

type CachedRepoRef<Ref> = { value: Ref | null; expiresAt: number }

export type RemoteRefLocalGitOptions = {
  wslDistro?: string
}

export type RemoteRefProbeCache<Ref> = {
  get(
    repoPath: string,
    remoteName: string,
    connectionId?: string | null,
    localGitOptions?: RemoteRefLocalGitOptions
  ): Promise<Ref | null>
  clear(): void
  size(): number
}

export function createRemoteRefProbeCache<Ref>(
  parseRemoteUrl: (remoteUrl: string) => Ref | null
): RemoteRefProbeCache<Ref> {
  const repoRefCache = new Map<string, CachedRepoRef<Ref>>()
  const inFlight: CoalescedProbes<Ref | null> = new Map()

  function remember(cacheKey: string, value: Ref | null): void {
    repoRefCache.set(cacheKey, {
      value,
      expiresAt: value === null ? Date.now() + NEGATIVE_ENTRY_TTL_MS : Number.POSITIVE_INFINITY
    })
    while (repoRefCache.size > REPO_REF_CACHE_MAX_ENTRIES) {
      const oldestKey = repoRefCache.keys().next().value
      if (oldestKey === undefined) {
        return
      }
      repoRefCache.delete(oldestKey)
    }
  }

  async function probe(
    cacheKey: string,
    repoPath: string,
    remoteName: string,
    connectionId: string | null | undefined,
    localGitOptions: RemoteRefLocalGitOptions
  ): Promise<Ref | null> {
    try {
      const stdout = await readRemoteUrl(
        {
          repoPath,
          connectionId,
          ...(localGitOptions.wslDistro ? { wslDistro: localGitOptions.wslDistro } : {})
        },
        remoteName
      )
      if (stdout === null) {
        return null
      }
      const result = parseRemoteUrl(stdout)
      remember(cacheKey, result)
      return result
    } catch (error) {
      if (connectionId || isTransientGitProbeError(error)) {
        // Why: SSH provider failures are often transient reconnect/tunnel states,
        // and a probe killed on its deadline says nothing about the remote either;
        // caching them as "not this provider" would poison the repo for the session.
        return null
      }
      remember(cacheKey, null)
      return null
    }
  }

  return {
    async get(repoPath, remoteName, connectionId, localGitOptions = {}) {
      // Why: a reconnect retires the connection an answer came from, and with it
      // the probe still running on it — stamping the generation stops a caller on
      // the new connection from adopting either.
      const runtimeKey = connectionId
        ? `${connectionId}:${getSshGitProviderGeneration(connectionId)}`
        : `local:${localGitOptions.wslDistro ?? 'host'}`
      const cacheKey = `${runtimeKey}\0${repoPath}\0${remoteName}`
      const cached = repoRefCache.get(cacheKey)
      if (cached) {
        if (cached.expiresAt > Date.now()) {
          return cached.value
        }
        repoRefCache.delete(cacheKey)
      }
      // Why: every branch of a repo resolves its forge through this probe, so a
      // poll of the worktree list arrives as a burst of identical lookups. One
      // young probe answers all of them instead of spawning a `git` per branch.
      return runCoalescedProbe(inFlight, cacheKey, () =>
        probe(cacheKey, repoPath, remoteName, connectionId, localGitOptions)
      )
    },
    clear() {
      repoRefCache.clear()
      inFlight.clear()
    },
    size() {
      return repoRefCache.size
    }
  }
}
