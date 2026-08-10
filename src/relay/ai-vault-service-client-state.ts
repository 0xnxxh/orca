import type { ChildProcess } from 'node:child_process'
import type { AiVaultListResult } from '../shared/ai-vault-types'
import type {
  AiVaultSessionTitleRequest,
  AiVaultSessionTitlesResult
} from '../shared/ai-vault-session-title'
import type { SshAiVaultRelayListParams } from '../shared/ssh-ai-vault-relay'
import type { RemoteHostPlatform } from '../main/ssh/ssh-remote-platform'
import type { RelayAiVaultServiceRequest } from './ai-vault-service-protocol'

export const RELAY_AI_VAULT_READY_TIMEOUT_MS = 5_000
export const RELAY_AI_VAULT_SCAN_TIMEOUT_MS = 130_000
export const RELAY_AI_VAULT_TITLE_TIMEOUT_MS = 15_000
export const RELAY_AI_VAULT_MAX_CALLS = 16

export function relayAiVaultAbortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

export function relayAiVaultError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function armRelayAiVaultCancellationTimeout(
  call: RelayAiVaultServiceCall,
  onExpired: () => void
): void {
  call.timer = setTimeout(onExpired, 2_000)
  call.timer.unref?.()
}

export type RelayAiVaultServiceCall = {
  request: RelayAiVaultServiceRequest
  signal?: AbortSignal
  forceStart: boolean
  resolve: (value: AiVaultListResult | AiVaultSessionTitlesResult) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout | null
  onAbort: (() => void) | null
  settled: boolean
}

export type RelayAiVaultServiceApi = {
  listSessions(params: SshAiVaultRelayListParams, signal?: AbortSignal): Promise<AiVaultListResult>
  resolveSessionTitles(
    requests: AiVaultSessionTitleRequest[],
    signal?: AbortSignal
  ): Promise<AiVaultSessionTitlesResult>
}

export type RelayAiVaultServiceClientOptions = {
  processFactory: () => ChildProcess
  init: {
    remoteHome: string
    hostPlatform: RemoteHostPlatform
  }
  now?: () => number
}
