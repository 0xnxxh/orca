import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startPtyPromptReadinessProbe } from './pty-prompt-readiness-probe'

const GRACE_MS = 500
const INTERVAL_MS = 100

describe('startPtyPromptReadinessProbe', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function start(probe: () => Promise<'line-editor' | 'cooked' | 'unknown'>) {
    const onPromptReady = vi.fn()
    const stop = startPtyPromptReadinessProbe({
      probe,
      onPromptReady,
      graceMs: GRACE_MS,
      intervalMs: INTERVAL_MS
    })
    return { onPromptReady, stop }
  }

  it('does not probe at all during the grace window', async () => {
    const probe = vi.fn().mockResolvedValue('line-editor')
    const { onPromptReady } = start(probe)

    await vi.advanceTimersByTimeAsync(GRACE_MS - 1)

    expect(probe).not.toHaveBeenCalled()
    expect(onPromptReady).not.toHaveBeenCalled()
  })

  it('reports ready once the line editor has taken the tty', async () => {
    const probe = vi.fn().mockResolvedValue('line-editor')
    const { onPromptReady } = start(probe)

    await vi.advanceTimersByTimeAsync(GRACE_MS)

    expect(onPromptReady).toHaveBeenCalledTimes(1)
  })

  it('keeps polling while the slave is still in cooked mode', async () => {
    const probe = vi
      .fn()
      .mockResolvedValueOnce('cooked')
      .mockResolvedValueOnce('cooked')
      .mockResolvedValue('line-editor')
    const { onPromptReady } = start(probe)

    await vi.advanceTimersByTimeAsync(GRACE_MS)
    expect(onPromptReady).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2)
    expect(onPromptReady).toHaveBeenCalledTimes(1)
  })

  it('never reports ready on an undetermined probe', async () => {
    const probe = vi.fn().mockResolvedValue('unknown')
    const { onPromptReady } = start(probe)

    await vi.advanceTimersByTimeAsync(GRACE_MS + INTERVAL_MS * 10)

    expect(probe.mock.calls.length).toBeGreaterThan(1)
    expect(onPromptReady).not.toHaveBeenCalled()
  })

  it('fires only once even as polling continues', async () => {
    const probe = vi.fn().mockResolvedValue('line-editor')
    const { onPromptReady } = start(probe)

    await vi.advanceTimersByTimeAsync(GRACE_MS + INTERVAL_MS * 10)

    expect(onPromptReady).toHaveBeenCalledTimes(1)
  })

  it('keeps polling instead of crashing when the probe rejects', async () => {
    const probe = vi
      .fn()
      .mockRejectedValueOnce(new Error('stty: fork failed'))
      .mockResolvedValue('line-editor')
    const { onPromptReady } = start(probe)

    await vi.advanceTimersByTimeAsync(GRACE_MS)
    expect(onPromptReady).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(INTERVAL_MS)
    expect(onPromptReady).toHaveBeenCalledTimes(1)
  })

  it('does not raise an unhandled rejection when onPromptReady throws', async () => {
    const probe = vi.fn().mockResolvedValue('line-editor')
    const onPromptReady = vi.fn(() => {
      throw new Error('teardown raced the probe')
    })
    startPtyPromptReadinessProbe({
      probe,
      onPromptReady,
      graceMs: GRACE_MS,
      intervalMs: INTERVAL_MS
    })

    await expect(vi.advanceTimersByTimeAsync(GRACE_MS + INTERVAL_MS * 2)).resolves.not.toThrow()
    expect(onPromptReady).toHaveBeenCalledTimes(1)
  })

  it('stops polling after stop()', async () => {
    const probe = vi.fn().mockResolvedValue('cooked')
    const { onPromptReady, stop } = start(probe)

    await vi.advanceTimersByTimeAsync(GRACE_MS)
    const callsBeforeStop = probe.mock.calls.length
    stop()
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 10)

    expect(probe.mock.calls.length).toBe(callsBeforeStop)
    expect(onPromptReady).not.toHaveBeenCalled()
  })

  it('does not report ready when stopped while a probe is in flight', async () => {
    const pending: { resolve?: (state: 'line-editor') => void } = {}
    const probe = vi.fn(
      () =>
        new Promise<'line-editor'>((resolve) => {
          pending.resolve = resolve
        })
    )
    const { onPromptReady, stop } = start(probe)

    await vi.advanceTimersByTimeAsync(GRACE_MS)
    expect(pending.resolve).toBeDefined()

    stop()
    pending.resolve?.('line-editor')
    await vi.advanceTimersByTimeAsync(INTERVAL_MS)

    expect(onPromptReady).not.toHaveBeenCalled()
  })
})
