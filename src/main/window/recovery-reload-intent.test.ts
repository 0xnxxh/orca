import { performance } from 'node:perf_hooks'
import { describe, expect, it, vi } from 'vitest'
import { RECOVERY_RELOAD_INTENT_TTL_MS, createRecoveryReloadIntent } from './recovery-reload-intent'

describe('createRecoveryReloadIntent', () => {
  it('pins the production intent lifetime at 30 seconds', () => {
    expect(RECOVERY_RELOAD_INTENT_TTL_MS).toBe(30_000)
  })

  it('uses the monotonic clock by default', () => {
    const performanceNow = vi
      .spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValue(150)
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(100)
    const intent = createRecoveryReloadIntent({
      createToken: () => 'intent-1',
      durationMs: 50
    })

    intent.begin(7)

    expect(intent.consume(7)).toBe(false)
    expect(performanceNow).toHaveBeenCalledTimes(2)
    expect(dateNow).not.toHaveBeenCalled()
  })

  it('consumes only the matching webContents intent once', () => {
    const intent = createRecoveryReloadIntent({
      now: () => 100,
      createToken: () => 'intent-1',
      durationMs: 50
    })

    expect(intent.begin(7)).toBe('intent-1')
    expect(intent.consume(8)).toBe(false)
    expect(intent.consume(7)).toBe(true)
    expect(intent.consume(7)).toBe(false)
  })

  it('cancels only the exact token from the originating webContents', () => {
    const intent = createRecoveryReloadIntent({
      now: () => 100,
      createToken: () => 'intent-1',
      durationMs: 50
    })

    intent.begin(7)
    expect(intent.cancel(7, 'stale')).toBe(false)
    expect(intent.cancel(8, 'intent-1')).toBe(false)
    expect(intent.cancel(7, 'intent-1')).toBe(true)
    expect(intent.consume(7)).toBe(false)
  })

  it('never expires early when an injected clock moves backwards', () => {
    let now = 100
    const intent = createRecoveryReloadIntent({
      now: () => now,
      createToken: () => 'intent-1',
      durationMs: 50
    })

    intent.begin(7)
    now = 120
    expect(intent.consume(8)).toBe(false)
    now = 110
    expect(intent.consume(8)).toBe(false)
    now = 151

    expect(intent.consume(7)).toBe(true)
  })

  it('restarts the expiry window after an injected clock rollback', () => {
    let now = 100
    const intent = createRecoveryReloadIntent({
      now: () => now,
      createToken: () => 'intent-1',
      durationMs: 50
    })

    intent.begin(7)
    now = 120
    expect(intent.consume(8)).toBe(false)
    now = 90
    expect(intent.consume(8)).toBe(false)
    now = 145

    expect(intent.consume(7)).toBe(false)
  })

  it('expires at the injected deadline without wall-clock waiting', () => {
    let now = 100
    const intent = createRecoveryReloadIntent({
      now: () => now,
      createToken: () => 'intent-1',
      durationMs: 50
    })

    intent.begin(7)
    now = 150

    expect(intent.consume(7)).toBe(false)
    expect(intent.cancel(7, 'intent-1')).toBe(false)
  })
})
