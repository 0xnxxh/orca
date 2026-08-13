import { scanSshAiVaultSessions } from '../ai-vault/ssh-session-list'
import { aiVaultScanIssueResult, mergeAiVaultListResults } from '../ai-vault/session-list-results'
import { requestedAiVaultSessionDepth } from '../../shared/ai-vault-session-depth'
import {
  isAiVaultScanCancelledError,
  type AiVaultListArgs,
  type AiVaultListResult
} from '../../shared/ai-vault-types'
import {
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  toRuntimeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostScope
} from '../../shared/execution-host'
import { getActiveSshAiVaultHostInfos } from './ssh'
import { discoverAiVaultHosts } from './ai-vault-host-discovery'
import {
  scanRuntimeAiVaultSessions,
  type RuntimeAiVaultHostInfo,
  type RuntimeAiVaultScanner
} from './ai-vault-runtime-scan'
import { scanHostLegWithCache } from './ai-vault-host-leg-cache'
import {
  scanSshAiVaultSessionsByOwner,
  type RuntimeOwnedSshAiVaultScanner
} from './ai-vault-runtime-owned-ssh'
import type { RuntimeOwnedSshAiVaultHost } from '../ai-vault/runtime-owned-ssh-session-list'

export const AI_VAULT_ALL_HOST_RUNTIME_TIMEOUT_MS = 3_000
export const AI_VAULT_ALL_HOST_SSH_RELAY_TIMEOUT_MS = 15_000
export const AI_VAULT_ALL_HOST_SSH_TIMEOUT_MS = 20_000

export type AiVaultHostScopeScanOptions = {
  getActiveRuntimeAiVaultHostInfos?: () => readonly RuntimeAiVaultHostInfo[]
  scanRuntimeAiVaultSessions?: RuntimeAiVaultScanner
  findRuntimeOwningSshAiVaultHost?: (targetId: string) => Promise<RuntimeOwnedSshAiVaultHost | null>
  scanRuntimeOwnedSshAiVaultSessions?: RuntimeOwnedSshAiVaultScanner
  scanLocal: (
    args: AiVaultListArgs | undefined,
    signal: AbortSignal | undefined
  ) => Promise<AiVaultListResult>
}

export async function scanAiVaultSessionsByHostScope(
  args: AiVaultListArgs | undefined,
  executionHostScope: ExecutionHostScope,
  signal: AbortSignal | undefined,
  cacheKey: string,
  options: AiVaultHostScopeScanOptions
): Promise<AiVaultListResult> {
  const depth = requestedAiVaultSessionDepth(args)
  const scopePaths = args?.scopePaths ?? []
  if (executionHostScope === LOCAL_EXECUTION_HOST_ID) {
    return scanLocalAiVaultSessionsAsIssue(options.scanLocal, args, signal)
  }
  if (executionHostScope === 'all') {
    return scanAllAiVaultHosts(args, signal, cacheKey, depth, scopePaths, options)
  }

  const parsed = parseExecutionHostId(executionHostScope)
  if (parsed?.kind === 'ssh') {
    return scanSshAiVaultSessionsByOwner({
      targetId: parsed.targetId,
      listArgs: args,
      signal,
      timeoutMs: AI_VAULT_ALL_HOST_SSH_TIMEOUT_MS,
      findOwner: options.findRuntimeOwningSshAiVaultHost,
      scanOwned: options.scanRuntimeOwnedSshAiVaultSessions
    })
  }
  if (parsed?.kind === 'runtime') {
    return scanRuntimeAiVaultSessions({
      hostInfo: {
        environmentId: parsed.environmentId,
        executionHostId: toRuntimeExecutionHostId(parsed.environmentId)
      },
      scanner: options.scanRuntimeAiVaultSessions,
      listArgs: args,
      options: { signal }
    })
  }

  return aiVaultScanIssueResult({
    executionHostId: executionHostScope,
    path: executionHostScope,
    message: 'Agent Session History is not available for this execution host.'
  })
}

async function scanAllAiVaultHosts(
  args: AiVaultListArgs | undefined,
  signal: AbortSignal | undefined,
  cacheKey: string,
  depth: ReturnType<typeof requestedAiVaultSessionDepth>,
  scopePaths: readonly string[],
  options: AiVaultHostScopeScanOptions
): Promise<AiVaultListResult> {
  const runtimeHosts = discoverAiVaultHosts(
    () => options.getActiveRuntimeAiVaultHostInfos?.() ?? [],
    { path: 'runtime environments', fallbackMessage: 'Runtime hosts are unavailable.' }
  )
  const sshHosts = discoverAiVaultHosts(getActiveSshAiVaultHostInfos, {
    path: 'SSH hosts',
    fallbackMessage: 'SSH hosts are unavailable.'
  })
  const scannedResults = await Promise.all([
    scanLocalAiVaultSessionsAsIssue(options.scanLocal, args, signal),
    ...sshHosts.hostInfos.map((hostInfo) =>
      scanHostLegWithCache({
        cacheKey: `${cacheKey}|${toSshExecutionHostId(hostInfo.targetId)}`,
        depth,
        scopePaths,
        force: args?.force === true,
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
        force: args?.force === true,
        scan: () =>
          scanRuntimeAiVaultSessions({
            hostInfo,
            scanner: options.scanRuntimeAiVaultSessions,
            listArgs: args,
            options: {
              signal,
              timeoutMs: AI_VAULT_ALL_HOST_RUNTIME_TIMEOUT_MS,
              includeOwnedSshHosts: true
            }
          })
      })
    )
  ])
  return mergeAiVaultListResults(
    [
      ...scannedResults,
      ...(runtimeHosts.issue ? [runtimeHosts.issue] : []),
      ...(sshHosts.issue ? [sshHosts.issue] : [])
    ],
    args?.limit,
    args?.unlimited
  )
}

async function scanLocalAiVaultSessionsAsIssue(
  scanLocal: AiVaultHostScopeScanOptions['scanLocal'],
  args: AiVaultListArgs | undefined,
  signal: AbortSignal | undefined
): Promise<AiVaultListResult> {
  try {
    return await scanLocal(args, signal)
  } catch (error) {
    if (isAiVaultScanCancelledError(error)) {
      throw error
    }
    return aiVaultScanIssueResult({
      executionHostId: LOCAL_EXECUTION_HOST_ID,
      path: 'this computer',
      message: error instanceof Error ? error.message : 'Local session scan failed.'
    })
  }
}
