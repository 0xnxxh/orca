import { describe, expect, it, vi } from 'vitest'
import { evictMobileTerminalHotSetPane } from './mobile-terminal-hot-set-eviction'

describe('evictMobileTerminalHotSetPane', () => {
  it('clears only the evicted pane lifecycle and selection state', () => {
    const unsubscribe = vi.fn()
    const setSelectionActive = vi.fn()
    const timer = setTimeout(vi.fn(), 60_000)
    let keyboardMetrics = new Map([
      ['evicted', { cursorY: 1, rows: 10, altScreen: false }],
      ['retained', { cursorY: 2, rows: 20, altScreen: false }]
    ])
    const state = {
      unsubscribe,
      webReadyRef: { current: new Set(['evicted', 'retained']) },
      initializedRef: { current: new Set(['evicted', 'retained']) },
      layoutSeqRef: {
        current: new Map([
          ['evicted', 1],
          ['retained', 2]
        ])
      },
      terminalRefs: {
        current: new Map([
          ['evicted', {}],
          ['retained', {}]
        ])
      },
      subscribingRef: { current: new Set(['evicted', 'retained']) },
      gestureBucketsRef: { current: new Map([['evicted', {}]]) },
      gestureQueuesRef: { current: new Map([['evicted', { timer }]]) },
      gestureInFlightRef: { current: new Map([['evicted', {}]]) },
      selectionHandleRef: { current: 'evicted' as string | null },
      setSelectionActive,
      setKeyboardMetrics: (
        update: (previous: typeof keyboardMetrics) => typeof keyboardMetrics
      ) => {
        keyboardMetrics = update(keyboardMetrics)
      }
    }

    evictMobileTerminalHotSetPane(state, 'evicted')

    expect(unsubscribe).toHaveBeenCalledWith('evicted')
    expect(setSelectionActive).toHaveBeenCalledWith(false)
    expect(state.selectionHandleRef.current).toBeNull()
    expect(keyboardMetrics.has('evicted')).toBe(false)
    expect(keyboardMetrics.has('retained')).toBe(true)
    for (const ref of [
      state.webReadyRef,
      state.initializedRef,
      state.layoutSeqRef,
      state.terminalRefs,
      state.subscribingRef
    ]) {
      expect(ref.current.has('evicted')).toBe(false)
      expect(ref.current.has('retained')).toBe(true)
    }
    expect(state.gestureBucketsRef.current.has('evicted')).toBe(false)
    expect(state.gestureQueuesRef.current.has('evicted')).toBe(false)
    expect(state.gestureInFlightRef.current.has('evicted')).toBe(false)
  })
})
