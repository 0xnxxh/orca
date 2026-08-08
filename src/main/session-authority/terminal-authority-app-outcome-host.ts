import { isDeepStrictEqual } from 'node:util'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type { TerminalAuthorityConsumerRetirementResult } from '../../shared/terminal-session-authority-consumer-retirement'
import { TerminalAuthorityAppOutcomeConnectionGeneration } from './terminal-authority-app-outcome-connection-generation'
import {
  reportTerminalAuthorityAppOutcomeError,
  resolveTerminalAuthorityAppOutcomeTiming,
  type TerminalAuthorityAppConsumerRetirementRequest,
  type TerminalAuthorityAppOutcomeHostConnection,
  type TerminalAuthorityAppOutcomeHostTransport,
  type TerminalAuthorityAppOutcomeManagerOptions,
  type TerminalAuthorityAppOutcomeNamespaceBinding,
  type TerminalAuthorityAppResolvedNamespaceBinding
} from './terminal-authority-app-outcome-host-contract'
import { TerminalAuthorityAppOutcomeNamespaceSession } from './terminal-authority-app-outcome-namespace-session'
import { terminalAuthorityAppOutcomeNamespaceKey } from './terminal-authority-app-outcome-namespace-state'

const MAX_APP_AUTHORITY_NAMESPACES_PER_HOST = 4_096

type HostGeneration = {
  work: TerminalAuthorityAppOutcomeConnectionGeneration
  connection: TerminalAuthorityAppOutcomeHostConnection | null
  connecting: Promise<TerminalAuthorityAppOutcomeHostConnection> | null
}

type NamespaceEntry = {
  namespace: TerminalAuthorityNamespace
  session: TerminalAuthorityAppOutcomeNamespaceSession
  ready: Promise<void>
}

type RetirementEntry = {
  request: TerminalAuthorityAppConsumerRetirementRequest
  completion: Promise<TerminalAuthorityConsumerRetirementResult> | null
}

export class TerminalAuthorityAppOutcomeHost {
  private readonly timing
  private readonly namespaces = new Map<string, NamespaceEntry>()
  private readonly knownNamespaces = new Set<string>()
  private readonly retirements = new Map<string, RetirementEntry>()
  private state: HostGeneration
  private nextGeneration = 0
  private active = true

  constructor(
    private readonly hostId: string,
    private readonly transport: TerminalAuthorityAppOutcomeHostTransport,
    private readonly processIncarnationId: string,
    private readonly options: TerminalAuthorityAppOutcomeManagerOptions,
    private readonly isInstalled: () => boolean
  ) {
    this.timing = resolveTerminalAuthorityAppOutcomeTiming(options)
    this.state = this.createGeneration()
  }

  get namespaceCount(): number {
    return this.namespaces.size
  }

  knownNamespaceIds(): readonly string[] {
    return [...this.knownNamespaces]
  }

  async admitNamespace(namespace: TerminalAuthorityNamespace): Promise<void> {
    await this.bindNamespace(namespace)
  }

  async bindNamespace(
    namespace: TerminalAuthorityNamespace
  ): Promise<TerminalAuthorityAppOutcomeNamespaceBinding> {
    return this.captureNamespaceBinding(this.ensureNamespace(namespace))
  }

  private async captureNamespaceBinding(
    entry: NamespaceEntry
  ): Promise<TerminalAuthorityAppOutcomeNamespaceBinding> {
    await entry.ready
    this.assertActive()
    return await entry.session.captureBinding()
  }

  async resolveAndAdmitNamespace(worktreeId: string): Promise<TerminalAuthorityNamespace> {
    return (await this.resolveAndBindNamespace(worktreeId)).namespace
  }

  async resolveAndBindNamespace(
    worktreeId: string
  ): Promise<TerminalAuthorityAppResolvedNamespaceBinding> {
    this.assertActive()
    if (typeof worktreeId !== 'string' || worktreeId.length === 0) {
      throw new Error('terminal authority app outcome worktree identity is invalid')
    }
    const namespace = await (await this.connection()).resolveNamespace(worktreeId)
    this.assertNamespaceHost(namespace)
    const binding = await this.bindNamespace(namespace)
    return Object.freeze({ namespace, binding })
  }

  async retireNamespace(
    request: TerminalAuthorityAppConsumerRetirementRequest
  ): Promise<TerminalAuthorityConsumerRetirementResult> {
    this.assertActive()
    this.assertNamespaceHost(request.namespace)
    const key = terminalAuthorityAppOutcomeNamespaceKey(request.namespace)
    const pending = this.retirements.get(key)
    if (pending) {
      if (!isDeepStrictEqual(pending.request, request)) {
        throw new Error('terminal authority app outcome namespace retirement request changed')
      }
      return await this.completeRetirement(key, pending)
    }
    const existing = this.namespaces.get(key)
    if (existing) {
      await existing.session.waitUntilReady()
      this.assertActive()
      existing.session.beginRetirement()
    }
    const entry: RetirementEntry = {
      request: Object.freeze({ ...request, namespace: Object.freeze({ ...request.namespace }) }),
      completion: null
    }
    this.retirements.set(key, entry)
    return await this.completeRetirement(key, entry)
  }

