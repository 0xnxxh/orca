import type {
  RelayWatcherTeardownState,
  RelayWatcherTeardownTracker
} from './relay-watcher-teardown-tracker'
import type { RelayDispatcher } from './dispatcher'
import { emitRelayWatcherTerminalFailure } from './relay-watcher-terminal-notifier'
import { normalizeRuntimePathForComparison } from '../shared/cross-platform-path'
import type { RelayWatcherPendingSetup } from './relay-watcher-setup-tracking'

export const MAX_RELAY_WORKTREE_REMOVAL_LEASES = 64

type ConnectionLease = Readonly<{
  clientId: number
  leaseToken: string
  readiness: Promise<void>
  rootKey: string
}>

type OperationWaiter = Readonly<{
  isCurrent: () => boolean
  resolve: () => void
}>

export type RelayWorktreeRemovalPeerAcquire = (rootPath: string) => Promise<() => Promise<void>>

function isNormalizedPathInsideOrEqual(rootKey: string, candidateKey: string): boolean {
  if (candidateKey === rootKey) {
    return true
  }
  const boundary = rootKey === '/' || /^[a-z]:\/$/.test(rootKey) ? rootKey : `${rootKey}/`
  return candidateKey.startsWith(boundary)
}

export class RelayWorktreeRemovalFence {
  private readonly roots = new Set<string>()
  private readonly operations = new Map<string, number>()
  private readonly operationWaiters = new Map<string, Set<OperationWaiter>>()
  private readonly connectionLeases = new Map<string, ConnectionLease>()
  private beforeRemove: ((rootPath: string) => Promise<void>) | null = null
  private acquirePeer: RelayWorktreeRemovalPeerAcquire | null = null
  private readonly removeClientDetachListener: () => void
  private readonly removeDispatcherDisposeListener: () => void

  constructor(
    private readonly watches: Map<string, RelayWatcherTeardownState>,
    private readonly pendingSetups: Map<string, RelayWatcherPendingSetup>,
    private readonly teardownTracker: RelayWatcherTeardownTracker,
    private readonly dispatcher: RelayDispatcher
  ) {
    this.removeClientDetachListener =
      this.dispatcher.onClientDetached?.((clientId) => this.releaseClientLeases(clientId)) ??
      (() => {})
    this.removeDispatcherDisposeListener =
      this.dispatcher.onDisposed?.(() => this.releaseAllConnectionLeases()) ?? (() => {})
  }

  isActive(rootPath: string): boolean {
    const rootKey = normalizeRuntimePathForComparison(rootPath)
    return [...this.roots].some((activeRoot) => isNormalizedPathInsideOrEqual(activeRoot, rootKey))
  }

  setBeforeRemove(beforeRemove: (rootPath: string) => Promise<void>): void {
    this.beforeRemove = beforeRemove
  }

  setPeerAcquire(acquirePeer: RelayWorktreeRemovalPeerAcquire | null): void {
    this.acquirePeer = acquirePeer
  }

  beginOperation(operationPath: string): () => void {
    const operationKey = normalizeRuntimePathForComparison(operationPath)
    if ([...this.roots].some((rootKey) => isNormalizedPathInsideOrEqual(rootKey, operationKey))) {
      throw new Error('Remote worktree deletion already in progress')
    }
    this.operations.set(operationKey, (this.operations.get(operationKey) ?? 0) + 1)
    let finished = false
    return () => {
      if (finished) {
        return
      }
      finished = true
      const remaining = (this.operations.get(operationKey) ?? 1) - 1
      if (remaining > 0) {
        this.operations.set(operationKey, remaining)
      } else {
        this.operations.delete(operationKey)
      }
      this.resolveOperationWaiters()
    }
  }

  async run<T>(rootPath: string, operation: () => Promise<T>): Promise<T> {
    const rootKey = normalizeRuntimePathForComparison(rootPath)
    this.acquireRoot(rootKey)
    let releasePeer: (() => Promise<void>) | null = null
    let outcome: { ok: true; value: T } | { ok: false; error: unknown }
    try {
      await this.prepareRoot(rootKey, rootPath)
      releasePeer = (await this.acquirePeer?.(rootPath)) ?? null
      outcome = { ok: true, value: await operation() }
    } catch (error) {
      outcome = { ok: false, error }
    }
    let releaseOutcome: { ok: true } | { ok: false; error: unknown } = { ok: true }
    try {
      await releasePeer?.()
    } catch (error) {
      releaseOutcome = { ok: false, error }
    }
    this.roots.delete(rootKey)
    if (!releaseOutcome.ok) {
      if (!outcome.ok) {
        throw new AggregateError(
          [outcome.error, releaseOutcome.error],
          'Worktree removal and authority fence release both failed'
        )
      }
      throw releaseOutcome.error
    }
    if (!outcome.ok) {
      throw outcome.error
    }
    return outcome.value
  }

  async acquireConnectionLease(
    rootPath: string,
    leaseToken: string,
    clientId: number
  ): Promise<void> {
    const leaseKey = this.connectionLeaseKey(clientId, leaseToken)
    const rootKey = normalizeRuntimePathForComparison(rootPath)
    const existing = this.connectionLeases.get(leaseKey)
    if (existing) {
      if (existing.rootKey !== rootKey) {
        throw new Error('Terminal authority removal lease token was reused for another root')
      }
      await existing.readiness
      return
    }
    this.acquireRoot(rootKey)
    let lease: ConnectionLease
    const readiness = Promise.resolve().then(() =>
      this.prepareRoot(rootKey, rootPath, () => this.connectionLeases.get(leaseKey) === lease)
    )
    lease = Object.freeze({ clientId, leaseToken, readiness, rootKey })
    this.connectionLeases.set(leaseKey, lease)
    try {
      await readiness
    } catch (error) {
      this.releaseConnectionLeaseIfCurrent(leaseKey, lease)
      throw error
    }
  }

