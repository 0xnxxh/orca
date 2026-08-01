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
  promise: Promise<void>
}

export class HostForceReconnectCoordinator {
  private readonly pendingByHost = new Map<string, PendingReconnect>()

  run(operation: HostReconnectOperation): Promise<void> {
    const pending = this.pendingByHost.get(operation.hostId)
    if (pending?.profileVersion === operation.profileVersion) {
      return pending.promise
    }
    // Why: a changed endpoint must supersede the in-flight profile without racing its health probe.
    const reconnect = pending
      ? pending.promise.catch(() => undefined).then(() => this.replaceAndVerify(operation))
      : this.replaceAndVerify(operation)
    this.pendingByHost.set(operation.hostId, {
      profileVersion: operation.profileVersion,
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

  private async replaceAndVerify(operation: HostReconnectOperation): Promise<void> {
    const entry = operation.getEntry()
    const savedRefCount = entry?.refCount ?? Math.max(1, operation.getListenerCount())
    if (entry) {
      entry.unsubState()
      entry.client.close()
      operation.removeEntry()
    }
    const fresh = await operation.openReplacement()
    if (!fresh) {
      throw new Error('Unable to open a replacement connection')
    }
    fresh.refCount = savedRefCount
    await verifyForceReconnectRpcHealth(fresh.client)
  }
}
