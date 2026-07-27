type ImmediateGlobal = typeof globalThis & {
  setImmediate?: (callback: () => void) => unknown
}

const pendingRendererYields: (() => void)[] = []
let nextRendererYieldIndex = 0
let rendererYieldChannel: MessageChannel | null = null

function isVitestEnvironment(): boolean {
  return typeof process !== 'undefined' && process.env?.VITEST === 'true'
}

function getRendererYieldChannel(): MessageChannel {
  if (!rendererYieldChannel) {
    rendererYieldChannel = new globalThis.MessageChannel()
    rendererYieldChannel.port1.onmessage = () => {
      const resolve = pendingRendererYields[nextRendererYieldIndex]
      if (!resolve) {
        return
      }
      nextRendererYieldIndex += 1
      if (nextRendererYieldIndex === pendingRendererYields.length) {
        pendingRendererYields.length = 0
        nextRendererYieldIndex = 0
      }
      resolve()
    }
  }
  return rendererYieldChannel
}

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    // Vitest fake timers cannot advance MessageChannel tasks.
    if (isVitestEnvironment()) {
      globalThis.setTimeout(resolve, 0)
      return
    }

    const setImmediate = (globalThis as ImmediateGlobal).setImmediate
    if (typeof window === 'undefined' && setImmediate) {
      setImmediate(resolve)
      return
    }

    if (typeof globalThis.MessageChannel === 'function') {
      // Posted tasks avoid Chromium's nested-timer clamp while still yielding to input and paint.
      pendingRendererYields.push(resolve)
      getRendererYieldChannel().port2.postMessage(undefined)
      return
    }

    globalThis.setTimeout(resolve, 0)
  })
}
