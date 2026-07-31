import type { TerminalKeyboardAvoidanceMetrics } from '../terminal/terminal-webview-contract'
import { recordMobileTerminalHotSetEviction } from './mobile-terminal-hot-set-diagnostics'

type MutableRef<T> = { current: T }
type DeleteRef = MutableRef<{ delete: (handle: string) => unknown }>
type PendingQueueRef = MutableRef<Map<string, { timer?: ReturnType<typeof setTimeout> | null }>>

export type MobileTerminalHotSetEvictionState = {
  unsubscribe: (handle: string) => void
  webReadyRef: MutableRef<Set<string>>
  initializedRef: MutableRef<Set<string>>
  layoutSeqRef: MutableRef<Map<string, number>>
  terminalRefs: DeleteRef
  subscribingRef: MutableRef<Set<string>>
  gestureBucketsRef: DeleteRef
  gestureQueuesRef: PendingQueueRef
  gestureInFlightRef: DeleteRef
  selectionHandleRef: MutableRef<string | null>
  setSelectionActive: (active: boolean) => void
  setKeyboardMetrics: (
    update: (
      previous: Map<string, TerminalKeyboardAvoidanceMetrics>
    ) => Map<string, TerminalKeyboardAvoidanceMetrics>
  ) => void
}

export function evictMobileTerminalHotSetPane(
  state: MobileTerminalHotSetEvictionState,
  handle: string
): void {
  state.unsubscribe(handle)
  state.webReadyRef.current.delete(handle)
  state.initializedRef.current.delete(handle)
  state.layoutSeqRef.current.delete(handle)
  state.terminalRefs.current.delete(handle)
  state.subscribingRef.current.delete(handle)
  state.gestureBucketsRef.current.delete(handle)
  const queued = state.gestureQueuesRef.current.get(handle)
  if (queued?.timer) {
    clearTimeout(queued.timer)
  }
  state.gestureQueuesRef.current.delete(handle)
  state.gestureInFlightRef.current.delete(handle)
  if (state.selectionHandleRef.current === handle) {
    state.selectionHandleRef.current = null
    state.setSelectionActive(false)
  }
  state.setKeyboardMetrics((previous) => {
    if (!previous.has(handle)) {
      return previous
    }
    const next = new Map(previous)
    next.delete(handle)
    return next
  })
  recordMobileTerminalHotSetEviction(handle)
}
