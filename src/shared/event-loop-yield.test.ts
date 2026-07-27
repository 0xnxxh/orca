import { afterEach, describe, expect, it, vi } from 'vitest'
import { yieldToEventLoop } from './event-loop-yield'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('yieldToEventLoop', () => {
  it('uses setImmediate in Node runtimes', async () => {
    const scheduleImmediate = vi.fn((callback: () => void) => queueMicrotask(callback))
    vi.stubEnv('VITEST', 'false')
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('setImmediate', scheduleImmediate)

    await yieldToEventLoop()

    expect(scheduleImmediate).toHaveBeenCalledOnce()
  })

  it('posts one macrotask per renderer yield', async () => {
    const postMessage = vi.fn()
    vi.stubEnv('VITEST', 'false')
    vi.stubGlobal('window', {})
    vi.stubGlobal(
      'MessageChannel',
      class {
        port1: { onmessage: ((event: MessageEvent) => void) | null } = { onmessage: null }
        port2 = {
          postMessage: (data: unknown): void => {
            postMessage(data)
            queueMicrotask(() => this.port1.onmessage?.({ data } as MessageEvent))
          }
        }
      }
    )

    await Promise.all([yieldToEventLoop(), yieldToEventLoop()])

    expect(postMessage).toHaveBeenCalledTimes(2)
  })
})
