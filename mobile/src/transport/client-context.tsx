// Single shared RpcClient per host, collapsing the old per-screen WebSocket connections.
// Design: docs/mobile-shared-client-per-host.md.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { RpcClient } from './rpc-client'
import { connectionLogStore } from './connection-log-buffer'
import { subscribeConnectionRevivalTriggers } from './connection-revival-triggers'
import { HostClientOpenRegistry } from './host-client-open-registry'
import { decrementPendingAcquisition } from './host-client-acquisition-count'
import {
  clientActivePath,
  notifyAllHostListeners,
  notifyHostStateListeners,
  type CloseEntryOptions
} from './host-client-context-state'
import { loadHosts } from './host-store'
import { openHostLogicalClient } from './host-logical-client'
import type { MobileConnectionPath } from './stable-logical-rpc-client'
import type { ConnectionState, HostProfile } from './types'

type StoreEntry = {
  client: RpcClient
  state: ConnectionState
  refCount: number
  unsubState: () => void
}

export type RpcClientContextValue = {
  acquire: (hostId: string, host?: HostProfile) => RpcClient | null
  release: (hostId: string) => void
  releaseAndCloseIfUnused: (hostId: string) => void
  closeIfUnused: (hostId: string) => void
  forceReconnect: (hostId: string) => Promise<void>
  closeHost: (hostId: string) => void
  getState: (hostId: string) => ConnectionState
  getReconnectAttempt: (hostId: string) => number
  // Why: ms-epoch of the last 'connected' (null if never this session); UI escalates "Reconnecting…" into a re-pair prompt.
  getLastConnectedAt: (hostId: string) => number | null
  getActivePath: (hostId: string) => MobileConnectionPath
  subscribeHostState: (hostId: string, listener: (state: ConnectionState) => void) => () => void
  getAllClients: () => Array<{ hostId: string; client: RpcClient }>
  subscribeAllHosts: (listener: () => void) => () => void
  // Why: lets the home screen feed already-loaded HostProfiles so we don't pay loadHosts() latency twice.
  primeHosts: (hosts: HostProfile[]) => void
}

const Ctx = createContext<RpcClientContextValue | null>(null)

