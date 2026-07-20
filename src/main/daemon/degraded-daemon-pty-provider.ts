import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import {
  DegradedDaemonSessionRouting,
  type DegradedManagedPtyProvider
} from './degraded-daemon-session-routing'
import { shutdownDegradedFallbackSessions } from './degraded-daemon-fallback-shutdown'
import type {
  IPtyProvider,
  PtyBackgroundStreamEvent,
  PtyDataEvent,
  PtyProviderBufferSnapshot,
  PtyProcessInfo,
  PtySpawnOptions,
  PtySpawnResult
} from '../providers/types'
import type { PtyShutdownBlockReason } from '../../shared/pty-shutdown-safety'

export class DegradedDaemonPtyProvider implements IPtyProvider {
  readonly routesFreshSpawnsToLocalProvider = true
  // Why: the preserved daemon answers protocol but cannot spawn fresh PTYs.
  // Surfaced (e.g. via pty:management:listSessions) so the UI can warn that
  // new terminals are running without daemon persistence until a restart.
  readonly isDegraded = true

  private current: DaemonPtyAdapter
  private legacy: DaemonPtyAdapter[]
  private fallback: DegradedManagedPtyProvider
  private daemonAdapters: DaemonPtyAdapter[]
  private providers: DegradedManagedPtyProvider[]
  private sessionRouting: DegradedDaemonSessionRouting
  private unsubscribers: (() => void)[] = []
  private dataListeners: ((payload: PtyDataEvent) => void)[] = []
  private exitListeners: ((payload: { id: string; code: number }) => void)[] = []

  constructor(opts: {
    current: DaemonPtyAdapter
    legacy: DaemonPtyAdapter[]
    fallback: DegradedManagedPtyProvider
  }) {
    this.current = opts.current
    this.legacy = opts.legacy
    this.fallback = opts.fallback
    this.daemonAdapters = [this.current, ...this.legacy]
    this.providers = [this.fallback, ...this.daemonAdapters]
    this.sessionRouting = new DegradedDaemonSessionRouting(this.fallback, this.daemonAdapters)

    for (const provider of this.providers) {
      this.unsubscribers.push(
        provider.onData((payload) => {
          for (const listener of this.dataListeners) {
            listener(payload)
          }
        }),
        provider.onExit((payload) => {
          if (this.sessionRouting.handleExit(payload.id, provider)) {
            for (const listener of this.exitListeners) {
              listener(payload)
            }
          }
        })
      )
    }
  }

  async discoverDaemonSessions(): Promise<void> {
    // Why: fallback sessions can already exist after startup fail-open; include
    // them so a duplicate preserved daemon owner fails closed before shutdown.
    for (const provider of this.providers) {
      const refresh = this.sessionRouting.beginInventoryRefresh()
      try {
        const sessions = await provider.listProcesses()
        this.sessionRouting.refreshProvider(provider, sessions, refresh)
      } catch (error) {
        this.sessionRouting.finishInventoryRefresh(refresh)
        console.warn('[daemon] Failed to discover degraded PTY sessions', error)
      }
    }
  }

  async spawn(opts: PtySpawnOptions): Promise<PtySpawnResult> {
    const mapped = opts.sessionId ? this.sessionRouting.get(opts.sessionId) : undefined
    const target = mapped ?? this.fallback
    const result = await target.spawn(opts)
    this.sessionRouting.add(result.id, target)
    return result
  }

  async attach(id: string): Promise<void> {
    await this.providerFor(id).attach(id)
  }

  hasPty(id: string): boolean {
    return this.sessionRouting.hasPty(id)
  }

