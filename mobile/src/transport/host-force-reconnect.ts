import type { RpcClient } from './rpc-client'
import { verifyForceReconnectRpcHealth } from './force-reconnect-rpc-health'

export type HostReconnectEntry = {
  client: RpcClient
  refCount: number
  unsubState: () => void
}

type HostReconnectOperation = {
  hostId: string
  entry: HostReconnectEntry | undefined
  listenerCount: number
  removeEntry: () => void
  openReplacement: () => Promise<HostReconnectEntry | null>
}

export class HostForceReconnectCoordinator {
  private readonly pendingByHost = new Map<string, Promise<void>>()

  run(operation: HostReconnectOperation): Promise<void> {
    const pending = this.pendingByHost.get(operation.hostId)
    if (pending) {
      return pending
    }
    const reconnect = this.replaceAndVerify(operation)
    this.pendingByHost.set(operation.hostId, reconnect)
    const clearPending = () => {
      if (this.pendingByHost.get(operation.hostId) === reconnect) {
        this.pendingByHost.delete(operation.hostId)
      }
    }
    void reconnect.then(clearPending, clearPending)
    return reconnect
  }

  private async replaceAndVerify(operation: HostReconnectOperation): Promise<void> {
    const savedRefCount = operation.entry?.refCount ?? Math.max(1, operation.listenerCount)
    if (operation.entry) {
      operation.entry.unsubState()
      operation.entry.client.close()
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