export function RpcClientProvider({ children }: { children: ReactNode }) {
  // Why: entries in a ref so state changes don't re-render the whole tree; propagation goes through per-host listener Sets.
  const storeRef = useRef<Map<string, StoreEntry>>(new Map())
  const stateListenersRef = useRef<Map<string, Set<(state: ConnectionState) => void>>>(new Map())
  const allHostsListenersRef = useRef<Set<() => void>>(new Set())

  // Pending opens keyed by hostId so two acquire() callers in the same render don't race the host lookup.
  const pendingOpensRef = useRef(new HostClientOpenRegistry())
  const pendingAcquisitionsRef = useRef<Map<string, number>>(new Map())

  // Why: cache of already-loaded HostProfiles so openEntry can skip a second loadHosts()/Keychain pass on cold start.
  const primedHostsRef = useRef<Map<string, HostProfile>>(new Map())

  const notifyHostState = (hostId: string, state: ConnectionState) =>
    notifyHostStateListeners(stateListenersRef.current, hostId, state)
  const notifyAllHosts = () => notifyAllHostListeners(allHostsListenersRef.current)

  const closeEntry = useCallback((hostId: string, options: CloseEntryOptions) => {
    const entry = storeRef.current.get(hostId)
    const acquisitionCount = entry?.refCount ?? pendingAcquisitionsRef.current.get(hostId) ?? 0
    pendingOpensRef.current.cancel(hostId)
    if (options.preserveAcquisitions && acquisitionCount > 0) {
      pendingAcquisitionsRef.current.set(hostId, acquisitionCount)
    } else {
      pendingAcquisitionsRef.current.delete(hostId)
    }
    if (options.forgetPrimedHost) {
      primedHostsRef.current.delete(hostId)
    }
    entry?.unsubState()
    storeRef.current.delete(hostId)
    entry?.client.close()
    notifyHostState(hostId, 'disconnected')
    notifyAllHosts()
  }, [])

  const closeHost = useCallback(
    (hostId: string) => {
      closeEntry(hostId, { forgetPrimedHost: true, preserveAcquisitions: true })
    },
    [closeEntry]
  )

  const openEntry = useCallback(async (hostId: string): Promise<StoreEntry | null> => {
    const existing = pendingOpensRef.current.getActivePromise(hostId)
    if (existing) {
      await existing
      return storeRef.current.get(hostId) ?? null
    }
    let resolve: () => void = () => {}
    const promise = new Promise<void>((res) => {
      resolve = res
    })
    const pendingOpen = pendingOpensRef.current.register(hostId, promise)

    try {
      // Why: prefer the primed cache so we don't serialize a second Keychain pass on cold start.
      let host = primedHostsRef.current.get(hostId)
      if (!host) {
        try {
          const hosts = await loadHosts()
          host = hosts.find((h) => h.id === hostId)
        } catch {
          // Why: cold-start Keychain failure (iOS mid-unlock / Android Keystore race); surface 'disconnected' so the user can Reconnect.
          notifyHostState(hostId, 'disconnected')
          notifyAllHosts()
          return null
        }
        if (!host) {
          // Why: silent return leaves screens on a permanent spinner (STA-1511); surface 'disconnected' so they show a retry affordance.
          notifyHostState(hostId, 'disconnected')
          notifyAllHosts()
          return null
        }
      }

      if (pendingOpen.cancelled) {
        return null
      }

      // Re-check after any await — another acquire() may have completed.
      const after = storeRef.current.get(hostId)
      if (after) {
        return after
      }

      let client: RpcClient
      try {
        client = openHostLogicalClient(host, (entry) => connectionLogStore.append(hostId, entry))
      } catch {
        // Why: openHostLogicalClient can throw synchronously (bad public key / invalid URL); notify so the UI leaves 'connecting'.
        notifyHostState(hostId, 'disconnected')
        notifyAllHosts()
        return null
      }
      const unsubState = client.onStateChange((state) => {
        const cur = storeRef.current.get(hostId)
        if (!cur) {
          return
        }
        cur.state = state
        notifyHostState(hostId, state)
      })
      const entry: StoreEntry = {
        client,
        state: client.getState(),
        refCount: pendingAcquisitionsRef.current.get(hostId) ?? 0,
        unsubState
      }
      pendingAcquisitionsRef.current.delete(hostId)
      storeRef.current.set(hostId, entry)
      notifyHostState(hostId, entry.state)
      notifyAllHosts()
      return entry
    } finally {
      pendingOpensRef.current.deleteIfCurrent(hostId, pendingOpen)
      resolve()
    }
  }, [])

  // Synchronous get-or-open: returns an existing client immediately, else kicks off an async open and returns null this tick.
  const acquire = useCallback(
    (hostId: string, host?: HostProfile): RpcClient | null => {
      if (host) {
        primedHostsRef.current.set(hostId, host)
      }
      const existing = storeRef.current.get(hostId)
      if (existing) {
        existing.refCount += 1
        return existing.client
      }
      pendingAcquisitionsRef.current.set(
        hostId,
        (pendingAcquisitionsRef.current.get(hostId) ?? 0) + 1
      )
      // Trigger async open; returns null this tick — consumers re-call acquire() from an effect that re-runs on state changes.
      void openEntry(hostId)
      return null
    },
    [openEntry]
  )

  const primeHosts = useCallback((hosts: HostProfile[]) => {
    for (const host of hosts) {
      primedHostsRef.current.set(host.id, host)
    }
  }, [])

  // Why: no idle-close on refcount→0 — transient nav gaps flashed false 'disconnected', so keep sockets alive while foregrounded.
  const release = useCallback((hostId: string) => {
    const entry = storeRef.current.get(hostId)
    if (entry) {
      entry.refCount = Math.max(0, entry.refCount - 1)
      return
    }
    decrementPendingAcquisition(pendingAcquisitionsRef.current, hostId)
  }, [])

  const releaseAndCloseIfUnused = useCallback(
    (hostId: string) => {
      const entry = storeRef.current.get(hostId)
      if (entry) {
        entry.refCount = Math.max(0, entry.refCount - 1)
        if (entry.refCount === 0) {
          closeEntry(hostId, { forgetPrimedHost: false, preserveAcquisitions: false })
        }
        return
      }
      if (decrementPendingAcquisition(pendingAcquisitionsRef.current, hostId) === 0) {
        closeEntry(hostId, { forgetPrimedHost: false, preserveAcquisitions: false })
      }
    },
    [closeEntry]
  )

  const closeIfUnused = useCallback(
    (hostId: string) => {
      const entry = storeRef.current.get(hostId)
      const pendingCount = pendingAcquisitionsRef.current.get(hostId)
      const hasPendingOpen = pendingOpensRef.current.getActivePromise(hostId) !== null
      if (!entry && pendingCount === undefined && !hasPendingOpen) {
        return
      }
      if ((entry?.refCount ?? pendingCount ?? 0) === 0) {
        closeEntry(hostId, { forgetPrimedHost: false, preserveAcquisitions: false })
      }
    },
    [closeEntry]
  )

  const forceReconnect = useCallback(
    async (hostId: string) => {
      const entry = storeRef.current.get(hostId)
      // Why: ownership survives explicit close/re-pair while observers never become synthetic owners.
      const savedRefCount = entry?.refCount ?? pendingAcquisitionsRef.current.get(hostId) ?? 0
      if (entry) {
        entry.unsubState()
        entry.client.close()
        storeRef.current.delete(hostId)
      }
      if (savedRefCount > 0) {
        pendingAcquisitionsRef.current.set(
          hostId,
          Math.max(savedRefCount, pendingAcquisitionsRef.current.get(hostId) ?? 0)
        )
      }
      await openEntry(hostId)
    },
    [openEntry]
  )

  const getState = useCallback((hostId: string): ConnectionState => {
    return storeRef.current.get(hostId)?.state ?? 'disconnected'
  }, [])

  const getReconnectAttempt = useCallback((hostId: string): number => {
    return storeRef.current.get(hostId)?.client.getReconnectAttempt() ?? 0
  }, [])

  const getLastConnectedAt = useCallback((hostId: string): number | null => {
    return storeRef.current.get(hostId)?.client.getLastConnectedAt() ?? null
  }, [])

  const getActivePath = useCallback((hostId: string): MobileConnectionPath => {
    return clientActivePath(storeRef.current.get(hostId)?.client)
  }, [])

  const subscribeHostState = useCallback(
    (hostId: string, listener: (state: ConnectionState) => void) => {
      let set = stateListenersRef.current.get(hostId)
      if (!set) {
        set = new Set()
        stateListenersRef.current.set(hostId, set)
      }
      set.add(listener)
      return () => {
        const s = stateListenersRef.current.get(hostId)
        if (!s) {
          return
        }
        s.delete(listener)
        if (s.size === 0) {
          stateListenersRef.current.delete(hostId)
        }
      }
    },
    []
  )

  const getAllClients = useCallback((): Array<{ hostId: string; client: RpcClient }> => {
    const out: Array<{ hostId: string; client: RpcClient }> = []
    for (const [hostId, entry] of storeRef.current) {
      out.push({ hostId, client: entry.client })
    }
    return out
  }, [])

  const subscribeAllHosts = useCallback((listener: () => void) => {
    allHostsListenersRef.current.add(listener)
    return () => {
      allHostsListenersRef.current.delete(listener)
    }
  }, [])

  // Close all clients on provider unmount. Empty deps: [closeEntry] would let Fast Refresh tear down all live sockets.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const store = storeRef.current
    return () => {
      pendingOpensRef.current.cancelAll()
      pendingAcquisitionsRef.current.clear()
      for (const [hostId] of store) {
        closeEntry(hostId, { forgetPrimedHost: true, preserveAcquisitions: false })
      }
    }
  }, [])

  // Why: nudge live clients when the OS signals the link may be back so sessions recover without a restart (issue #5049).
  useEffect(() => {
    return subscribeConnectionRevivalTriggers(() => {
      for (const entry of storeRef.current.values()) {
        entry.client.notifyForeground()
      }
    })
  }, [])

  const value = useMemo<RpcClientContextValue>(
    () => ({
      acquire,
      release,
      releaseAndCloseIfUnused,
      closeIfUnused,
      forceReconnect,
      closeHost,
      getState,
      getReconnectAttempt,
      getLastConnectedAt,
      getActivePath,
      subscribeHostState,
      getAllClients,
      subscribeAllHosts,
      primeHosts
    }),
    [
      acquire,
      release,
      releaseAndCloseIfUnused,
      closeIfUnused,
      forceReconnect,
      closeHost,
      getState,
      getReconnectAttempt,
      getLastConnectedAt,
      getActivePath,
      subscribeHostState,
      getAllClients,
      subscribeAllHosts,
      primeHosts
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRpcClientContext(): RpcClientContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error('useHostClient must be used inside <RpcClientProvider>')
  }
  return ctx
}

