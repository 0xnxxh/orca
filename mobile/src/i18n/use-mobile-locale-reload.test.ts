import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

const { localeState, reloadAppAsync } = vi.hoisted(() => ({
  localeState: { current: [{ languageTag: 'es-MX' }] },
  reloadAppAsync: vi.fn<() => Promise<void>>()
}))

vi.mock('expo', () => ({ reloadAppAsync }))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en' }],
  useLocales: () => localeState.current
}))

import { useMobileLocaleReload } from './use-mobile-locale-reload'

describe('useMobileLocaleReload', () => {
  let renderer: ReactTestRenderer | null = null
  let consoleSpy: MockInstance

  function Harness(): null {
    useMobileLocaleReload()
    return null
  }

  beforeEach(() => {
    vi.useFakeTimers()
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    reloadAppAsync.mockReset()
    localeState.current = [{ languageTag: 'es-MX' }]
    const original = console.error
    consoleSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) {
        return
      }
      original(...args)
    })
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
    consoleSpy.mockRestore()
  })

  it('retries when the native reload request rejects', async () => {
    reloadAppAsync.mockRejectedValue(new Error('reload unavailable'))
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    expect(reloadAppAsync).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(reloadAppAsync).toHaveBeenCalledTimes(2)
  })

  it('bounds retries when the native reload keeps rejecting', async () => {
    reloadAppAsync.mockRejectedValue(new Error('reload unavailable'))
    await act(async () => {
      renderer = create(createElement(Harness))
    })

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })
    }

    expect(reloadAppAsync).toHaveBeenCalledTimes(3)

    localeState.current = [{ languageTag: 'ja-JP' }]
    await act(async () => {
      renderer?.update(createElement(Harness))
    })
    expect(reloadAppAsync).toHaveBeenCalledTimes(4)
  })

  it('retries a rejected request after locale preferences change while it is pending', async () => {
    let rejectReload!: (error: Error) => void
    reloadAppAsync.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectReload = reject
        })
    )
    reloadAppAsync.mockResolvedValueOnce(undefined)
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    expect(reloadAppAsync).toHaveBeenCalledTimes(1)

    localeState.current = [{ languageTag: 'ja-JP' }]
    await act(async () => {
      renderer?.update(createElement(Harness))
    })
    await act(async () => {
      rejectReload(new Error('reload unavailable'))
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(reloadAppAsync).toHaveBeenCalledTimes(2)
  })
})
