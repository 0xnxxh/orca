import { useCallback, useLayoutEffect, useRef } from 'react'
import type { TerminalWebViewHandle } from '../terminal/terminal-webview-contract'

type FitDimensions = NonNullable<Awaited<ReturnType<TerminalWebViewHandle['measureFitDimensions']>>>

export function useMobileTerminalWebViewReadiness(args: {
  handleReady: (
    handle: string,
    deps: {
      measureViewport: (handle: string) => Promise<void>
      notifyNativeChat: (handle: string, wasAlreadyReady: boolean) => void
      subscribe: (handle: string) => void
      unsubscribe: (handle: string) => void
    }
  ) => void
  getRef: (handle: string) => TerminalWebViewHandle | null | undefined
  frameHeightRef: { current: number }
  viewportMeasuredRef: { current: boolean }
  viewportRef: { current: FitDimensions | null }
  onViewportMeasured: (
    handle: string,
    dimensions: FitDimensions | null,
    frameHeight: number
  ) => void
  notifyNativeChat: (handle: string, wasAlreadyReady: boolean) => void
  subscribe: (handle: string) => void
  unsubscribe: (handle: string) => void
}): (handle: string) => void {
  const argsRef = useRef(args)
  useLayoutEffect(() => {
    argsRef.current = args
  }, [args])
  const measureViewportOnce = useCallback(async (handle: string) => {
    const current = argsRef.current
    if (current.viewportMeasuredRef.current) {
      return
    }
    const frameHeight = current.frameHeightRef.current
    const dimensions = await current.getRef(handle)?.measureFitDimensions(frameHeight || undefined)
    current.onViewportMeasured(handle, dimensions ?? null, frameHeight)
    if (dimensions) {
      current.viewportRef.current = dimensions
      current.viewportMeasuredRef.current = true
    }
  }, [])

  return useCallback(
    (handle: string) => {
      const current = argsRef.current
      current.handleReady(handle, {
        measureViewport: measureViewportOnce,
        notifyNativeChat: current.notifyNativeChat,
        subscribe: current.subscribe,
        unsubscribe: current.unsubscribe
      })
    },
    [measureViewportOnce]
  )
}
