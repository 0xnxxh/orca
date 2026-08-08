import { randomUUID } from 'node:crypto'
import {
  connectTerminalAuthorityAppOutcomeNamespace,
  createTerminalAuthorityAppAdmissionAttempt,
  type TerminalAuthorityAppAdmissionAttempt
} from './terminal-authority-app-outcome-namespace-connection'
import {
  TerminalAuthorityAppAdmissionRejectedError,
  reportTerminalAuthorityAppOutcomeError,
  resolveTerminalAuthorityAppOutcomeTiming,
  terminalAuthorityAppReconnectDelay,
  type TerminalAuthorityAppOutcomeNamespaceBinding,
  type TerminalAuthorityAppOutcomeNamespaceSessionOptions,
  type TerminalAuthorityAppOutcomeTiming
} from './terminal-authority-app-outcome-host-contract'
import {
  cancelTerminalAuthorityAppNamespaceGeneration,
  createTerminalAuthorityAppNamespaceGeneration,
  requireTerminalAuthorityAppNamespaceGeneration,
  type TerminalAuthorityAppNamespaceGeneration
} from './terminal-authority-app-outcome-namespace-state'
import {
  publishTerminalAuthorityAppOutcome,
  publishTerminalAuthorityAppOutcomeBoundary
} from './terminal-authority-app-outcome-namespace-publication'

export class TerminalAuthorityAppOutcomeNamespaceSession {
  private readonly timing: TerminalAuthorityAppOutcomeTiming
  private state: TerminalAuthorityAppNamespaceGeneration | null = null
  private nextGeneration = 0
  private reconnectTask: Promise<void> | null = null
  private admission: TerminalAuthorityAppAdmissionAttempt | null = null
  private active = false
  private ready = false
  private retiring = false

  constructor(private readonly options: TerminalAuthorityAppOutcomeNamespaceSessionOptions) {
    this.timing = resolveTerminalAuthorityAppOutcomeTiming(options)
  }

