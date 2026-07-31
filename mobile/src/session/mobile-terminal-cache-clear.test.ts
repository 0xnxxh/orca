import { describe, expect, it, vi } from 'vitest'
import { clearMobileTerminalCache } from './mobile-terminal-cache-clear'

describe('clearMobileTerminalCache', () => {
  it('clears exact parked WebView lifecycle state and subscriptions', () => {
    const unsubscribe = vi.fn()
    const clearTerminal = vi.fn()
    const clearNativeChatInputLease = vi.fn()
    const onClear = vi.fn()
    let keyboardMetrics = new Map([['terminal', { height: 1 }]])
    const refs = {
      subscriptionsRef: { current: new Map([['terminal', unsubscribe]]) },
      subscribingRef: { current: new Set(['terminal']) },
      initializedRef: { current: new Set(['terminal']) },
      webReadyRef: { current: new Set(['terminal']) },
      subscribeSequenceRef: { current: new Map([['terminal', 4]]) },
      layoutSeqRef: { current: new Map([['terminal', 8]]) },
      cwdRef: { current: new Map([['terminal', '/repo']]) },
      terminalRefs: { current: new Map([['terminal', { clear: clearTerminal }]]) }
    }

    clearMobileTerminalCache({
      ...refs,
      clearNativeChatInputLease,
      diagnostics: { clearTerminalCache: onClear },
      setKeyboardMetrics: (update) => {
        keyboardMetrics = update(keyboardMetrics)
      }
    })

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(clearNativeChatInputLease).toHaveBeenCalledOnce()
    expect(clearTerminal).toHaveBeenCalledOnce()
    expect(onClear).toHaveBeenCalledOnce()
    expect(keyboardMetrics.size).toBe(0)
    const { terminalRefs: retainedTerminalRefs, ...clearedRefs } = refs
    for (const ref of Object.values(clearedRefs)) {
      expect(ref.current.size).toBe(0)
    }
    expect(retainedTerminalRefs.current.size).toBe(1)
  })
})
