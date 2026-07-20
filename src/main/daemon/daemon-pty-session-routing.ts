import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import type { PtyProcessInfo } from '../providers/types'

export type DaemonPtyInventoryRefresh = {
  readonly revision: number
}

type SessionMutation = {
  revision: number
  refresh?: DaemonPtyInventoryRefresh
}

export class DaemonPtySessionRouting {
  private adapters = new Map<string, DaemonPtyAdapter>()
  private ambiguousAdapters = new Map<string, Set<DaemonPtyAdapter>>()
  private revision = 0
  private sessionMutations = new Map<string, SessionMutation>()
  private activeInventoryRefreshes = new Set<DaemonPtyInventoryRefresh>()

  get(sessionId: string): DaemonPtyAdapter | undefined {
    return this.adapters.get(sessionId)
  }

  isAmbiguous(sessionId: string): boolean {
    return this.ambiguousAdapters.has(sessionId)
  }

  beginInventoryRefresh(): DaemonPtyInventoryRefresh {
    // Why: a later overlapping snapshot may supersede an earlier refresh,
    // while an exit/add event must supersede every snapshot already in flight.
    this.revision += 1
    const refresh = { revision: this.revision }
    this.activeInventoryRefreshes.add(refresh)
    return refresh
  }

  finishInventoryRefresh(refresh: DaemonPtyInventoryRefresh): void {
    this.activeInventoryRefreshes.delete(refresh)
    if (this.activeInventoryRefreshes.size === 0) {
      this.sessionMutations.clear()
      return
    }
    const oldestRevision = Math.min(
      ...[...this.activeInventoryRefreshes].map((active) => active.revision)
    )
    for (const [id, mutation] of this.sessionMutations) {
      if (mutation.revision <= oldestRevision) {
        this.sessionMutations.delete(id)
      }
    }
  }

  applyInventoryMutation(
    sessionId: string,
    refresh: DaemonPtyInventoryRefresh,
    mutation: () => void
  ): boolean {
    if (!this.isInventoryResultCurrent(sessionId, refresh)) {
      return false
    }
    mutation()
    this.recordMutation(sessionId, refresh)
    return true
  }

  addInventorySession(
    sessionId: string,
    adapter: DaemonPtyAdapter,
    refresh: DaemonPtyInventoryRefresh
  ): void {
    this.applyInventoryMutation(sessionId, refresh, () => this.addRoute(sessionId, adapter))
  }

  recordExternalMutation(sessionId: string): void {
    this.recordMutation(sessionId)
  }

  idsFor(adapter: DaemonPtyAdapter): string[] {
    const ids = [...this.adapters].filter(([, owner]) => owner === adapter).map(([id]) => id)
    for (const [id, owners] of this.ambiguousAdapters) {
      if (owners.has(adapter)) {
        ids.push(id)
      }
    }
    return ids.sort()
  }

  add(sessionId: string, adapter: DaemonPtyAdapter): void {
    this.recordMutation(sessionId)
    this.addRoute(sessionId, adapter)
  }

  private addRoute(sessionId: string, adapter: DaemonPtyAdapter): void {
    const ambiguous = this.ambiguousAdapters.get(sessionId)
    if (ambiguous) {
      ambiguous.add(adapter)
      return
    }
    const existing = this.adapters.get(sessionId)
    if (existing && existing !== adapter) {
      this.adapters.delete(sessionId)
      this.ambiguousAdapters.set(sessionId, new Set([existing, adapter]))
      return
    }
    this.adapters.set(sessionId, adapter)
  }

  remove(sessionId: string, adapter: DaemonPtyAdapter): void {
    this.recordMutation(sessionId)
    const ambiguous = this.ambiguousAdapters.get(sessionId)
    if (ambiguous) {
      ambiguous.delete(adapter)
      if (ambiguous.size === 1) {
        this.ambiguousAdapters.delete(sessionId)
        this.adapters.set(sessionId, ambiguous.values().next().value as DaemonPtyAdapter)
      } else if (ambiguous.size === 0) {
        this.ambiguousAdapters.delete(sessionId)
        this.adapters.delete(sessionId)
      }
      return
    }
    if (this.adapters.get(sessionId) === adapter) {
      this.adapters.delete(sessionId)
    }
  }

  refreshLive(
    adapters: DaemonPtyAdapter[],
    results: PtyProcessInfo[][],
    refresh: DaemonPtyInventoryRefresh
  ): string[] {
    const owners = new Map<string, Set<DaemonPtyAdapter>>()
    for (let index = 0; index < adapters.length; index += 1) {
      for (const session of results[index]) {
        const sessionOwners = owners.get(session.id) ?? new Set<DaemonPtyAdapter>()
        sessionOwners.add(adapters[index])
        owners.set(session.id, sessionOwners)
      }
    }

    // Why: unique absent sessions may be sleeping on legacy history, but a
    // successful all-daemon inventory can retire stale live ambiguity.
    for (const id of this.ambiguousAdapters.keys()) {
      if (!owners.has(id) && this.isInventoryResultCurrent(id, refresh)) {
        this.applyInventoryMutation(id, refresh, () => this.ambiguousAdapters.delete(id))
      }
    }
    const ambiguousIds: string[] = []
    for (const [id, sessionOwners] of owners) {
      if (!this.isInventoryResultCurrent(id, refresh)) {
        continue
      }
      if (sessionOwners.size === 1) {
        this.applyInventoryMutation(id, refresh, () => {
          this.ambiguousAdapters.delete(id)
          this.adapters.set(id, sessionOwners.values().next().value as DaemonPtyAdapter)
        })
      } else {
        this.applyInventoryMutation(id, refresh, () => {
          this.adapters.delete(id)
          this.ambiguousAdapters.set(id, sessionOwners)
        })
        ambiguousIds.push(id)
      }
    }
    this.finishInventoryRefresh(refresh)
    return ambiguousIds.sort()
  }

  private isInventoryResultCurrent(sessionId: string, refresh: DaemonPtyInventoryRefresh): boolean {
    const mutation = this.sessionMutations.get(sessionId)
    return (
      mutation === undefined ||
      mutation.revision <= refresh.revision ||
      mutation.refresh === refresh ||
      (mutation.refresh !== undefined && mutation.refresh.revision < refresh.revision)
    )
  }

  private recordMutation(sessionId: string, refresh?: DaemonPtyInventoryRefresh): void {
    this.revision += 1
    if (this.activeInventoryRefreshes.size > 0) {
      this.sessionMutations.set(sessionId, { revision: this.revision, refresh })
    }
  }
}
