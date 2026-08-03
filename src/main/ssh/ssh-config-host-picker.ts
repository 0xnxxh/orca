import type {
  SshConfigHostListResult,
  SshConfigHostResolution,
  SshConfigHostSummary,
  SshTarget
} from '../../shared/ssh-types'
import { loadUserSshConfig, type SshConfigHost } from './ssh-config-parser'
import { resolveWithSshG, type SshResolvedConfig } from './ssh-g-config-resolution'

export const SSH_CONFIG_HOST_RESULT_LIMIT = 100

export function searchSshConfigHosts(
  hosts: SshConfigHost[],
  existingTargets: readonly Pick<SshTarget, 'configHost' | 'label'>[],
  query = '',
  suppressedAliases: readonly string[] = []
): SshConfigHostListResult {
  const existingAliases = new Set(
    existingTargets.flatMap((target) =>
      [target.configHost, target.label]
        .filter((alias): alias is string => Boolean(alias))
        .map((alias) => alias.toLowerCase())
    )
  )
  const normalizedQuery = query.trim().toLowerCase()
  const suppressedAliasSet = new Set(suppressedAliases.map((alias) => alias.toLowerCase()))
  const summaries: SshConfigHostSummary[] = []
  const seenAliases = new Set<string>()
  let totalHostCount = 0
  let newHostCount = 0
  let matchCount = 0

  for (const entry of hosts) {
    const normalizedAlias = entry.host.toLowerCase()
    if (suppressedAliasSet.has(normalizedAlias)) {
      continue
    }
    if (seenAliases.has(normalizedAlias)) {
      continue
    }
    seenAliases.add(normalizedAlias)
    const alreadyInOrca = existingAliases.has(normalizedAlias)
    totalHostCount += 1
    newHostCount += alreadyInOrca ? 0 : 1
    if (!matchesQuery(entry, normalizedQuery)) {
      continue
    }
    matchCount += 1
    if (summaries.length < SSH_CONFIG_HOST_RESULT_LIMIT) {
      summaries.push(toSummary(entry, alreadyInOrca))
    }
  }

  return {
    hosts: summaries,
    totalHostCount,
    newHostCount,
    matchCount,
    hasMore: matchCount > summaries.length
  }
}

export function listUserSshConfigHostSummaries(
  existingTargets: readonly Pick<SshTarget, 'configHost' | 'label'>[],
  query?: string,
  suppressedAliases?: readonly string[]
): SshConfigHostListResult {
  return searchSshConfigHosts(loadUserSshConfig(), existingTargets, query, suppressedAliases)
}

export async function resolveUserSshConfigHost(
  alias: string,
  resolver: (host: string) => Promise<SshResolvedConfig | null> = resolveWithSshG
): Promise<SshConfigHostResolution | null> {
  const resolved = await resolver(alias)
  if (!resolved?.hostname) {
    return null
  }
  return {
    alias,
    hostname: resolved.hostname,
    port: resolved.port,
    username: resolved.user ?? '',
    identityFiles: resolved.identityFile,
    ...(resolved.identityAgent ? { identityAgent: resolved.identityAgent } : {}),
    identitiesOnly: resolved.identitiesOnly,
    forwardAgent: resolved.forwardAgent,
    gssapiAuthentication: resolved.gssapiAuthentication,
    ...(resolved.proxyCommand ? { proxyCommand: resolved.proxyCommand } : {}),
    proxyUseFdpass: resolved.proxyUseFdpass,
    ...(resolved.proxyJump ? { jumpHost: resolved.proxyJump } : {})
  }
}

function toSummary(entry: SshConfigHost, alreadyInOrca: boolean): SshConfigHostSummary {
  return {
    alias: entry.host,
    hostname: entry.hostname || entry.host,
    port: entry.port ?? 22,
    username: entry.user ?? '',
    ...(entry.identityFile ? { identityFile: entry.identityFile } : {}),
    ...(entry.proxyCommand ? { proxyCommand: entry.proxyCommand } : {}),
    ...(entry.proxyJump ? { jumpHost: entry.proxyJump } : {}),
    alreadyInOrca
  }
}

function matchesQuery(entry: SshConfigHost, query: string): boolean {
  return (
    !query ||
    entry.host.toLowerCase().includes(query) ||
    (entry.hostname ?? entry.host).toLowerCase().includes(query) ||
    (entry.user ?? '').toLowerCase().includes(query)
  )
}
