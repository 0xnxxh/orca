import { Suspense, createElement, useLayoutEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMobileTerminalWebViewReadiness } from './use-mobile-terminal-webview-readiness'

const NEVER_RESOLVES = new Promise<void>(() => {})

function Harness(props: {
  onCommitted: (ready: (handle: string) => void) => void
  subscribe: (handle: string) => void
  suspend: boolean
}) {
  const ready = useMobileTerminalWebViewReadiness({
    handleReady: (handle, deps) => deps.subscribe(handle),
    getRef: () => null,
    frameHeightRef: { current: 0 },
    viewportMeasuredRef: { current: false },
    viewportRef: { current: null },
    onViewportMeasured: vi.fn(),
    notifyNativeChat: vi.fn(),
    subscribe: props.subscribe,
    unsubscribe: vi.fn()
  })
  useLayoutEffect(() => {
    props.onCommitted(ready)
  }, [props, ready])
  if (props.suspend) {
    throw NEVER_RESOLVES
  }
  return null
}

describe('useMobileTerminalWebViewReadiness', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    renderer?.unmount()
    renderer = null
  })

  it('does not publish callbacks from an aborted Suspense render', async () => {
    const committedSubscribe = vi.fn()
    const abortedSubscribe = vi.fn()
    let committedReady!: (handle: string) => void
    const render = (suspend: boolean, subscribe: (handle: string) => void) =>
      createElement(
        Suspense,
        { fallback: null },
        createElement(Harness, {
          onCommitted: (ready) => {
            committedReady = ready
          },
          subscribe,
          suspend
        })
      )

    await act(() => {
      renderer = create(render(false, committedSubscribe))
    })
    committedReady('first')

    await act(() => {
      renderer?.update(render(true, abortedSubscribe))
    })
    committedReady('after-abort')

    expect(committedSubscribe).toHaveBeenCalledWith('first')
    expect(committedSubscribe).toHaveBeenCalledWith('after-abort')
    expect(abortedSubscribe).not.toHaveBeenCalled()
  })
})
