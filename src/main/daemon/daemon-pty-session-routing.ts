import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import type { IPtyProvider, PtyProcessInfo } from '../providers/types'

export type DaemonPtyInventoryRefresh = {
  readonly revision: number
}

type SessionMutation = {
  revision: number
  refresh?: DaemonPtyInventoryRefresh
}

/** Tracks every physical owner of a logical PTY id across inventory races. */
export class DaemonPtySessionRouting<Owner extends object = DaemonPtyAdapter> {
  private owners = new Map<string, Owner>()
  private ambiguousOwners = new Map<string, Set<Owner>>()
  private sleepingOwners = new Map<string, Set<Owner>>()
  private revision = 0
  private sessionMutations = new Map<string, Map<Owner, SessionMutation>>()
  private activeInventoryRefreshes = new Set<DaemonPtyInventoryRefresh>()
  private ownerInventoryRefreshes = new Map<Owner, DaemonPtyInventoryRefresh>()
  private inFlightInventories = new Map<
    number | undefined,
    Promise<{ results: PtyProcessInfo[][]; ambiguousIds: string[] }>
  >()

  get(sessionId: string): Owner | undefined {
    return this.owners.get(sessionId)
  }

  isAmbiguous(sessionId: string): boolean {
    return this.ambiguousOwners.has(sessionId)
  }

  beginInventoryRefresh(): DaemonPtyInventoryRefresh {
    // Why: a later overlapping snapshot may supersede an earlier refresh,
    // while an exit/add event must supersede only that provider's in-flight result.
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
    for (const [id, ownerMutations] of this.sessionMutations) {
      for (const [owner, mutation] of ownerMutations) {
        if (mutation.revision <= oldestRevision) {
          ownerMutations.delete(owner)
        }
      }
      if (ownerMutations.size === 0) {
        this.sessionMutations.delete(id)
      }
    }
  }

  idsFor(owner: Owner): string[] {
    const ids = [...this.owners].filter(([, candidate]) => candidate === owner).map(([id]) => id)
    for (const [id, candidates] of this.ambiguousOwners) {
      if (candidates.has(owner)) {
        ids.push(id)
      }
    }
    return ids.sort()
  }

  add(sessionId: string, owner: Owner): void {
    this.recordMutation(sessionId, owner)
    this.removeSleepingOwner(sessionId, owner)
    this.addRoute(sessionId, owner)
  }

  remove(sessionId: string, owner: Owner): boolean {
    this.recordMutation(sessionId, owner)
    this.removeSleepingOwner(sessionId, owner)
    this.removeRoute(sessionId, owner)
    return !this.hasOwner(sessionId)
  }

  handleExit(sessionId: string, owner: Owner): boolean {
    this.recordMutation(sessionId, owner)
    // Why: keepHistory intentionally exits the physical process while retaining
    // the provider that owns its cold-restore state for the later wake.
    if (this.isSleeping(sessionId, owner)) {
      return false
    }
    this.removeRoute(sessionId, owner)
    return !this.hasOwner(sessionId)
  }

  beginSleep(sessionId: string, owner: Owner): void {
    this.recordMutation(sessionId, owner)
    this.addRoute(sessionId, owner)
    const sleeping = this.sleepingOwners.get(sessionId) ?? new Set<Owner>()
    sleeping.add(owner)
    this.sleepingOwners.set(sessionId, sleeping)
  }

  cancelSleep(sessionId: string, owner: Owner): void {
    this.recordMutation(sessionId, owner)
    this.removeSleepingOwner(sessionId, owner)
  }

  refreshLive(
    inventoryOwners: Owner[],
    results: PtyProcessInfo[][],
    refresh: DaemonPtyInventoryRefresh
  ): string[] {
    for (let index = 0; index < inventoryOwners.length; index += 1) {
      this.refreshOwner(inventoryOwners[index], results[index], refresh)
    }
    this.finishInventoryRefresh(refresh)
    return [...this.ambiguousOwners.keys()].sort()
  }

  refreshInventories(
    inventoryOwners: (Owner & Pick<IPtyProvider, 'listProcesses'>)[],
    opts?: { deadlineMs?: number }
  ): Promise<{ results: PtyProcessInfo[][]; ambiguousIds: string[] }> {
    const deadlineKey = opts?.deadlineMs
    const existing = this.inFlightInventories.get(deadlineKey)
    if (existing) {
      return existing
    }
    const refresh = this.beginInventoryRefresh()
    const request = Promise.all(inventoryOwners.map((owner) => owner.listProcesses(opts))).then(
      (results) => ({
        results,
        ambiguousIds: this.refreshLive(inventoryOwners, results, refresh)
      }),
      (error: unknown) => {
        this.finishInventoryRefresh(refresh)
        throw error
      }
    )
    this.inFlightInventories.set(deadlineKey, request)
    // Why: provider and registry sweeps run concurrently with one deadline;
    // shutdown must join their authoritative inventory before choosing an owner.
    void request.then(
      () => this.clearInventoryRequest(deadlineKey, request),
      () => this.clearInventoryRequest(deadlineKey, request)
    )
    return request
  }

