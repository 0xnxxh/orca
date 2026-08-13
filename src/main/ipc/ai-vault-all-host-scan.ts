import type { AiVaultListArgs, AiVaultListResult } from '../../shared/ai-vault-types'
import type { AiVaultSessionDepth } from '../../shared/ai-vault-session-depth'
import { toSshExecutionHostId } from '../../shared/execution-host'
import { mergeAiVaultListResults } from '../ai-vault/session-list-results'
import { scanSshAiVaultSessions } from '../ai-vault/ssh-session-list'
import {
  unscannedSshHostIssues,
  type ExpectedSshAiVaultHost
} from '../ai-vault/unscanned-ssh-host-issues'
import { discoverAiVaultHosts, type AiVaultHostDiscoveryResult } from './ai-vault-host-discovery'
import { scanHostLegWithCache } from './ai-vault-host-leg-cache'
import {
  scanRuntimeAiVaultSessions,
  type RuntimeAiVaultHostInfo,
  type RuntimeAiVaultScanner
} from './ai-vault-runtime-scan'
import { getActiveSshAiVaultHostInfos } from './ssh'

const AI_VAULT_ALL_HOST_RUNTIME_TIMEOUT_MS = 3_000
// Why: a remote home with many agent roots routinely needs seconds to walk,
// stat and parse. The old shared 3s bound emptied healthy SSH hosts in the
// all-hosts view; the relay gets a real scan budget and the whole leg (relay
// attempt plus any legacy crawl) stays bounded so one host can't hold the
// merge open.
const AI_VAULT_ALL_HOST_SSH_RELAY_TIMEOUT_MS = 15_000
const AI_VAULT_ALL_HOST_SSH_TIMEOUT_MS = 20_000

export type AllHostAiVaultScanParams = {
  args?: AiVaultListArgs
  signal?: AbortSignal
  cacheKey: string
  depth: AiVaultSessionDepth
  scopePaths: readonly string[]
  scanLocal: () => Promise<AiVaultListResult>
  runtimeScanner?: RuntimeAiVaultScanner
  getActiveRuntimeAiVaultHostInfos?: () => readonly RuntimeAiVaultHostInfo[]
  getExpectedSshAiVaultHosts?: () => readonly ExpectedSshAiVaultHost[]
}

export async function scanAllHostAiVaultSessions(
  params: AllHostAiVaultScanParams
): Promise<AiVaultListResult> {
  const { args, signal, cacheKey, depth, scopePaths } = params
  const force = args?.force === true
  const runtimeHosts = discoverAiVaultHosts(
    () => params.getActiveRuntimeAiVaultHostInfos?.() ?? [],
    { path: 'runtime environments', fallbackMessage: 'Runtime hosts are unavailable.' }
  )
  const sshHosts: AiVaultHostDiscoveryResult<{ targetId: string }> = discoverAiVaultHosts(
    getActiveSshAiVaultHostInfos,
    { path: 'SSH hosts', fallbackMessage: 'SSH hosts are unavailable.' }
  )
  const expectedSshHosts = discoverAiVaultHosts(() => params.getExpectedSshAiVaultHosts?.() ?? [], {
    path: 'SSH hosts',
    fallbackMessage: 'SSH workspace hosts are unavailable.'
  })
  const discoveryResults = [runtimeHosts.issue, sshHosts.issue, expectedSshHosts.issue].filter(
    (issue): issue is AiVaultListResult => issue !== undefined
  )
  const scannedResults = await Promise.all([
    params.scanLocal(),
    ...sshHosts.hostInfos.map((hostInfo) =>
      scanHostLegWithCache({
        cacheKey: `${cacheKey}|${toSshExecutionHostId(hostInfo.targetId)}`,
        depth,
        scopePaths,
        force,
        scan: () =>
          scanSshAiVaultSessions(hostInfo.targetId, args, {
            signal,
            timeoutMs: AI_VAULT_ALL_HOST_SSH_TIMEOUT_MS,
            relayTimeoutMs: AI_VAULT_ALL_HOST_SSH_RELAY_TIMEOUT_MS
          })
      })
    ),
    ...runtimeHosts.hostInfos.map((hostInfo) =>
      scanHostLegWithCache({
        cacheKey: `${cacheKey}|${hostInfo.executionHostId}`,
        depth,
        scopePaths,
        force,
        scan: () =>
          scanRuntimeAiVaultSessions({
            hostInfo,
            scanner: params.runtimeScanner,
            listArgs: args,
            options: { signal, timeoutMs: AI_VAULT_ALL_HOST_RUNTIME_TIMEOUT_MS }
          })
      })
    )
  ])
  const merged = mergeAiVaultListResults(
    [...scannedResults, ...discoveryResults],
    args?.limit,
    args?.unlimited
  )
  // Appended after the merge, never as a merge input: a synthetic result would
  // feed the merged scannedAt and remint a stamp the renderer compares on.
  const unscanned = unscannedSshHostIssues({
    expectedHosts: expectedSshHosts.hostInfos,
    scannedTargetIds: new Set(sshHosts.hostInfos.map((hostInfo) => hostInfo.targetId))
  })
  return unscanned.length > 0 ? { ...merged, issues: [...merged.issues, ...unscanned] } : merged
}
