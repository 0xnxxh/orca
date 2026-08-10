import type { ChildProcess } from 'node:child_process'
import type {
  AiVaultServiceInit,
  AiVaultServiceLane,
  AiVaultServiceRequest
} from './session-scanner-service-protocol'

export const AI_VAULT_SERVICE_READY_TIMEOUT_MS = 5_000
export const AI_VAULT_SERVICE_SCAN_TIMEOUT_MS = 130_000
export const AI_VAULT_SERVICE_INTERACTIVE_TIMEOUT_MS = 15_000
export const AI_VAULT_SERVICE_MAX_CALLS = 16
export const AI_VAULT_SERVICE_IDLE_TIMEOUT_MS = 10 * 60_000
export const AI_VAULT_SERVICE_SHUTDOWN_TIMEOUT_MS = 2_000

export type AiVaultServiceProcessFactory = () => ChildProcess
export type AiVaultServiceClientOptions = {
  processFactory: AiVaultServiceProcessFactory
  init: Omit<AiVaultServiceInit, 'type' | 'protocol'>
  idleTimeoutMs?: number
  onStderr?: (text: string) => void
}

export type AiVaultServiceInvalidation = {
  resolve: () => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export function retireAiVaultServiceChild(child: ChildProcess): void {
  child.removeAllListeners('message')
  child.removeAllListeners('disconnect')
  child.removeAllListeners('error')
  child.removeAllListeners('exit')
  const killTimer = setTimeout(() => child.kill(), AI_VAULT_SERVICE_SHUTDOWN_TIMEOUT_MS)
  killTimer.unref?.()
  child.once('exit', () => clearTimeout(killTimer))
  child.send({ type: 'shutdown' }, () => undefined)
  child.unref()
}

export function armAiVaultServiceCancellationTimeout(
  call: AiVaultServicePendingCall,
  onExpired: () => void
): void {
  if (call.timer) {
    clearTimeout(call.timer)
  }
  call.timer = setTimeout(onExpired, AI_VAULT_SERVICE_SHUTDOWN_TIMEOUT_MS)
  call.timer.unref?.()
}

export function clearAiVaultServiceCall(call: AiVaultServicePendingCall): void {
  if (call.timer) {
    clearTimeout(call.timer)
    call.timer = null
  }
  if (call.signal && call.onAbort) {
    call.signal.removeEventListener('abort', call.onAbort)
    call.onAbort = null
  }
}

export function rejectAiVaultServiceCall(call: AiVaultServicePendingCall, error: Error): void {
  clearAiVaultServiceCall(call)
  if (!call.cancelled) {
    call.reject(error)
  }
}

export type AiVaultServicePendingCall = {
  request: AiVaultServiceRequest
  lane: AiVaultServiceLane
  signal?: AbortSignal
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout | null
  onAbort: (() => void) | null
  cancelled: boolean
}

export type AiVaultServiceReadyWaiter = {
  promise: Promise<ChildProcess>
  resolve: (child: ChildProcess) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}
