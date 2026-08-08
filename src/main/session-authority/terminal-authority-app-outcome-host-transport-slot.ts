import { assertAuthorityId } from '../../shared/terminal-session-authority-identity'
import type {
  TerminalAuthorityAppOutcomeHostConnection,
  TerminalAuthorityAppOutcomeHostTransport
} from './terminal-authority-app-outcome-host-contract'

type Delegate = {
  transport: TerminalAuthorityAppOutcomeHostTransport
  connectionGeneration: number
}

type Attempt = {
  delegate: Delegate
  connection: TerminalAuthorityAppOutcomeHostConnection | null
  rejectReplacement: (error: Error) => void
  notifyFailure: (error: unknown) => void
  active: boolean
}

export type TerminalAuthorityAppOutcomeHostTransportLease = Readonly<{
  isActive(): boolean
  isCurrent(): boolean
  withCurrent<T>(operation: (binding: SourceBinding) => Promise<T>): Promise<T>
  dispose(): void
}>

export type SourceBinding = Readonly<{
  assertCurrent(): void
  bindConnectionGeneration(): void
}>

type SourceOperation = {
  delegate: Delegate
  run: (binding: SourceBinding) => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

export class TerminalAuthorityAppOutcomeHostTransportSlot implements TerminalAuthorityAppOutcomeHostTransport {
  readonly authenticatedAuthorityHostId: string
  private readonly attempts = new Set<Attempt>()
  private readonly delegates = new Set<Delegate>()
  private readonly operations: SourceOperation[] = []
  private delegate: Delegate | null = null
  private delegateGeneration = 0
  private activeOperations = 0

  constructor(authorityHostId: string) {
    assertAuthorityId(authorityHostId, 'authenticatedAuthorityHostId')
    this.authenticatedAuthorityHostId = authorityHostId
  }

  install(
    transport: TerminalAuthorityAppOutcomeHostTransport
  ): TerminalAuthorityAppOutcomeHostTransportLease {
    if (transport.authenticatedAuthorityHostId !== this.authenticatedAuthorityHostId) {
      throw new Error('terminal authority app outcome host identity changed')
    }
    const delegate: Delegate = { transport, connectionGeneration: 0 }
    this.delegates.add(delegate)
    if (!this.delegate && this.activeOperations === 0) {
      this.activate(delegate)
    }
    return Object.freeze({
      isActive: () => this.delegates.has(delegate),
      isCurrent: () => this.delegate === delegate,
      withCurrent: <T>(operation: (binding: SourceBinding) => Promise<T>) =>
        this.withDelegate(delegate, operation),
      dispose: () => {
        if (!this.delegates.delete(delegate)) {
          return
        }
        if (this.delegate === delegate) {
          this.delegate = null
          this.delegateGeneration += 1
        }
        this.invalidate(
          delegate,
          new Error('terminal authority app outcome host transport disconnected')
        )
        this.drainOperations()
      }
    })
  }

  async connect(
    transport: Readonly<{ onFailure(error: unknown): void }>
  ): Promise<TerminalAuthorityAppOutcomeHostConnection> {
    const delegate = this.delegate
    if (!delegate) {
      throw new Error('terminal authority app outcome host transport is unavailable')
    }
    let rejectReplacement!: (error: Error) => void
    const replacement = new Promise<never>((_resolve, reject) => {
      rejectReplacement = reject
    })
    const attempt: Attempt = {
      delegate,
      connection: null,
      rejectReplacement,
      notifyFailure: transport.onFailure,
      active: true
    }
    this.attempts.add(attempt)
    const pending = delegate.transport.connect({
      onFailure: (error) => this.failAttempt(attempt, error)
    })
    void pending.then(
      (connection) => {
        if (!attempt.active) {
          connection.disconnect()
        }
      },
      () => undefined
    )
    try {
      const connection = await Promise.race([pending, replacement])
      if (!attempt.active || this.delegate !== delegate || !this.delegates.has(delegate)) {
        connection.disconnect()
        throw new Error('terminal authority app outcome host transport was replaced')
      }
      if (connection.authenticatedAuthorityHostId !== this.authenticatedAuthorityHostId) {
        connection.disconnect()
        throw new Error('terminal authority app outcome host identity changed')
      }
      attempt.connection = connection
      return this.wrapConnection(attempt, connection)
    } catch (error) {
      this.releaseAttempt(attempt)
      throw error
    }
  }

  /** Tears down every installed source when the app replaces its proof identity. */
  dispose(): void {
    for (const delegate of [...this.delegates]) {
      this.delegates.delete(delegate)
      if (this.delegate === delegate) {
        this.delegate = null
        this.delegateGeneration += 1
      }
      this.invalidate(
        delegate,
        new Error('terminal authority app outcome host transport was retired')
      )
    }
    while (this.operations.length > 0) {
      this.operations.shift()!.reject(new Error('terminal authority app outcome host transport was retired'))
    }
  }

  private wrapConnection(
    attempt: Attempt,
    connection: TerminalAuthorityAppOutcomeHostConnection
  ): TerminalAuthorityAppOutcomeHostConnection {
    return Object.freeze({
      authenticatedAuthorityHostId: this.authenticatedAuthorityHostId,
      resolveNamespace: (worktreeId) => connection.resolveNamespace(worktreeId),
      openNamespace: (request, transport, onOpening) =>
        connection.openNamespace(request, transport, onOpening),
      retireNamespace: (request) => connection.retireNamespace(request),
      disconnect: () => {
        this.releaseAttempt(attempt)
        connection.disconnect()
      }
    })
  }

  private invalidate(delegate: Delegate, error: Error): void {
    for (const attempt of this.attempts) {
      if (attempt.delegate === delegate) {
        this.failAttempt(attempt, error)
      }
    }
  }

  private failAttempt(attempt: Attempt, error: unknown): void {
    if (!attempt.active) {
      return
    }
    attempt.active = false
    this.attempts.delete(attempt)
    attempt.delegate.connectionGeneration += 1
    attempt.connection?.disconnect()
    const normalized = error instanceof Error ? error : new Error(String(error))
    attempt.rejectReplacement(normalized)
    attempt.notifyFailure(normalized)
  }

  private releaseAttempt(attempt: Attempt): void {
    if (!attempt.active) {
      return
    }
    attempt.active = false
    this.attempts.delete(attempt)
  }

  private withDelegate<T>(
    delegate: Delegate,
    operation: (binding: SourceBinding) => Promise<T>
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.operations.push({
        delegate,
        run: operation,
        resolve: (value) => resolve(value as T),
        reject
      })
      this.drainOperations()
    })
  }

  private drainOperations(): void {
    while (this.operations[0] && !this.delegates.has(this.operations[0].delegate)) {
      this.operations
        .shift()!
        .reject(new Error('terminal authority app outcome host installation is stale'))
    }
    const next = this.operations[0]
    if (!next) {
      return
    }
    if (this.activeOperations > 0 && this.delegate !== next.delegate) {
      return
    }
    if (this.activeOperations === 0 && this.delegate !== next.delegate) {
      this.activate(next.delegate)
    }
    while (this.operations[0]?.delegate === this.delegate) {
      this.startOperation(this.operations.shift()!)
    }
  }

  private startOperation(operation: SourceOperation): void {
    const delegate = operation.delegate
    const delegateGeneration = this.delegateGeneration
    let connectionGeneration = delegate.connectionGeneration
    const binding: SourceBinding = Object.freeze({
      assertCurrent: () => {
        if (
          !this.delegates.has(delegate) ||
          this.delegate !== delegate ||
          this.delegateGeneration !== delegateGeneration ||
          delegate.connectionGeneration !== connectionGeneration
        ) {
          throw new Error('terminal authority app outcome source generation is stale')
        }
      },
      bindConnectionGeneration: () => {
        if (
          !this.delegates.has(delegate) ||
          this.delegate !== delegate ||
          this.delegateGeneration !== delegateGeneration
        ) {
          throw new Error('terminal authority app outcome source generation is stale')
        }
        connectionGeneration = delegate.connectionGeneration
      }
    })
    this.activeOperations += 1
    void (async () => {
      try {
        binding.assertCurrent()
        const result = await operation.run(binding)
        binding.assertCurrent()
        operation.resolve(result)
      } catch (error) {
        operation.reject(error)
      } finally {
        this.activeOperations -= 1
        this.drainOperations()
      }
    })()
  }

  private activate(delegate: Delegate): void {
    if (!this.delegates.has(delegate)) {
      throw new Error('terminal authority app outcome host installation is stale')
    }
    const previous = this.delegate
    if (previous === delegate) {
      return
    }
    this.delegate = delegate
    this.delegateGeneration += 1
    if (previous) {
      this.invalidate(
        previous,
        new Error('terminal authority app outcome host transport was replaced')
      )
    }
  }
}
