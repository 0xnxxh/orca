import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  settleTeardownWithinDeadline,
  WILL_QUIT_TEARDOWN_DEADLINE_MS
} from './quit-teardown-deadline'

describe('settleTeardownWithinDeadline', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves as soon as all teardowns settle, including rejections', async () => {
    vi.useFakeTimers()
    let resolved = false
    const pending = settleTeardownWithinDeadline([
      Promise.resolve(),
      Promise.reject(new Error('daemon disconnect failed'))
    ]).then(() => {
      resolved = true
    })
    await vi.advanceTimersByTimeAsync(0)
    await pending
    expect(resolved).toBe(true)
  })

  it('resolves at the deadline when a teardown never settles', async () => {
    vi.useFakeTimers()
    let resolved = false
    const pending = settleTeardownWithinDeadline([new Promise(() => {})]).then(() => {
      resolved = true
    })
    await vi.advanceTimersByTimeAsync(WILL_QUIT_TEARDOWN_DEADLINE_MS - 1)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(resolved).toBe(true)
  })

  // Why: pin the magnitude so the wedge escape hatch cannot be silently
  // shrunk below checkpoint-write time or grown past user patience.
  it('keeps the deadline within the checkpoint-safe window', () => {
    expect(WILL_QUIT_TEARDOWN_DEADLINE_MS).toBeGreaterThanOrEqual(10_000)
    expect(WILL_QUIT_TEARDOWN_DEADLINE_MS).toBeLessThanOrEqual(30_000)
  })
})
