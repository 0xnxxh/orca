import type { ChildProcess } from 'node:child_process'
import type { AiVaultListResult } from '../shared/ai-vault-types'
import type {
  AiVaultSessionTitleRequest,
  AiVaultSessionTitlesResult
} from '../shared/ai-vault-session-title'
import type { SshAiVaultRelayListParams } from '../shared/ssh-ai-vault-relay'
import {
  RELAY_AI_VAULT_MAX_CALLS,
  RELAY_AI_VAULT_READY_TIMEOUT_MS,
  RELAY_AI_VAULT_SCAN_TIMEOUT_MS,
  RELAY_AI_VAULT_TITLE_TIMEOUT_MS,
  armRelayAiVaultCancellationTimeout,
  relayAiVaultAbortError,
  relayAiVaultError,
  type RelayAiVaultServiceApi,
  type RelayAiVaultServiceCall,
  type RelayAiVaultServiceClientOptions
} from './ai-vault-service-client-state'
import {
  RELAY_AI_VAULT_SERVICE_PROTOCOL,
  isRelayAiVaultServiceChildMessage,
  type RelayAiVaultServiceChildMessage,
  type RelayAiVaultServiceInit,
  type RelayAiVaultServiceRequest
} from './ai-vault-service-protocol'
import { relayLogLine } from './relay-diagnostic-log'

const FAULT_WINDOW_MS = 60_000
const RESTART_DELAYS_MS = [250, 1_000, 5_000] as const

export class RelayAiVaultServiceClient implements RelayAiVaultServiceApi {
  private child: ChildProcess | null = null
  private ready: Promise<ChildProcess> | null = null
  private readyReject: ((error: Error) => void) | null = null
  private active: RelayAiVaultServiceCall | null = null
  private readonly queue: RelayAiVaultServiceCall[] = []
  private nextId = 1
  private faults: number[] = []
  private circuitUntil = 0
  private restartTimer: NodeJS.Timeout | null = null
  private disposed = false

  constructor(private readonly options: RelayAiVaultServiceClientOptions) {}

  listSessions(
    params: SshAiVaultRelayListParams,
    signal?: AbortSignal
  ): Promise<AiVaultListResult> {
    return this.request({ type: 'request', id: this.nextId++, operation: 'list', params }, signal)
  }

  resolveSessionTitles(
    requests: AiVaultSessionTitleRequest[],
    signal?: AbortSignal
  ): Promise<AiVaultSessionTitlesResult> {
    return this.request(
      { type: 'request', id: this.nextId++, operation: 'titles', requests },
      signal
    )
  }

