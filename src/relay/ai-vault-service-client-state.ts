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
export const RELAY_AI_VAULT_IDLE_TIMEOUT_MS = 10 * 60_000

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

export function settleRelayAiVaultServiceCall(
  call: RelayAiVaultServiceCall,
  value: Error | AiVaultListResult | AiVaultSessionTitlesResult
): void {
  if (call.settled) {
    return
  }
  call.settled = true
  if (call.timer) {
    clearTimeout(call.timer)
  }
  if (call.signal && call.onAbort) {
    call.signal.removeEventListener('abort', call.onAbort)
  }
  if (value instanceof Error) {
    call.reject(value)
  } else {
    call.resolve(value)
  }
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
  idleTimeoutMs?: number
}

export class RelayAiVaultIdleRetirement {
  private timer: NodeJS.Timeout | null = null

  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  schedule(busy: boolean, timeoutMs: number, retire: () => void): void {
    if (busy || this.timer) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      retire()
    }, timeoutMs)
    this.timer.unref?.()
  }
}

export function retireRelayAiVaultServiceChild(child: ChildProcess): void {
  const timer = setTimeout(() => child.kill(), 2_000)
  timer.unref?.()
  child.once('exit', () => clearTimeout(timer))
  child.send({ type: 'shutdown' }, () => undefined)
}