  releaseConnectionLease(clientId: number, leaseToken: string): void {
    const leaseKey = this.connectionLeaseKey(clientId, leaseToken)
    const lease = this.connectionLeases.get(leaseKey)
    if (lease) {
      this.releaseConnectionLeaseIfCurrent(leaseKey, lease)
    }
  }

  dispose(): void {
    this.removeClientDetachListener()
    this.removeDispatcherDisposeListener()
    this.releaseAllConnectionLeases()
  }

  private acquireRoot(rootKey: string): void {
    if (
      [...this.roots].some(
        (activeRoot) =>
          isNormalizedPathInsideOrEqual(activeRoot, rootKey) ||
          isNormalizedPathInsideOrEqual(rootKey, activeRoot)
      )
    ) {
      throw new Error('Remote worktree deletion already in progress')
    }
    if (this.roots.size >= MAX_RELAY_WORKTREE_REMOVAL_LEASES) {
      throw new Error('Remote worktree deletion capacity exceeded')
    }
    this.roots.add(rootKey)
  }

  private async prepareRoot(
    rootKey: string,
    rootPath: string,
    isCurrent: () => boolean = () => true
  ): Promise<void> {
    await this.waitForOperations(rootKey, isCurrent)
    this.assertLeaseCurrent(isCurrent)
    await this.closeRoot(rootKey)
    this.assertLeaseCurrent(isCurrent)
    await this.beforeRemove?.(rootPath)
    this.assertLeaseCurrent(isCurrent)
  }

  private assertLeaseCurrent(isCurrent: () => boolean): void {
    if (!isCurrent()) {
      throw new Error('Terminal authority removal lease was released')
    }
  }

  private hasOperationInside(rootKey: string): boolean {
    return [...this.operations.keys()].some((operationPath) =>
      isNormalizedPathInsideOrEqual(rootKey, operationPath)
    )
  }

  private waitForOperations(rootKey: string, isCurrent: () => boolean): Promise<void> {
    if (!isCurrent() || !this.hasOperationInside(rootKey)) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const waiters = this.operationWaiters.get(rootKey) ?? new Set<OperationWaiter>()
      waiters.add({ isCurrent, resolve })
      this.operationWaiters.set(rootKey, waiters)
    })
  }

  private resolveOperationWaiters(): void {
    for (const [rootKey, waiters] of this.operationWaiters) {
      const operationActive = this.hasOperationInside(rootKey)
      for (const waiter of waiters) {
        if (!operationActive || !waiter.isCurrent()) {
          waiters.delete(waiter)
          waiter.resolve()
        }
      }
      if (waiters.size === 0) {
        this.operationWaiters.delete(rootKey)
      }
    }
  }

  private async closeRoot(rootKey: string): Promise<void> {
    const pending = [...this.pendingSetups.entries()].filter(([setupRoot]) =>
      isNormalizedPathInsideOrEqual(rootKey, setupRoot)
    )
    await Promise.all(pending.map(([, setup]) => setup.promise.catch(() => undefined)))
    const states = [...this.watches.entries()]
      .filter(([watchRoot]) => isNormalizedPathInsideOrEqual(rootKey, watchRoot))
      .map(([, state]) => state)
    for (const state of states) {
      emitRelayWatcherTerminalFailure(this.dispatcher, state, 'Remote worktree is being removed')
      state.clients.clear()
      state.clientWatchIds.clear()
    }
    await Promise.all(states.map((state) => this.closeWatch(state)))
    const trackedRoots = this.teardownTracker
      .rootPaths()
      .filter((trackedRoot) =>
        isNormalizedPathInsideOrEqual(rootKey, normalizeRuntimePathForComparison(trackedRoot))
      )
    for (const trackedRoot of trackedRoots) {
      const failed = this.teardownTracker.failedState(trackedRoot)
      await (failed ? this.closeWatch(failed) : this.teardownTracker.join(trackedRoot))
    }
  }

  private closeWatch(state: RelayWatcherTeardownState): Promise<void> {
    return this.teardownTracker.close(state, () => {
      if (this.watches.get(state.rootKey) === state) {
        this.watches.delete(state.rootKey)
      }
    })
  }

  private releaseClientLeases(clientId: number): void {
    for (const [leaseKey, lease] of this.connectionLeases) {
      if (lease.clientId === clientId) {
        this.releaseConnectionLeaseIfCurrent(leaseKey, lease)
      }
    }
  }

  private releaseAllConnectionLeases(): void {
    for (const [leaseKey, lease] of this.connectionLeases) {
      this.releaseConnectionLeaseIfCurrent(leaseKey, lease)
    }
  }

  private releaseConnectionLeaseIfCurrent(leaseKey: string, lease: ConnectionLease): void {
    if (this.connectionLeases.get(leaseKey) !== lease) {
      return
    }
    this.connectionLeases.delete(leaseKey)
    this.roots.delete(lease.rootKey)
    this.resolveOperationWaiters()
  }

  private connectionLeaseKey(clientId: number, leaseToken: string): string {
    return `${clientId}:${leaseToken}`
  }
}
