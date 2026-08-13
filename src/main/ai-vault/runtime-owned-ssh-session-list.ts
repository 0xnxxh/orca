import {
  AI_VAULT_SCOPE_PATHS_MAX_COUNT,
  type AiVaultListArgs,
  type AiVaultListResult
} from '../../shared/ai-vault-types'
import type {
  AiVaultSessionTitlesArgs,
  AiVaultSessionTitlesResult
} from '../../shared/ai-vault-session-title'
import {
  isRuntimeOwnedSshTargetId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'
import { listEnvironments } from '../../shared/runtime-environment-store'
import { callRuntimeEnvironment } from '../ipc/runtime-environment-transport-routing'
import { parseAiVaultListResult } from './session-list-result-validation'
import { parseAiVaultSessionTitlesResult } from './session-title-result-validation'
import { aiVaultScanIssueResult, restampAiVaultListResult } from './session-list-results'

export type RuntimeOwnedSshAiVaultHost = {
  environmentId: string
  targetId: string
  executionHostId: `ssh:${string}`
}

export type RuntimeOwnedSshAiVaultScanOptions = {
  timeoutMs?: number
}

const UNSUPPORTED_SSH_HOST_PARAM = /invalid (runtime )?execution host id/i

export async function listRuntimeOwnedSshAiVaultTargets(
  userDataPath: string,
  environmentId: string,
  options: RuntimeOwnedSshAiVaultScanOptions = {}
): Promise<readonly RuntimeOwnedSshAiVaultHost[]> {
  const response = await callRuntimeEnvironment(
    userDataPath,
    environmentId,
    'ssh.listTargetSummaries',
    undefined,
    options.timeoutMs
  )
  if (response.ok !== true || !isTargetSummaryList(response.result)) {
    return []
  }
  return response.result.targets.flatMap((target) => {
    if (typeof target.id !== 'string' || target.id.length === 0) {
      return []
    }
    if (isRuntimeOwnedSshTargetId(target.id)) {
      return []
    }
    return [
      {
        environmentId,
        targetId: target.id,
        executionHostId: toSshExecutionHostId(target.id)
      }
    ]
  })
}

export async function findRuntimeOwningSshAiVaultHost(
  userDataPath: string,
  targetId: string,
  options: RuntimeOwnedSshAiVaultScanOptions = {}
): Promise<RuntimeOwnedSshAiVaultHost | null> {
  if (isRuntimeOwnedSshTargetId(targetId)) {
    return null
  }
  for (const environment of listEnvironments(userDataPath)) {
    const hosts = await listRuntimeOwnedSshAiVaultTargets(userDataPath, environment.id, options)
    const match = hosts.find((host) => host.targetId === targetId)
    if (match) {
      return match
    }
  }
  return null
}

export async function scanRuntimeOwnedSshAiVaultSessions(
  userDataPath: string,
  environmentId: string,
  targetId: string,
  args: AiVaultListArgs,
  options: RuntimeOwnedSshAiVaultScanOptions = {}
): Promise<AiVaultListResult> {
  const executionHostId = toSshExecutionHostId(targetId)
  const response = await callRuntimeEnvironment(
    userDataPath,
    environmentId,
    'aiVault.listSessions',
    {
      limit: args.limit,
      unlimited: args.unlimited,
      force: args.force,
      scopePaths: args.scopePaths?.slice(0, AI_VAULT_SCOPE_PATHS_MAX_COUNT),
      executionHostId
    },
    options.timeoutMs
  )
  if (response.ok !== true) {
    return aiVaultScanIssueResult({
      executionHostId,
      path: targetId,
      message: unsupportedSshHostMessage(response.error.message)
    })
  }
  try {
    return restampAiVaultListResult(parseAiVaultListResult(response.result), executionHostId)
  } catch (error) {
    return aiVaultScanIssueResult({
      executionHostId,
      path: targetId,
      message: `Invalid aiVault.listSessions response: ${
        error instanceof Error ? error.message : 'unexpected result shape'
      }`
    })
  }
}

export async function resolveRuntimeOwnedSshAiVaultSessionTitles(
  userDataPath: string,
  environmentId: string,
  targetId: string,
  args: AiVaultSessionTitlesArgs
): Promise<AiVaultSessionTitlesResult> {
  const executionHostId: ExecutionHostId = toSshExecutionHostId(targetId)
  const response = await callRuntimeEnvironment(
    userDataPath,
    environmentId,
    'aiVault.resolveSessionTitles',
    { requests: args.requests, executionHostId }
  )
  if (response.ok !== true) {
    return { titles: [] }
  }
  try {
    return parseAiVaultSessionTitlesResult(response.result)
  } catch {
    return { titles: [] }
  }
}

function unsupportedSshHostMessage(message: string): string {
  if (UNSUPPORTED_SSH_HOST_PARAM.test(message)) {
    return 'This Orca server cannot scan Agent Session History on its SSH hosts. Update the server and try again.'
  }
  return message
}

function isTargetSummaryList(value: unknown): value is { targets: { id?: unknown }[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { targets?: unknown }).targets)
  )
}
