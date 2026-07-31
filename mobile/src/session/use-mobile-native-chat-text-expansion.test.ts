import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useMobileNativeChatTextExpansion,
  type MobileNativeChatTextExpansion
} from './use-mobile-native-chat-text-expansion'

const first = { recordOffset: 10, blockIndex: 0, originalChars: 5000 }
const second = { recordOffset: 20, blockIndex: 1, originalChars: 6000 }

describe('useMobileNativeChatTextExpansion', () => {
  let renderer: ReactTestRenderer | null = null
  let expansion: MobileNativeChatTextExpansion | null = null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    expansion = null
  })

  function Harness({ load }: { load: () => Promise<string> }): null {
    expansion = useMobileNativeChatTextExpansion(load)
    return null
  }

  async function mount(load: () => Promise<string>): Promise<void> {
    const original = console.error
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) {
        return
      }
      original(...args)
    })
    try {
      await act(async () => {
        renderer = create(createElement(Harness, { load }))
      })
    } finally {
      spy.mockRestore()
    }
  }

  it('caches one full block and re-expands it without another read', async () => {
    const load = vi.fn().mockResolvedValue('full first')
    await mount(load)

    await act(async () => {
      expansion?.toggle('message', first)
      await Promise.resolve()
    })
    expect(expansion?.cached?.text).toBe('full first')
    expect(expansion?.expandedKey).toBe(expansion?.cached?.key)

    act(() => expansion?.toggle('message', first))
    expect(expansion?.expandedKey).toBeNull()
    act(() => expansion?.toggle('message', first))

    expect(expansion?.expandedKey).toBe(expansion?.cached?.key)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('replaces the cache instead of retaining every expanded message', async () => {
    const load = vi.fn().mockResolvedValueOnce('full first').mockResolvedValueOnce('full second')
    await mount(load)
    await act(async () => {
      expansion?.toggle('message-1', first)
      await Promise.resolve()
    })
    await act(async () => {
      expansion?.toggle('message-2', second)
      await Promise.resolve()
    })

    expect(expansion?.cached).toMatchObject({ text: 'full second' })
    expect(JSON.stringify(expansion)).not.toContain('full first')
  })

  it('clears retained text and ignores an old read when the session loader changes', async () => {
    let resolveFirst: (text: string) => void = () => {}
    const loadFirst = vi.fn(() => new Promise<string>((resolve) => (resolveFirst = resolve)))
    const loadSecond = vi.fn().mockResolvedValue('new session')
    await mount(loadFirst)
    act(() => expansion?.toggle('message-1', first))

    await act(async () => renderer?.update(createElement(Harness, { load: loadSecond })))
    await act(async () => {
      resolveFirst('stale session')
      await Promise.resolve()
    })

    expect(expansion?.cached).toBeNull()
    expect(expansion?.expandedKey).toBeNull()
  })
})
