import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import type { PtyProcessInfo } from '../providers/types'

export class DaemonPtySessionRouting {
  private adapters = new Map<string, DaemonPtyAdapter>()
  private ambiguousAdapters = new Map<string, Set<DaemonPtyAdapter>>()

  get(sessionId: string): DaemonPtyAdapter | undefined {
    return this.adapters.get(sessionId)
  }

  isAmbiguous(sessionId: string): boolean {
    return this.ambiguousAdapters.has(sessionId)
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

  refreshLive(adapters: DaemonPtyAdapter[], results: PtyProcessInfo[][]): string[] {
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
      if (!owners.has(id)) {
        this.ambiguousAdapters.delete(id)
      }
    }
    const ambiguousIds: string[] = []
    for (const [id, sessionOwners] of owners) {
      if (sessionOwners.size === 1) {
        this.ambiguousAdapters.delete(id)
        this.adapters.set(id, sessionOwners.values().next().value as DaemonPtyAdapter)
      } else {
        this.adapters.delete(id)
        this.ambiguousAdapters.set(id, sessionOwners)
        ambiguousIds.push(id)
      }
    }
    return ambiguousIds.sort()
  }
}
