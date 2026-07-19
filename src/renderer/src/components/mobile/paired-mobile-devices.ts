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
  // Why: distinguishes "load failed" from "zero devices paired" — both leave
  // devices empty, but only the former should be retried/recovered.
  error: boolean
}

const EMPTY_SNAPSHOT: PairedMobileDevicesSnapshot = {
  devices: [],
  loaded: false,
  loading: false,
  error: false
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

// Why: a superseded request must hand back whatever now owns the shared cache —
// the newer in-flight request's promise, or the current published devices —
// never the stale data the store already ignored.
function supersededResult():
  | Promise<readonly PairedMobileDevice[]>
  | readonly PairedMobileDevice[] {
  return activeRequest?.promise ?? snapshot.devices
}

// Why: lets callers read the up-to-the-moment device list synchronously inside
// callbacks/closures without hand-mirroring the store into a local ref.
export function getPairedMobileDevicesSnapshot(): readonly PairedMobileDevice[] {
  return snapshot.devices
}

export function replacePairedMobileDevices(devices: readonly PairedMobileDevice[]): void {
  latestRequestId += 1
  activeRequest = null
  publish({
    devices: [...devices],
    loaded: true,
    loading: false,
    error: false
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
        return supersededResult()
      }
      publish({
        devices,
        loaded: true,
        loading: false,
        error: false
      })
      return devices
    })
    .catch((error: unknown) => {
      if (requestId !== latestRequestId) {
        return supersededResult()
      }
      // Why: keep loaded:true so the loaded-gated mount effect can't refire into
      // a retry loop, but flag error so consumers can tell a failed load apart
      // from "no devices" and recover (see usePairedMobileDevices focus/online).
      publish({
        ...snapshot,
        loaded: true,
        loading: false,
        error: true
      })
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
  error: boolean
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

  // Why: a failed load parks the shared cache in an error state the loaded-gated
  // mount effect above can't retry (it would loop). Recover on window focus or
  // reconnect — enough to un-wedge a persistent consumer like the sidebar after
  // a transient startup IPC failure, without a polling timer.
  useEffect(() => {
    if (!enabled || !currentSnapshot.error) {
      return
    }
    const retry = (): void => {
      void refreshPairedMobileDevices({ force: true }).catch(() => {})
    }
    window.addEventListener('focus', retry)
    window.addEventListener('online', retry)
    return () => {
      window.removeEventListener('focus', retry)
      window.removeEventListener('online', retry)
    }
  }, [enabled, currentSnapshot.error])

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