  async dispose(): Promise<void> {
    this.disposed = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const error = new Error('Relay AI Vault service was disposed.')
    if (this.active) {
      this.settle(this.active, error)
      this.active = null
    }
    for (const call of this.queue.splice(0)) {
      this.settle(call, error)
    }
    const child = this.detachChild()
    if (!child) {
      return
    }
    child.send({ type: 'shutdown' }, () => undefined)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill()
        resolve()
      }, 2_000)
      timer.unref?.()
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  private request<T extends AiVaultListResult | AiVaultSessionTitlesResult>(
    request: RelayAiVaultServiceRequest,
    signal?: AbortSignal
  ): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error('Relay AI Vault service was disposed.'))
    }
    if (signal?.aborted) {
      return Promise.reject(relayAiVaultAbortError())
    }
    if (this.queue.length + (this.active ? 1 : 0) >= RELAY_AI_VAULT_MAX_CALLS) {
      return Promise.reject(new Error('Relay AI Vault service queue is full.'))
    }
    return new Promise<T>((resolve, reject) => {
      const call: RelayAiVaultServiceCall = {
        request,
        signal,
        forceStart: request.operation === 'list' && request.params.force === true,
        resolve: resolve as RelayAiVaultServiceCall['resolve'],
        reject,
        timer: null,
        onAbort: null,
        settled: false
      }
      if (signal) {
        call.onAbort = () => this.cancel(call)
        signal.addEventListener('abort', call.onAbort, { once: true })
      }
      this.queue.push(call)
      this.pump()
    })
  }

  private pump(): void {
    if (this.active || this.disposed || this.restartTimer) {
      return
    }
    const call = this.queue.shift()
    if (!call) {
      return
    }
    this.active = call
    void this.ensureChild(call.forceStart).then(
      (child) => this.sendCall(child, call),
      (error: Error) => {
        this.active = null
        this.settle(call, error)
        this.pump()
      }
    )
  }

  private sendCall(child: ChildProcess, call: RelayAiVaultServiceCall): void {
    if (this.active !== call || call.settled) {
      return
    }
    const timeout =
      call.request.operation === 'list'
        ? RELAY_AI_VAULT_SCAN_TIMEOUT_MS
        : RELAY_AI_VAULT_TITLE_TIMEOUT_MS
    call.timer = setTimeout(
      () => this.onFault(new Error(`Relay AI Vault service timed out after ${timeout}ms.`)),
      timeout
    )
    call.timer.unref?.()
    child.send(call.request)
  }

  private ensureChild(forceStart: boolean): Promise<ChildProcess> {
    if (this.child && !this.ready) {
      return Promise.resolve(this.child)
    }
    if (this.ready) {
      return this.ready
    }
    const now = (this.options.now ?? Date.now)()
    if (now < this.circuitUntil && !forceStart) {
      return Promise.reject(new Error('Relay AI Vault service restart circuit is open.'))
    }
    if (forceStart) {
      this.circuitUntil = 0
    }
    let child: ChildProcess
    try {
      child = this.options.processFactory()
    } catch (error) {
      return Promise.reject(relayAiVaultError(error))
    }
    this.child = child
    this.ready = new Promise<ChildProcess>((resolve, reject) => {
      this.readyReject = reject
      const timer = setTimeout(
        () => this.onFault(new Error('Relay AI Vault service did not become ready.')),
        RELAY_AI_VAULT_READY_TIMEOUT_MS
      )
      timer.unref?.()
      child.on('message', (message) => {
        if (isRelayAiVaultServiceChildMessage(message) && message.type === 'ready') {
          clearTimeout(timer)
          this.ready = null
          this.readyReject = null
          resolve(child)
          return
        }
        this.onMessage(message)
      })
    })
    child.on('error', (error) => this.onFault(error))
    child.on('disconnect', () => this.onFault(new Error('Relay AI Vault service disconnected.')))
    child.on('exit', (code) => this.onFault(new Error(`Relay AI Vault service exited (${code}).`)))
    child.stderr?.on('data', (chunk: Buffer) =>
      relayLogLine(`[relay-ai-vault-service] ${String(chunk).trimEnd()}`)
    )
    child.send({
      type: 'init',
      protocol: RELAY_AI_VAULT_SERVICE_PROTOCOL,
      ...this.options.init
    } satisfies RelayAiVaultServiceInit)
    return this.ready
  }

  private onMessage(raw: unknown): void {
    if (!isRelayAiVaultServiceChildMessage(raw)) {
      this.onFault(new Error('Relay AI Vault service sent a malformed message.'))
      return
    }
    const message = raw as RelayAiVaultServiceChildMessage
    if (message.type === 'ready') {
      return
    }
    const call = this.active
    if (!call || call.request.id !== message.id) {
      return
    }
    this.active = null
    this.settle(call, message.type === 'error' ? new Error(message.message) : message.value)
    this.pump()
  }

  private cancel(call: RelayAiVaultServiceCall): void {
    const index = this.queue.indexOf(call)
    if (index >= 0) {
      this.queue.splice(index, 1)
      this.settle(call, relayAiVaultAbortError())
      this.pump()
      return
    }
    if (this.active === call) {
      this.child?.send({ type: 'cancel', id: call.request.id })
      this.settle(call, relayAiVaultAbortError())
      armRelayAiVaultCancellationTimeout(call, () =>
        this.onFault(new Error('Relay AI Vault service did not cancel within 2000ms.'))
      )
    }
  }

  private onFault(error: Error): void {
    if (!this.child) {
      return
    }
    this.detachChild()?.kill()
    this.readyReject?.(error)
    this.readyReject = null
    this.ready = null
    if (this.active) {
      this.settle(this.active, error)
      this.active = null
    }
    const now = (this.options.now ?? Date.now)()
    this.faults = [...this.faults.filter((time) => now - time < FAULT_WINDOW_MS), now]
    if (this.faults.length >= 3) {
      this.circuitUntil = now + FAULT_WINDOW_MS
    }
    if (this.queue.length > 0 && !this.disposed) {
      const delay = RESTART_DELAYS_MS[Math.min(this.faults.length - 1, 2)]
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null
        this.pump()
      }, delay)
      this.restartTimer.unref?.()
    }
  }

  private settle(
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

  private detachChild(): ChildProcess | null {
    const child = this.child
    this.child = null
    child?.removeAllListeners()
    return child
  }
}