  async start(): Promise<void> {
    if (this.active) {
      throw new Error('terminal authority app outcome namespace is already started')
    }
    this.active = true
    this.replaceGeneration()
    try {
      await this.reconnectUntilConnected(true)
      const state = requireTerminalAuthorityAppNamespaceGeneration(this.state)
      this.markReady(state)
      this.ready = true
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  reconnectHost(): Promise<void> {
    if (!this.active) {
      return Promise.reject(new Error('terminal authority app outcome namespace is unavailable'))
    }
    if (this.retiring) {
      this.dispose()
      return Promise.reject(new Error('terminal authority app outcome namespace is retiring'))
    }
    this.replaceGeneration()
    if (this.ready) {
      this.ensureReconnectLoop()
    }
    return this.waitUntilReady()
  }

  async waitUntilReady(): Promise<void> {
    while (this.active) {
      const state = requireTerminalAuthorityAppNamespaceGeneration(this.state)
      if (state.connection) {
        return
      }
      const settled = await state.ready
      if (this.state !== state) {
        continue
      }
      if (settled && state.connection) {
        return
      }
    }
    throw new Error('terminal authority app outcome namespace is unavailable')
  }

  async captureBinding(): Promise<TerminalAuthorityAppOutcomeNamespaceBinding> {
    await this.waitUntilReady()
    const state = requireTerminalAuthorityAppNamespaceGeneration(this.state)
    const connection = state.connection
    if (!connection) {
      throw new Error('terminal authority app outcome namespace is unavailable')
    }
    this.assertCurrent(state)
    return Object.freeze({
      assertCurrent: () => {
        this.assertCurrent(state)
        if (state.connection !== connection) {
          throw new Error('terminal authority app outcome namespace grant is stale')
        }
      }
    })
  }

  dispose(): void {
    if (!this.active) {
      return
    }
    this.active = false
    this.ready = false
    this.admission = null
    this.cancelCurrentGeneration()
  }

  beginRetirement(): void {
    if (!this.active || !this.ready) {
      throw new Error('terminal authority app outcome namespace is not ready for retirement')
    }
    this.retiring = true
  }

  private async connect(state: TerminalAuthorityAppNamespaceGeneration): Promise<void> {
    const host = await this.options.hostConnection()
    this.assertCurrent(state)
    const createId = this.options.createAdmissionId ?? randomUUID
    if (!this.admission || this.admission.host !== host) {
      this.admission = createTerminalAuthorityAppAdmissionAttempt(
        host,
        this.options.processIncarnationId,
        this.options.namespace,
        createId
      )
    }
    try {
      await connectTerminalAuthorityAppOutcomeNamespace({
        admission: this.admission,
        state,
        timeoutMs: this.timing.connectTimeoutMs,
        transport: Object.freeze({
          publishBoundary: (boundary) => this.publishBoundary(state, boundary),
          publishOutcome: (publication) => this.publishOutcome(state, publication),
          onFailure: (error) => this.handleGenerationFailure(state, error)
        }),
        isCurrent: () => this.isCurrent(state),
        createId
      })
      this.admission = null
    } catch (error) {
      if (error instanceof TerminalAuthorityAppAdmissionRejectedError) {
        this.admission = null
        state.admissionFailure = error
      }
      throw error
    }
  }

  private publishBoundary(
    state: TerminalAuthorityAppNamespaceGeneration,
    unsafeBoundary: Parameters<typeof publishTerminalAuthorityAppOutcomeBoundary>[1]
  ): Promise<void> {
    return publishTerminalAuthorityAppOutcomeBoundary(
      this.publicationContext(state),
      unsafeBoundary
    )
  }

  private publishOutcome(
    state: TerminalAuthorityAppNamespaceGeneration,
    unsafePublication: Parameters<typeof publishTerminalAuthorityAppOutcome>[1]
  ): Promise<void> {
    return publishTerminalAuthorityAppOutcome(this.publicationContext(state), unsafePublication)
  }

  private publicationContext(state: TerminalAuthorityAppNamespaceGeneration) {
    return {
      state,
      options: this.options,
      timing: this.timing,
      assertCurrent: (current: TerminalAuthorityAppNamespaceGeneration) =>
        this.assertCurrent(current),
      isCurrent: (current: TerminalAuthorityAppNamespaceGeneration) => this.isCurrent(current),
      handleGenerationFailure: (current: TerminalAuthorityAppNamespaceGeneration, error: unknown) =>
        this.handleGenerationFailure(current, error)
    }
  }

  private handleGenerationFailure(
    state: TerminalAuthorityAppNamespaceGeneration,
    error: unknown
  ): void {
    if (!this.isCurrent(state)) {
      return
    }
    reportTerminalAuthorityAppOutcomeError(this.options, error)
    if (this.retiring) {
      this.dispose()
      return
    }
    if (!this.ready) {
      this.replaceGeneration()
      return
    }
    this.replaceGeneration()
    this.ensureReconnectLoop()
  }

  private ensureReconnectLoop(): Promise<void> {
    if (this.reconnectTask) {
      return this.reconnectTask
    }
    const task = this.reconnectUntilConnected(false)
    this.reconnectTask = task
    void task.finally(() => {
      if (this.reconnectTask !== task) {
        return
      }
      this.reconnectTask = null
      if (this.active && this.ready && !this.retiring && !this.state?.connection) {
        this.ensureReconnectLoop()
      }
    })
    return task
  }

  private async reconnectUntilConnected(initial: boolean): Promise<void> {
    let attempt = 0
    while (this.active && !this.retiring && (initial || this.ready)) {
      const state = requireTerminalAuthorityAppNamespaceGeneration(this.state)
      try {
        await this.connect(state)
        this.markReady(state)
        return
      } catch (error) {
        if (initial && state.admissionFailure) {
          throw state.admissionFailure
        }
        if (!this.active || (!initial && !this.ready)) {
          if (initial) {
            throw error
          }
          return
        }
        if (!this.isCurrent(state)) {
          const current = this.state
          if (!current) {
            return
          }
          const delay = terminalAuthorityAppReconnectDelay(this.timing, attempt)
          attempt += 1
          await current.work.waitBeforeReconnect(delay)
          continue
        }
        reportTerminalAuthorityAppOutcomeError(this.options, error)
        const waiting = this.replaceGeneration()
        const delay = terminalAuthorityAppReconnectDelay(this.timing, attempt)
        attempt += 1
        await waiting.work.waitBeforeReconnect(delay)
      }
    }
  }

  private replaceGeneration(): TerminalAuthorityAppNamespaceGeneration {
    this.cancelCurrentGeneration()
    const state = createTerminalAuthorityAppNamespaceGeneration(++this.nextGeneration)
    this.state = state
    return state
  }

  private markReady(state: TerminalAuthorityAppNamespaceGeneration): void {
    if (this.state === state) {
      state.resolveReady(true)
    }
  }

  private cancelCurrentGeneration(): void {
    const state = this.state
    this.state = null
    cancelTerminalAuthorityAppNamespaceGeneration(state)
  }

  private assertCurrent(state: TerminalAuthorityAppNamespaceGeneration): void {
    if (!this.isCurrent(state)) {
      throw new Error('terminal authority app outcome callback is stale')
    }
  }

  private isCurrent(state: TerminalAuthorityAppNamespaceGeneration): boolean {
    return this.active && this.state?.work.id === state.work.id
  }
}