  write(id: string, data: string): void {
    this.providerFor(id).write(id, data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.providerFor(id).resize(id, cols, rows)
  }

  pauseProducer(id: string): void {
    this.providerFor(id).pauseProducer?.(id)
  }

  resumeProducer(id: string): void {
    this.providerFor(id).resumeProducer?.(id)
  }

  setPtyBackgrounded(id: string, background: boolean): void {
    this.providerFor(id).setPtyBackgrounded?.(id, background)
  }

  async shutdown(
    id: string,
    opts: { immediate?: boolean; keepHistory?: boolean; deadlineMs?: number }
  ): Promise<void> {
    // Why: synchronous daemon hasPty caches can miss restored sessions after
    // transient discovery failure; destructive routing needs fresh inventories.
    await this.sessionRouting.refreshInventories({ deadlineMs: opts.deadlineMs })
    if (this.sessionRouting.isAmbiguous(id)) {
      throw this.ambiguousOwnershipError([id])
    }
    const target = this.sessionRouting.get(id) ?? this.fallback
    await this.sessionRouting.shutdown(id, target, opts)
  }

  async getShutdownBlockReason(id: string): Promise<PtyShutdownBlockReason | null> {
    // Why: degraded routing can hide a preserved legacy owner behind the fallback.
    await this.sessionRouting.refreshInventories()
    if (this.sessionRouting.isAmbiguous(id)) {
      throw this.ambiguousOwnershipError([id])
    }
    return (await this.sessionRouting.get(id)?.getShutdownBlockReason?.(id)) ?? null
  }

  async sendSignal(id: string, signal: string): Promise<void> {
    await this.providerFor(id).sendSignal(id, signal)
  }

  async getCwd(id: string): Promise<string> {
    return this.providerFor(id).getCwd(id)
  }

  async getInitialCwd(id: string): Promise<string> {
    return this.providerFor(id).getInitialCwd(id)
  }

  async getAppliedSize(id: string): Promise<{ cols: number; rows: number } | null> {
    return (await this.providerFor(id).getAppliedSize?.(id)) ?? null
  }

  async getBufferSnapshot(
    id: string,
    opts?: { scrollbackRows?: number }
  ): Promise<PtyProviderBufferSnapshot | null> {
    // Why: a preserved legacy daemon can still thin its monitoring stream;
    // recovery must reach the adapter that owns that session's full model.
    return (await this.providerFor(id).getBufferSnapshot?.(id, opts)) ?? null
  }

  async clearBuffer(id: string): Promise<void> {
    await this.providerFor(id).clearBuffer(id)
  }

  async closeStartupQueryAuthority(id: string): Promise<number> {
    return (await this.providerFor(id).closeStartupQueryAuthority?.(id)) ?? 0
  }

  acknowledgeDataEvent(id: string, charCount: number): void {
    this.providerFor(id).acknowledgeDataEvent(id, charCount)
  }

  async hasChildProcesses(id: string): Promise<boolean> {
    return this.providerFor(id).hasChildProcesses(id)
  }

  async getForegroundProcess(id: string): Promise<string | null> {
    return this.providerFor(id).getForegroundProcess(id)
  }

  async confirmForegroundProcess(id: string): Promise<string | null> {
    return this.providerFor(id).confirmForegroundProcess?.(id) ?? null
  }

  async serialize(ids: string[]): Promise<string> {
    return this.fallback.serialize(ids)
  }

  async revive(state: string): Promise<void> {
    await this.fallback.revive(state)
  }

  async listProcesses(opts?: { deadlineMs?: number }): Promise<PtyProcessInfo[]> {
    const { results, ambiguousIds } = await this.sessionRouting.refreshInventories(opts)
    if (ambiguousIds.length > 0) {
      throw this.ambiguousOwnershipError(ambiguousIds)
    }
    return results.flat()
  }

  async getDefaultShell(): Promise<string> {
    return this.fallback.getDefaultShell()
  }

  async getProfiles(): Promise<{ name: string; path: string }[]> {
    return this.fallback.getProfiles()
  }

  onData(callback: (payload: PtyDataEvent) => void): () => void {
    this.dataListeners.push(callback)
    return () => {
      const idx = this.dataListeners.indexOf(callback)
      if (idx !== -1) {
        this.dataListeners.splice(idx, 1)
      }
    }
  }

  onBackgroundStreamEvent(callback: (payload: PtyBackgroundStreamEvent) => void): () => void {
    const unsubscribes = this.providers.flatMap(
      (provider) => provider.onBackgroundStreamEvent?.(callback) ?? []
    )
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe()
      }
    }
  }

  onReplay(callback: (payload: { id: string; data: string }) => void): () => void {
    const unsubscribes = this.providers.map((provider) => provider.onReplay(callback))
    let active = true
    const trackedUnsubscribe = (): void => {
      if (!active) {
        return
      }
      active = false
      const idx = this.unsubscribers.indexOf(trackedUnsubscribe)
      if (idx !== -1) {
        this.unsubscribers.splice(idx, 1)
      }
      for (const unsubscribe of unsubscribes) {
        unsubscribe()
      }
    }
    this.unsubscribers.push(trackedUnsubscribe)
    return trackedUnsubscribe
  }

  onExit(callback: (payload: { id: string; code: number }) => void): () => void {
    this.exitListeners.push(callback)
    return () => {
      const idx = this.exitListeners.indexOf(callback)
      if (idx !== -1) {
        this.exitListeners.splice(idx, 1)
      }
    }
  }

  ackColdRestore(sessionId: string): void {
    this.sessionRouting.daemonFor(sessionId)?.ackColdRestore(sessionId)
  }

  clearTombstone(sessionId: string): void {
    this.sessionRouting.daemonFor(sessionId)?.clearTombstone(sessionId)
  }

  async reconcileOnStartup(validWorktreeIds: Set<string>): Promise<{
    alive: string[]
    killed: string[]
  }> {
    const alive: string[] = []
    const killed: string[] = []
    for (const adapter of this.daemonAdapters) {
      const result = await adapter.reconcileOnStartup(validWorktreeIds)
      for (const id of result.alive) {
        alive.push(id)
        this.sessionRouting.add(id, adapter)
      }
      for (const id of result.killed) {
        killed.push(id)
        this.sessionRouting.remove(id, adapter)
      }
    }
    return { alive, killed }
  }

  dispose(): void {
    this.disposeProviderOnly()
    for (const adapter of this.daemonAdapters) {
      adapter.dispose()
    }
  }

  disposeProviderOnly(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe()
    }
  }

  async shutdownFallbackSessions(): Promise<number> {
    return shutdownDegradedFallbackSessions(
      this.sessionRouting.providerMapFor(this.fallback),
      this.fallback,
      (id) => this.sessionRouting.remove(id, this.fallback)
    )
  }

  getCurrentDaemonSessionIds(): string[] {
    return this.sessionRouting.idsForDaemon(this.current)
  }

  fanoutCurrentDaemonSyntheticExits(code: number): void {
    for (const id of this.getCurrentDaemonSessionIds()) {
      if (this.sessionRouting.handleExit(id, this.current)) {
        // Why: sessions discovered from listProcesses may not exist in the
        // adapter's active-session set, but restart still kills that daemon.
        // oxlint-disable-next-line unicorn/no-useless-spread -- copy-safe: listeners may unsubscribe during iteration
        for (const listener of [...this.exitListeners]) {
          listener({ id, code })
        }
      }
    }
  }

  async disconnectOnly(): Promise<void> {
    this.disposeProviderOnly()
    await Promise.all(this.daemonAdapters.map((adapter) => adapter.disconnectOnly()))
  }

  getCurrentAdapter(): DaemonPtyAdapter {
    return this.current
  }

  getLegacyAdapters(): readonly DaemonPtyAdapter[] {
    return this.legacy
  }

  getAllAdapters(): readonly DaemonPtyAdapter[] {
    return this.daemonAdapters
  }

  private providerFor(sessionId: string): DegradedManagedPtyProvider {
    return this.sessionRouting.providerFor(sessionId, this.current)
  }

  private ambiguousOwnershipError(sessionIds: string[]): Error {
    return new Error(
      `Ambiguous PTY session ownership across degraded providers: ${sessionIds.join(', ')}`
    )
  }
}
