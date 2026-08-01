import type { RpcClient } from './rpc-client'
import { verifyForceReconnectRpcHealth } from './force-reconnect-rpc-health'

export type HostReconnectEntry = {
  client: RpcClient
  refCount: number
  unsubState: () => void
}

type HostReconnectOperation = {
  hostId: string
  profileVersion: number
  getEntry: () => HostReconnectEntry | undefined
  getListenerCount: () => number
  removeEntry: () => void
  openReplacement: () => Promise<HostReconnectEntry | null>
}

type PendingReconnect = {
  profileVersion: number
  generation: number
  promise: Promise<void>
}

export class HostForceReconnectCoordinator {
  private readonly pendingByHost = new Map<string, PendingReconnect>()
  private readonly generations = new Map<string, number>()

  cancel(hostId: string): void {
    this.generations.set(hostId, this.generation(hostId) + 1)
    this.pendingByHost.delete(hostId)
  }

  cancelAll(): void {
    for (const hostId of this.pendingByHost.keys()) {
      this.cancel(hostId)
    }
  }

  run(operation: HostReconnectOperation): Promise<void> {
    const generation = this.generation(operation.hostId)
    const pending = this.pendingByHost.get(operation.hostId)
    if (pending?.profileVersion === operation.profileVersion && pending.generation === generation) {
      return pending.promise
    }
    // Why: a changed endpoint must supersede the in-flight profile without racing its health probe.
    const reconnect = pending
      ? pending.promise
          .catch(() => undefined)
          .then(() => this.replaceAndVerify(operation, generation))
      : this.replaceAndVerify(operation, generation)
    this.pendingByHost.set(operation.hostId, {
      profileVersion: operation.profileVersion,
      generation,
      promise: reconnect
    })
    const clearPending = () => {
      if (this.pendingByHost.get(operation.hostId)?.promise === reconnect) {
        this.pendingByHost.delete(operation.hostId)
      }
    }
    void reconnect.then(clearPending, clearPending)
    return reconnect
  }

  private async replaceAndVerify(
    operation: HostReconnectOperation,
    generation: number
  ): Promise<void> {
    if (this.wasCancelled(operation.hostId, generation)) {
      return
    }
    const entry = operation.getEntry()
    const savedRefCount = entry?.refCount ?? Math.max(1, operation.getListenerCount())
    if (entry) {
      entry.unsubState()
      entry.client.close()
      operation.removeEntry()
    }
    const fresh = await operation.openReplacement()
    if (this.wasCancelled(operation.hostId, generation)) {
      return
    }
    if (!fresh) {
      throw new Error('Unable to open a replacement connection')
    }
    fresh.refCount = savedRefCount
    try {
      await verifyForceReconnectRpcHealth(fresh.client)
    } catch (error) {
      if (!this.wasCancelled(operation.hostId, generation)) {
        throw error
      }
    }
  }

  private generation(hostId: string): number {
    return this.generations.get(hostId) ?? 0
  }

  private wasCancelled(hostId: string, generation: number): boolean {
    return this.generation(hostId) !== generation
  }
}
