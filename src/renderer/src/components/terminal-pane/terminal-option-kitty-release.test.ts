import { describe, expect, it, vi } from 'vitest'
import {
  createTerminalOptionKittyReleaseTracker,
  encodeTerminalOptionKittyRelease
} from './terminal-option-kitty-release'

describe('terminal Option kitty releases', () => {
  it('encodes event type and sparse alternate key fields', () => {
    expect(
      encodeTerminalOptionKittyRelease(
        {
          flags: 7,
          primaryCodePoint: 64,
          baseCodePoint: 113,
          modifiers: 1
        },
        7
      )
    ).toBe('\x1b[64::113;1:3u')
    expect(
      encodeTerminalOptionKittyRelease(
        {
          flags: 6,
          primaryCodePoint: 123,
          shiftedCodePoint: 92,
          baseCodePoint: 55,
          modifiers: 2
        },
        6
      )
    ).toBe('\x1b[123:92:55;2:3u')
  })

  it('owns the keyup but drops its bytes after event reporting is popped', () => {
    const sendInput = vi.fn()
    const tracker = createTerminalOptionKittyReleaseTracker()
    tracker.arm(
      { key: '@', code: 'KeyQ' },
      { flags: 2, primaryCodePoint: 64, modifiers: 1 },
      sendInput,
      () => 0
    )

    expect(tracker.settle({ key: '@', code: 'KeyQ' })).toBe(true)
    expect(sendInput).not.toHaveBeenCalled()
    expect(tracker.settle({ key: '@', code: 'KeyQ' })).toBe(false)
  })
})
