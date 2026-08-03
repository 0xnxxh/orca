import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createKeyboardEffectInstanceId,
  getKeyboardEffectChurnCanarySizeForTesting,
  recordKeyboardEffectRegistration,
  resetKeyboardEffectChurnCanaryForTesting
} from './keyboard-effect-churn-canary'

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetKeyboardEffectChurnCanaryForTesting()
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  resetKeyboardEffectChurnCanaryForTesting()
})

describe('keyboard effect churn canary', () => {
  it('warns once a burst of registrations lands inside the window', () => {
    const instanceId = createKeyboardEffectInstanceId()
    for (const at of [0, 10, 20, 30]) {
      recordKeyboardEffectRegistration('tab-1', instanceId, at)
    }
    expect(warnSpy).not.toHaveBeenCalled()

    recordKeyboardEffectRegistration('tab-1', instanceId, 40)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const message = String(warnSpy.mock.calls[0]?.[0])
    expect(message).toContain('tab-1')
    expect(message).toContain('useTerminalKeyboardShortcuts')
    expect(message).toContain('7 window listeners')
    expect(message).toContain('IME chord state')
  })

  it('stays quiet for mount plus occasional legitimate re-registration', () => {
    const instanceId = createKeyboardEffectInstanceId()
    // A keybindings edit re-runs the effect, but nowhere near per-render cadence.
    for (const at of [0, 3_000, 6_000, 9_000, 12_000, 15_000]) {
      recordKeyboardEffectRegistration('tab-1', instanceId, at)
    }

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('rate-limits a hot churn loop instead of flooding the console', () => {
    const instanceId = createKeyboardEffectInstanceId()
    // 400 registrations across 20s: warns at 200ms, then once per 5s cooldown.
    for (let i = 0; i < 400; i++) {
      recordKeyboardEffectRegistration('tab-1', instanceId, i * 50)
    }

    expect(warnSpy).toHaveBeenCalledTimes(4)
  })

  it('does not read repeated mounts of one tab as churn', () => {
    // Each mount gets its own instance id, so remount thrash is not dep churn.
    for (let mount = 0; mount < 8; mount++) {
      recordKeyboardEffectRegistration('tab-1', createKeyboardEffectInstanceId(), mount * 10)
    }

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('prunes histories so state cannot grow across many tabs', () => {
    for (let tab = 0; tab < 50; tab++) {
      recordKeyboardEffectRegistration(`tab-${tab}`, createKeyboardEffectInstanceId(), tab)
    }
    expect(getKeyboardEffectChurnCanarySizeForTesting()).toBe(50)

    recordKeyboardEffectRegistration('tab-late', createKeyboardEffectInstanceId(), 100_000)

    expect(getKeyboardEffectChurnCanarySizeForTesting()).toBe(1)
  })

  it('keeps a warned tab retained until its cooldown elapses', () => {
    const instanceId = createKeyboardEffectInstanceId()
    for (const at of [0, 10, 20, 30, 40]) {
      recordKeyboardEffectRegistration('tab-1', instanceId, at)
    }
    expect(warnSpy).toHaveBeenCalledTimes(1)

    // Timestamps have expired, but dropping the key here would reset the limiter.
    recordKeyboardEffectRegistration('tab-2', createKeyboardEffectInstanceId(), 3_000)
    expect(getKeyboardEffectChurnCanarySizeForTesting()).toBe(2)

    // Past the cooldown the limiter no longer needs it, so it retires too.
    recordKeyboardEffectRegistration('tab-3', createKeyboardEffectInstanceId(), 6_000)
    expect(getKeyboardEffectChurnCanarySizeForTesting()).toBe(1)
  })
})
