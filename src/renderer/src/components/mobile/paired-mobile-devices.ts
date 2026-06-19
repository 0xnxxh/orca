import { useCallback, useEffect, useSyncExternalStore } from 'react'

export type PairedMobileDevice = {
  deviceId: string
  name: string
  pairedAt: number
  lastSeenAt: number
}

type PairedMobileDevicesSnapshot = {
  devices: readonly PairedMobileDevice[]
  loaded: boolean
  loading: boolean
}

const EMPTY_SNAPSHOT: PairedMobileDevicesSnapshot = {
  devices: [],
  loaded: false,
  loading: false
}

let snapshot = EMPTY_SNAPSHOT
// Why: Sidebar, Mobile page, and Settings can mount together; share one
// device-list request so slow IPC does not fan out across surfaces.
let activeRequest: {
  id: number
  promise: Promise<readonly PairedMobileDevice[]>
} | null = null
let latestRequestId = 0

const listeners = new Set<() => void>()

function publish(nextSnapshot: PairedMobileDevicesSnapshot): void {
  snapshot = nextSnapshot
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): PairedMobileDevicesSnapshot {
  return snapshot
}

export function replacePairedMobileDevices(devices: readonly PairedMobileDevice[]): void {
  latestRequestId += 1
  activeRequest = null
  publish({
    devices: [...devices],
    loaded: true,
    loading: false
  })
}

export function refreshPairedMobileDevices({
  force = false
}: {
  force?: boolean
} = {}): Promise<readonly PairedMobileDevice[]> {
  if (activeRequest && !force) {
    return activeRequest.promise
  }

  const requestId = latestRequestId + 1
  latestRequestId = requestId
  publish({ ...snapshot, loading: true })

  const promise = window.api.mobile
    .listDevices()
    .then((result) => {
      const devices = [...result.devices]
      if (requestId !== latestRequestId) {
        // Why: callers use the returned list for navigation decisions; don't
        // hand them data from a request the shared cache already ignored.
        return activeRequest?.promise ?? snapshot.devices
      }
      publish({
        devices,
        loaded: true,
        loading: false
      })
      return devices
    })
    .catch((error: unknown) => {
      if (requestId !== latestRequestId) {
        // Why: stale failures should not make callers route from an ignored
        // request when a newer refresh/write owns the shared cache.
        return activeRequest?.promise ?? snapshot.devices
      }
      if (requestId === latestRequestId) {
        publish({
          ...snapshot,
          loaded: true,
          loading: false
        })
      }
      throw error
    })
    .finally(() => {
      if (activeRequest?.id === requestId) {
        activeRequest = null
      }
    })

  activeRequest = { id: requestId, promise }
  return promise
}

export function usePairedMobileDevices({
  enabled = true,
  refreshOnMount = true
}: {
  enabled?: boolean
  refreshOnMount?: boolean
} = {}): {
  devices: readonly PairedMobileDevice[]
  loaded: boolean
  loading: boolean
  hasPairedDevice: boolean
  refresh: typeof refreshPairedMobileDevices
} {
  const currentSnapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const refresh = useCallback(refreshPairedMobileDevices, [])

  useEffect(() => {
    if (!enabled || !refreshOnMount || currentSnapshot.loaded || currentSnapshot.loading) {
      return
    }
    void refreshPairedMobileDevices().catch(() => {
      // Callers that need visible error handling perform explicit refreshes.
    })
  }, [currentSnapshot.loaded, currentSnapshot.loading, enabled, refreshOnMount])

  return {
    ...currentSnapshot,
    hasPairedDevice: currentSnapshot.devices.length > 0,
    refresh
  }
}

export function _resetPairedMobileDevicesCacheForTests(): void {
  latestRequestId += 1
  activeRequest = null
  publish(EMPTY_SNAPSHOT)
}
