import { describe, expect, it, vi } from 'vitest'
import { createTerminalOptionKittyReleaseTracker } from './terminal-option-kitty-release'

function keyboardEvent(
  overrides: Partial<{
    key: string
    code: string
    shiftKey: boolean
    altKey: boolean
    ctrlKey: boolean
    metaKey: boolean
    repeat: boolean
  }>
) {
  return {
    key: 'q',
    code: 'KeyQ',
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    repeat: false,
    ...overrides
  }
}

describe('terminal Option kitty releases', () => {
  it('uses live keyup modifiers and current alternate-key flags', () => {
    const sendInput = vi.fn()
    const tracker = createTerminalOptionKittyReleaseTracker()
    const layout = (code: string, shifted: boolean): string | undefined =>
      code === 'Digit7' ? (shifted ? '/' : '7') : undefined
    tracker.arm(
      keyboardEvent({ key: '\\', code: 'Digit7', shiftKey: true, altKey: true }),
      { flags: 2 },
      sendInput,
      () => 6,
      layout
    )

    expect(
      tracker.settle(keyboardEvent({ key: '7', code: 'Digit7', shiftKey: false, altKey: true }))
    ).toBe(true)
    expect(sendInput).toHaveBeenCalledWith('\x1b[55;3:3u')
  })

  it('drops Alt when Option came up before the character key', () => {
    const sendInput = vi.fn()
    const tracker = createTerminalOptionKittyReleaseTracker()
    tracker.arm(
      keyboardEvent({ key: 'ƒ', code: 'KeyF', altKey: true }),
      { flags: 2 },
      sendInput,
      () => 2
    )

    tracker.settle(keyboardEvent({ key: 'f', code: 'KeyF', altKey: false }))
    expect(sendInput).toHaveBeenCalledWith('\x1b[102;1:3u')
  })

  it('owns the keyup but drops its bytes after event reporting is popped', () => {
    const sendInput = vi.fn()
    const tracker = createTerminalOptionKittyReleaseTracker()
    tracker.arm(keyboardEvent({ key: '@', altKey: true }), { flags: 2 }, sendInput, () => 0)

    expect(tracker.settle(keyboardEvent({ key: 'q', altKey: true }))).toBe(true)
    expect(sendInput).not.toHaveBeenCalled()
    expect(tracker.settle(keyboardEvent({ key: 'q', altKey: true }))).toBe(false)
  })

  it('keeps the first release owner when auto-repeat keydowns are re-armed', () => {
    const firstSender = vi.fn()
    const repeatSender = vi.fn()
    const tracker = createTerminalOptionKittyReleaseTracker()
    const press = keyboardEvent({ key: '@', altKey: true })
    tracker.arm(press, { flags: 2 }, firstSender, () => 2)
    tracker.arm({ ...press, repeat: true }, { flags: 2 }, repeatSender, () => 2)

    tracker.settle(keyboardEvent({ key: 'q', altKey: true }))
    expect(firstSender).toHaveBeenCalledWith('\x1b[113;3:3u')
    expect(repeatSender).not.toHaveBeenCalled()
  })

  it('lets a fresh press replace an orphaned release owner for the same key', () => {
    const staleSender = vi.fn()
    const freshSender = vi.fn()
    const tracker = createTerminalOptionKittyReleaseTracker()
    const press = keyboardEvent({ key: '@', altKey: true })
    tracker.arm(press, { flags: 2 }, staleSender, () => 2)
    tracker.arm(press, { flags: 2 }, freshSender, () => 2)

    tracker.settle(keyboardEvent({ key: 'q', altKey: true }))
    expect(staleSender).not.toHaveBeenCalled()
    expect(freshSender).toHaveBeenCalledWith('\x1b[113;3:3u')
  })
})
