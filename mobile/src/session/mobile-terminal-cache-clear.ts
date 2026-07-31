import type { TerminalKeyboardAvoidanceMetrics } from '../terminal/terminal-webview-contract'

type MutableRef<T> = { current: T }

export function clearMobileTerminalCache(args: {
  clearNativeChatInputLease: () => unknown
  subscriptionsRef: MutableRef<Map<string, () => void>>
  subscribingRef: MutableRef<Set<string>>
  initializedRef: MutableRef<Set<string>>
  webReadyRef: MutableRef<Set<string>>
  subscribeSequenceRef: MutableRef<Map<string, number>>
  layoutSeqRef: MutableRef<Map<string, number>>
  cwdRef: MutableRef<Map<string, string>>
  terminalRefs: MutableRef<ReadonlyMap<string, { clear: () => void }>>
  setKeyboardMetrics: (
    update: (
      previous: Map<string, TerminalKeyboardAvoidanceMetrics>
    ) => Map<string, TerminalKeyboardAvoidanceMetrics>
  ) => void
  diagnostics: { clearTerminalCache: () => void }
}): void {
  args.subscriptionsRef.current.forEach((unsubscribe) => unsubscribe())
  args.clearNativeChatInputLease()
  args.subscriptionsRef.current.clear()
  args.subscribingRef.current.clear()
  args.initializedRef.current.clear()
  args.diagnostics.clearTerminalCache()
  args.webReadyRef.current.clear()
  args.subscribeSequenceRef.current.clear()
  args.layoutSeqRef.current.clear()
  args.cwdRef.current.clear()
  args.setKeyboardMetrics(() => new Map())
  for (const terminal of args.terminalRefs.current.values()) {
    terminal.clear()
  }
}
