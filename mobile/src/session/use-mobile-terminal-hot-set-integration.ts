import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { ConnectionState } from '../transport/types'
import type {
  TerminalKeyboardAvoidanceMetrics,
  TerminalWebViewHandle
} from '../terminal/terminal-webview-contract'
import {
  recordMobileTerminalColdRevealBoundary,
  recordMobileTerminalHotSetFailOpen,
  type MobileTerminalColdRevealBoundary
} from './mobile-terminal-hot-set-diagnostics'
import { clearMobileTerminalCache } from './mobile-terminal-cache-clear'
import {
  evictMobileTerminalHotSetPane,
  type MobileTerminalHotSetEvictionState
} from './mobile-terminal-hot-set-eviction'
import {
  MOBILE_TERMINAL_HOT_SET_ENABLED,
  isAdmissibleMobileTerminalColdScrollback,
  useMobileTerminalHotSet
} from './use-mobile-terminal-hot-set'
import { settleMobileTerminalColdRenderReady } from './mobile-terminal-cold-render-readiness'
import { getMobileTerminalHotSetRouteSafetyFailure } from './mobile-terminal-hot-set-route-safety'

type MutableRef<T> = { current: T }

export function useMobileTerminalHotSetIntegration(args: {
  scopeKey: string
  handles: readonly string[]
  activeHandle: string | null
  activeTerminalHandleExpected: boolean
  activeHandleRef: MutableRef<string | null>
  pendingActiveHandleRef: MutableRef<string | null>
  connectionState: ConnectionState
  unsubscribe: (handle: string) => void
  webReadyRef: MutableRef<Set<string>>
  initializedRef: MutableRef<Set<string>>
  layoutSeqRef: MutableRef<Map<string, number>>
  terminalRefs: MutableRef<Map<string, TerminalWebViewHandle>>
  subscribingRef: MutableRef<Set<string>>
  subscriptionsRef: MutableRef<Map<string, () => void>>
  subscribeSequenceRef: MutableRef<Map<string, number>>
  cwdRef: MutableRef<Map<string, string>>
  gestureBucketsRef: MobileTerminalHotSetEvictionState['gestureBucketsRef']
  gestureQueuesRef: MobileTerminalHotSetEvictionState['gestureQueuesRef']
  gestureInFlightRef: MobileTerminalHotSetEvictionState['gestureInFlightRef']
  selectionHandleRef: MutableRef<string | null>
  setSelectionActive: (active: boolean) => void
  setKeyboardMetrics: (
    update: (
      previous: Map<string, TerminalKeyboardAvoidanceMetrics>
    ) => Map<string, TerminalKeyboardAvoidanceMetrics>
  ) => void
  diagnostics: {
    clearTerminalCache: () => void
    webViewRef: (handle: string, attached: boolean) => void
    webViewReady: (handle: string, reload: boolean, isActive: boolean) => void
  }
  clearNativeChatInputLease: () => unknown
}) {
  const argsRef = useRef(args)
  useLayoutEffect(() => {
    argsRef.current = args
  }, [args])
  const clearTerminalCache = useCallback(() => {
    clearMobileTerminalCache(argsRef.current)
  }, [])
  const handleEviction = useCallback((handle: string) => {
    evictMobileTerminalHotSetPane(argsRef.current, handle)
  }, [])
  const initialScopeRef = useRef(args.scopeKey)
  const routeSafetyFailure = getMobileTerminalHotSetRouteSafetyFailure({
    initialScopeKey: initialScopeRef.current,
    scopeKey: args.scopeKey,
    handles: args.handles,
    activeHandle: args.activeHandle,
    activeTerminalHandleExpected: args.activeTerminalHandleExpected
  })
  const connectionFailure = args.connectionState === 'connected' ? null : 'connection-uncertain'
  const admissibilityFailure = routeSafetyFailure ?? connectionFailure
  const {
    acceptsStreamEvent,
    coldRevealRevision,
    completeColdReveal,
    failOpen,
    failOpenReason,
    mountedHandles
  } = useMobileTerminalHotSet({
    scopeKey: args.scopeKey,
    featureEnabled: MOBILE_TERMINAL_HOT_SET_ENABLED,
    connectionAdmissible: admissibilityFailure == null,
    inadmissibleReason: admissibilityFailure,
    handles: args.handles,
    activeHandle: args.activeHandle,
    onEvict: handleEviction
  })
  const activationLoggedRef = useRef<string | null>(null)
  useEffect(() => {
    const handle = args.activeHandle
    if (!handle) {
      return
    }
    const revision = coldRevealRevision(handle)
    if (revision == null) {
      return
    }
    const key = `${handle}:${revision}`
    if (activationLoggedRef.current === key) {
      return
    }
    activationLoggedRef.current = key
    recordMobileTerminalColdRevealBoundary(handle, revision, 'activation')
  }, [args.activeHandle, coldRevealRevision])
  useEffect(() => {
    recordMobileTerminalHotSetFailOpen(failOpenReason)
  }, [failOpenReason])
  const recordBoundary = useCallback(
    (handle: string, boundary: MobileTerminalColdRevealBoundary) => {
      const revision = coldRevealRevision(handle)
      if (revision != null) {
        recordMobileTerminalColdRevealBoundary(handle, revision, boundary)
      }
      return revision
    },
    [coldRevealRevision]
  )
  const admitScrollback = useCallback(
    (handle: string, data: Readonly<Record<string, unknown>>) => {
      const revision = recordBoundary(handle, 'first-scrollback')
      if (revision != null && !isAdmissibleMobileTerminalColdScrollback(data)) {
        failOpen('invalid-cold-scrollback')
        return null
      }
      return revision
    },
    [failOpen, recordBoundary]
  )
  const terminateColdStream = useCallback(
    (handle: string, reason: string) => {
      if (coldRevealRevision(handle) != null) {
        failOpen(reason)
      }
    },
    [coldRevealRevision, failOpen]
  )
  const handlePaneMounted = useCallback(
    (handle: string) => {
      recordBoundary(handle, 'webview-mount')
    },
    [recordBoundary]
  )
  const handleEngineError = useCallback(
    (handle: string) => {
      if (coldRevealRevision(handle) != null) {
        failOpen('cold-webview-readiness')
      }
    },
    [coldRevealRevision, failOpen]
  )
  const completeRenderReadyAfterInit = useCallback(
    (handle: string, ref: TerminalWebViewHandle, initGeneration: number) => {
      const revision = coldRevealRevision(handle)
      const sequence = argsRef.current.subscribeSequenceRef.current.get(handle)
      if (revision == null || sequence == null) {
        return
      }
      void settleMobileTerminalColdRenderReady({
        handle,
        revision,
        sequence,
        ref,
        initGeneration,
        getRevision: coldRevealRevision,
        getSequence: (candidate) => argsRef.current.subscribeSequenceRef.current.get(candidate),
        acceptsStreamEvent,
        getRef: (candidate) => argsRef.current.terminalRefs.current.get(candidate),
        complete: completeColdReveal,
        onTimeout: () => failOpen('cold-render-ready-timeout'),
        onReady: () => {
          recordMobileTerminalColdRevealBoundary(handle, revision, 'init-ready')
          recordMobileTerminalColdRevealBoundary(handle, revision, 'render-ready')
        }
      })
    },
    [acceptsStreamEvent, coldRevealRevision, completeColdReveal, failOpen]
  )
  const handleWebReady = useCallback(
    (
      handle: string,
      deps: {
        measureViewport: (handle: string) => Promise<void>
        notifyNativeChat: (handle: string, wasAlreadyReady: boolean) => void
        subscribe: (handle: string) => void
        unsubscribe: (handle: string) => void
      }
    ) => {
      const current = argsRef.current
      const wasAlreadyReady = current.webReadyRef.current.has(handle)
      current.webReadyRef.current.add(handle)
      deps.notifyNativeChat(handle, wasAlreadyReady)
      current.diagnostics.webViewReady(
        handle,
        wasAlreadyReady,
        handle === current.activeHandleRef.current
      )
      recordBoundary(handle, 'webview-ready')
      if (wasAlreadyReady && current.initializedRef.current.has(handle)) {
        deps.unsubscribe(handle)
        current.initializedRef.current.delete(handle)
        if (handle === current.activeHandleRef.current) {
          deps.subscribe(handle)
        }
        return
      }
      const isIntendedActive = () =>
        handle === current.activeHandleRef.current ||
        handle === current.pendingActiveHandleRef.current
      if (isIntendedActive() && !current.subscriptionsRef.current.has(handle)) {
        void deps.measureViewport(handle).then(() => {
          if (isIntendedActive() && !current.subscriptionsRef.current.has(handle)) {
            deps.subscribe(handle)
          }
        })
      }
    },
    [recordBoundary]
  )
  const setWebViewRef = useCallback((handle: string, ref: TerminalWebViewHandle | null) => {
    const current = argsRef.current
    current.diagnostics.webViewRef(handle, ref != null)
    if (ref) {
      current.terminalRefs.current.set(handle, ref)
      return
    }
    current.terminalRefs.current.delete(handle)
    current.gestureBucketsRef.current.delete(handle)
    const queued = current.gestureQueuesRef.current.get(handle)
    if (queued?.timer) {
      clearTimeout(queued.timer)
    }
    current.gestureQueuesRef.current.delete(handle)
    current.gestureInFlightRef.current.delete(handle)
  }, [])

  return {
    acceptsStreamEvent,
    clearTerminalCache,
    mountedHandles,
    admitScrollback,
    completeRenderReadyAfterInit,
    handleEngineError,
    handlePaneMounted,
    handleWebReady,
    recordBoundary,
    setWebViewRef,
    terminateColdStream
  }
}