// Primary hook for screens: acquires the shared client on mount, releases on unmount, re-renders on state change.
export function useHostClient(hostId: string | undefined): {
  client: RpcClient | null
  state: ConnectionState
} {
  const ctx = useRpcClientContext()
  const [, force] = useState(0)
  const [state, setState] = useState<ConnectionState>(() =>
    hostId ? ctx.getState(hostId) : 'disconnected'
  )
  const clientRef = useRef<RpcClient | null>(null)
  const clientHostIdRef = useRef<string | undefined>(hostId)

  useEffect(() => {
    if (!hostId) {
      clientRef.current = null
      clientHostIdRef.current = undefined
      setState('disconnected')
      return
    }
    clientHostIdRef.current = hostId
    let cancelled = false
    // Subscribe before acquire so any state change during open is captured.
    const unsub = ctx.subscribeHostState(hostId, (next) => {
      if (cancelled) {
        return
      }
      setState(next)
      // Why: async open and forceReconnect swap the client object; re-read each state change so screens never drive a stale one.
      const found = ctx.getAllClients().find((entry) => entry.hostId === hostId)
      if (found && found.client !== clientRef.current) {
        clientRef.current = found.client
        force((n) => n + 1)
      } else if (!found && clientRef.current) {
        // Why: closeHost deletes the entry with no replacement; null it so screens don't drive a dead client (STA-1511).
        clientRef.current = null
        force((n) => n + 1)
      }
    })
    const initial = ctx.acquire(hostId)
    clientRef.current = initial
    setState(ctx.getState(hostId))
    if (initial) {
      // Why: two cached hosts can both be connected, so equal state values cannot reveal the replacement client.
      force((n) => n + 1)
    }
    return () => {
      cancelled = true
      unsub()
      ctx.release(hostId)
      clientRef.current = null
      clientHostIdRef.current = undefined
    }
  }, [ctx, hostId])

  // Why: Expo can reuse the screen before effects bind the next host; never expose the prior host's client or state in that render.
  const bound = clientHostIdRef.current === hostId
  const boundState = bound ? state : hostId ? ctx.getState(hostId) : 'disconnected'
  return { client: bound ? clientRef.current : null, state: boundState }
}

// Why: host-store's removeHost() must close the live client but has no React-side handle; this hook bridges to it.
export function useCloseHost(): (hostId: string) => void {
  const ctx = useRpcClientContext()
  return ctx.closeHost
}

// Why: future-proof "Connection issues — try again" affordance.
export function useForceReconnect(): (hostId: string) => Promise<void> {
  const ctx = useRpcClientContext()
  return ctx.forceReconnect
}

// Why: primes already-loaded HostProfiles so the provider can skip a second loadHosts()/Keychain pass on cold start.
export function usePrimeHosts(): (hosts: HostProfile[]) => void {
  const ctx = useRpcClientContext()
  return ctx.primeHosts
}
