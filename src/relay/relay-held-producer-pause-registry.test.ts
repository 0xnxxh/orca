import { describe, expect, it, vi } from 'vitest'
import { RelayHeldProducerPauseRegistry } from './relay-held-producer-pause-registry'

describe('RelayHeldProducerPauseRegistry', () => {
  it('pauses on the first token and resumes after the last token', () => {
    const pause = vi.fn()
    const resume = vi.fn()
    const registry = new RelayHeldProducerPauseRegistry({
      resolveIncarnation: () => 'incarnation-1',
      pause,
      resume
    })

    expect(registry.set('pty-1', 'incarnation-1', 'token-1', true)).toBe(true)
    expect(registry.set('pty-1', 'incarnation-1', 'token-2', true)).toBe(true)
    expect(registry.set('pty-1', 'incarnation-1', 'token-1', true)).toBe(true)
    expect(pause).toHaveBeenCalledOnce()

    expect(registry.set('pty-1', 'incarnation-1', 'token-1', false)).toBe(true)
    expect(resume).not.toHaveBeenCalled()
    expect(registry.set('pty-1', 'incarnation-1', 'token-2', false)).toBe(true)
    expect(resume).toHaveBeenCalledOnce()
  })

  it('rejects stale incarnations and makes repeated release idempotent', () => {
    const resume = vi.fn()
    let incarnation = 'incarnation-1'
    const registry = new RelayHeldProducerPauseRegistry({
      resolveIncarnation: () => incarnation,
      pause: vi.fn(),
      resume
    })
    registry.set('pty-1', incarnation, 'token-1', true)

    incarnation = 'incarnation-2'
    expect(registry.set('pty-1', 'incarnation-1', 'token-1', false)).toBe(false)
    expect(resume).not.toHaveBeenCalled()
    registry.clear('pty-1')
    expect(registry.set('pty-1', 'incarnation-2', 'token-1', false)).toBe(true)
  })
})
