import { describe, expect, it, vi } from 'vitest'
import { subscribeToMacosTccPromptNotice } from './macos-tcc-prompt-notice-subscription'

describe('subscribeToMacosTccPromptNotice', () => {
  it('delivers a threshold retained before the renderer subscribed', async () => {
    const onNotice = vi.fn()
    const acknowledgePending = vi.fn().mockResolvedValue(undefined)
    const unsubscribe = subscribeToMacosTccPromptNotice(
      {
        acknowledgePending,
        consumePending: vi.fn().mockResolvedValue({ claimId: 7, promptCount: 3 }),
        onThreshold: vi.fn(() => vi.fn())
      },
      onNotice
    )

    await Promise.resolve()

    expect(onNotice).toHaveBeenCalledWith({ promptCount: 3 })
    expect(acknowledgePending).toHaveBeenCalledWith(7)
    expect(onNotice.mock.invocationCallOrder[0]).toBeLessThan(
      acknowledgePending.mock.invocationCallOrder[0]
    )
    unsubscribe()
  })

  it('consumes concurrent mount and live signals only once', async () => {
    const listenerState: { listener?: (payload: { promptCount: number }) => void } = {}
    const acknowledgePending = vi.fn().mockResolvedValue(undefined)
    const consumePending = vi
      .fn()
      .mockResolvedValueOnce({ claimId: 8, promptCount: 3 })
      .mockResolvedValue(null)
    const onNotice = vi.fn()
    const unsubscribe = subscribeToMacosTccPromptNotice(
      {
        acknowledgePending,
        consumePending,
        onThreshold: (listener) => {
          listenerState.listener = listener
          return vi.fn()
        }
      },
      onNotice
    )

    listenerState.listener?.({ promptCount: 3 })
    await Promise.resolve()

    expect(consumePending).toHaveBeenCalledTimes(2)
    expect(onNotice).toHaveBeenCalledOnce()
    expect(acknowledgePending).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('finishes an in-flight claim through StrictMode cleanup', async () => {
    const pendingState: {
      resolve?: (payload: { claimId: number; promptCount: number } | null) => void
    } = {}
    const onNotice = vi.fn()
    const acknowledgePending = vi.fn().mockResolvedValue(undefined)
    const unsubscribe = subscribeToMacosTccPromptNotice(
      {
        acknowledgePending,
        consumePending: () =>
          new Promise((resolve) => {
            pendingState.resolve = resolve
          })
      },
      onNotice
    )

    unsubscribe()
    pendingState.resolve?.({ claimId: 9, promptCount: 3 })
    await Promise.resolve()

    expect(onNotice).toHaveBeenCalledOnce()
    expect(acknowledgePending).toHaveBeenCalledWith(9)
  })

  it('keeps live delivery with an older preload that has no consume API', () => {
    const listenerState: { listener?: (payload: { promptCount: number }) => void } = {}
    const onNotice = vi.fn()
    const unsubscribe = subscribeToMacosTccPromptNotice(
      {
        onThreshold: (listener) => {
          listenerState.listener = listener
          return vi.fn()
        }
      },
      onNotice
    )

    listenerState.listener?.({ promptCount: 3 })

    expect(onNotice).toHaveBeenCalledWith({ promptCount: 3 })
    unsubscribe()
  })
})
