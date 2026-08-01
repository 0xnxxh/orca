import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

const { locales, reloadAppAsync } = vi.hoisted(() => ({
  locales: [{ languageTag: 'es-MX' }],
  reloadAppAsync: vi.fn<() => Promise<void>>()
}))

vi.mock('expo', () => ({ reloadAppAsync }))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en' }],
  useLocales: () => locales
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
})