  dispose(): void {
    if (!this.active) {
      return
    }
    this.active = false
    for (const entry of this.namespaces.values()) {
      entry.session.dispose()
    }
    this.namespaces.clear()
    this.knownNamespaces.clear()
    this.retirements.clear()
    this.cancelGeneration(this.state)
  }

  private ensureNamespace(namespace: TerminalAuthorityNamespace): NamespaceEntry {
    this.assertActive()
    this.assertNamespaceHost(namespace)
    const key = terminalAuthorityAppOutcomeNamespaceKey(namespace)
    if (this.retirements.has(key)) {
      throw new Error('terminal authority app outcome namespace retirement is pending')
    }
    const existing = this.namespaces.get(key)
    if (existing) {
      return existing
    }
    if (this.namespaces.size >= MAX_APP_AUTHORITY_NAMESPACES_PER_HOST) {
      throw new Error('terminal authority app outcome namespace capacity exceeded')
    }
    const session = new TerminalAuthorityAppOutcomeNamespaceSession({
      ...this.options,
      processIncarnationId: this.processIncarnationId,
      namespace: Object.freeze({ ...namespace }),
      hostConnection: () => this.connection()
    })
    const entry: NamespaceEntry = {
      namespace: Object.freeze({ ...namespace }),
      session,
      ready: session.start()
    }
    this.knownNamespaces.add(namespace.namespaceId)
    this.namespaces.set(key, entry)
    void entry.ready.catch(() => {
      if (this.namespaces.get(key) === entry) {
        this.namespaces.delete(key)
        session.dispose()
      }
    })
    return entry
  }

  private connection(): Promise<TerminalAuthorityAppOutcomeHostConnection> {
    this.assertActive()
    const state = this.state
    if (state.connection) {
      return Promise.resolve(state.connection)
    }
    state.connecting ??= this.connect(state)
    return state.connecting
  }

  private async connect(state: HostGeneration): Promise<TerminalAuthorityAppOutcomeHostConnection> {
    try {
      const pending = this.transport.connect({
        onFailure: (error) => this.failHost(state, error)
      })
      void pending.then(
        (connection) => {
          if (!this.isCurrent(state)) {
            connection.disconnect()
          }
        },
        () => undefined
      )
      const connection = await state.work.settle(
        pending,
        this.timing.connectTimeoutMs,
        'host connection'
      )
      this.assertCurrent(state)
      if (connection.authenticatedAuthorityHostId !== this.hostId) {
        connection.disconnect()
        throw new Error('terminal authority app outcome host identity changed')
      }
      state.connection = connection
      return connection
    } catch (error) {
      this.failHost(state, error)
      throw error
    }
  }

  private failHost(state: HostGeneration, error: unknown): void {
    if (!this.isCurrent(state)) {
      return
    }
    reportTerminalAuthorityAppOutcomeError(this.options, error)
    this.state = this.createGeneration()
    this.cancelGeneration(state)
    for (const [key, entry] of this.namespaces) {
      if (this.retirements.has(key)) {
        entry.session.dispose()
      } else {
        entry.ready = entry.session.reconnectHost()
        void entry.ready.catch(() => undefined)
      }
    }
  }

  private completeRetirement(
    key: string,
    entry: RetirementEntry
  ): Promise<TerminalAuthorityConsumerRetirementResult> {
    if (entry.completion) {
      return entry.completion
    }
    const completion = this.sendRetirement(key, entry)
    entry.completion = completion
    void completion
      .finally(() => {
        if (this.retirements.get(key) === entry && entry.completion === completion) {
          entry.completion = null
        }
      })
      .catch(() => undefined)
    return completion
  }

  private async sendRetirement(
    key: string,
    entry: RetirementEntry
  ): Promise<TerminalAuthorityConsumerRetirementResult> {
    const result = await (await this.connection()).retireNamespace(entry.request)
    if (this.retirements.get(key) === entry) {
      this.retirements.delete(key)
      const namespace = this.namespaces.get(key)
      this.namespaces.delete(key)
      namespace?.session.dispose()
    }
    return result
  }

  private createGeneration(): HostGeneration {
    return {
      work: new TerminalAuthorityAppOutcomeConnectionGeneration(++this.nextGeneration),
      connection: null,
      connecting: null
    }
  }

  private cancelGeneration(state: HostGeneration): void {
    state.work.cancel()
    state.connection?.disconnect()
    state.connection = null
    state.connecting = null
  }

  private assertActive(): void {
    if (!this.active || !this.isInstalled()) {
      throw new Error('terminal authority app outcome host is stale')
    }
  }

  private assertCurrent(state: HostGeneration): void {
    if (!this.isCurrent(state)) {
      throw new Error('terminal authority app outcome host generation is stale')
    }
  }

  private isCurrent(state: HostGeneration): boolean {
    return this.active && this.isInstalled() && this.state.work.id === state.work.id
  }

  private assertNamespaceHost(namespace: TerminalAuthorityNamespace): void {
    if (namespace.authorityHostId !== this.hostId) {
      throw new Error('terminal authority app outcome namespace targets another host')
    }
  }
}