  private clearInventoryRequest(
    deadlineKey: number | undefined,
    request: Promise<{ results: PtyProcessInfo[][]; ambiguousIds: string[] }>
  ): void {
    if (this.inFlightInventories.get(deadlineKey) === request) {
      this.inFlightInventories.delete(deadlineKey)
    }
  }

  private refreshOwner(
    owner: Owner,
    sessions: PtyProcessInfo[],
    refresh: DaemonPtyInventoryRefresh
  ): void {
    const latestRefresh = this.ownerInventoryRefreshes.get(owner)
    if (latestRefresh && latestRefresh.revision > refresh.revision) {
      return
    }
    this.ownerInventoryRefreshes.set(owner, refresh)
    const reportedIds = new Set(sessions.map((session) => session.id))
    const relevantIds = new Set([...this.idsFor(owner), ...reportedIds])
    for (const sessionId of relevantIds) {
      this.applyInventoryMutation(sessionId, owner, refresh, () => {
        if (reportedIds.has(sessionId)) {
          this.addRoute(sessionId, owner)
        } else if (!this.isSleeping(sessionId, owner)) {
          this.removeRoute(sessionId, owner)
        }
      })
    }
  }

  private applyInventoryMutation(
    sessionId: string,
    owner: Owner,
    refresh: DaemonPtyInventoryRefresh,
    mutation: () => void
  ): boolean {
    if (!this.isInventoryResultCurrent(sessionId, owner, refresh)) {
      return false
    }
    mutation()
    this.recordMutation(sessionId, owner, refresh)
    return true
  }

  private addRoute(sessionId: string, owner: Owner): void {
    const ambiguous = this.ambiguousOwners.get(sessionId)
    if (ambiguous) {
      ambiguous.add(owner)
      return
    }
    const existing = this.owners.get(sessionId)
    if (existing && existing !== owner) {
      this.owners.delete(sessionId)
      this.ambiguousOwners.set(sessionId, new Set([existing, owner]))
      return
    }
    this.owners.set(sessionId, owner)
  }

  private removeRoute(sessionId: string, owner: Owner): void {
    const ambiguous = this.ambiguousOwners.get(sessionId)
    if (ambiguous) {
      ambiguous.delete(owner)
      if (ambiguous.size === 1) {
        this.ambiguousOwners.delete(sessionId)
        this.owners.set(sessionId, ambiguous.values().next().value as Owner)
      } else if (ambiguous.size === 0) {
        this.ambiguousOwners.delete(sessionId)
        this.owners.delete(sessionId)
      }
      return
    }
    if (this.owners.get(sessionId) === owner) {
      this.owners.delete(sessionId)
    }
  }

  private hasOwner(sessionId: string): boolean {
    return this.owners.has(sessionId) || this.ambiguousOwners.has(sessionId)
  }

  private isSleeping(sessionId: string, owner: Owner): boolean {
    return this.sleepingOwners.get(sessionId)?.has(owner) === true
  }

  private removeSleepingOwner(sessionId: string, owner: Owner): void {
    const sleeping = this.sleepingOwners.get(sessionId)
    sleeping?.delete(owner)
    if (sleeping?.size === 0) {
      this.sleepingOwners.delete(sessionId)
    }
  }

  private isInventoryResultCurrent(
    sessionId: string,
    owner: Owner,
    refresh: DaemonPtyInventoryRefresh
  ): boolean {
    const mutation = this.sessionMutations.get(sessionId)?.get(owner)
    return (
      mutation === undefined ||
      mutation.revision <= refresh.revision ||
      mutation.refresh === refresh ||
      (mutation.refresh !== undefined && mutation.refresh.revision < refresh.revision)
    )
  }

  private recordMutation(
    sessionId: string,
    owner: Owner,
    refresh?: DaemonPtyInventoryRefresh
  ): void {
    this.revision += 1
    if (this.activeInventoryRefreshes.size === 0) {
      return
    }
    const ownerMutations = this.sessionMutations.get(sessionId) ?? new Map()
    ownerMutations.set(owner, { revision: this.revision, refresh })
    this.sessionMutations.set(sessionId, ownerMutations)
  }
}
