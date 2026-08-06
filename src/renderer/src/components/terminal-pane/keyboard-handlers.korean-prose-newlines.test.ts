import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as TerminalShortcutPolicyModule from './terminal-shortcut-policy'
import { resolveTerminalKeyboardShortcutAction } from './keyboard-handlers'

const shortcutPolicy = vi.hoisted(() => ({ resolve: vi.fn() }))

vi.mock('./terminal-shortcut-policy', async (importOriginal) => ({
  ...(await importOriginal<typeof TerminalShortcutPolicyModule>()),
  resolveTerminalShortcutAction: shortcutPolicy.resolve
}))

type RecordedKeyboardEvent = TerminalShortcutPolicyModule.TerminalShortcutEvent & {
  isComposing: boolean
  keyCode: number
}

function event(overrides: Partial<RecordedKeyboardEvent>): RecordedKeyboardEvent {
  return {
    key: '',
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    keyCode: 0,
    ...overrides
  }
}

function replayKeyDowns(events: RecordedKeyboardEvent[]): ReturnType<typeof vi.fn> {
  const terminalInput = vi.fn()

  for (const keyboardEvent of events) {
    const action = resolveTerminalKeyboardShortcutAction(
      keyboardEvent,
      false,
      'false',
      0,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      () => 'alt-enter',
      () => true
    )
    if (action?.type === 'sendInput') {
      terminalInput(action.data)
    }
  }

  return terminalInput
}

// Source: .tmp/ime-handoff/swarm-scratch/win-wave4/evidence/w5/NL-s3237-jamo135.json
// SHA-256: 6121e7f3be728413bf71026b36d7aa5aec949b9a804db927d98561de81e82426
// NL-s3237-jamo136.json independently records the same 2-of-3 shape (SHA-256 9f1e789d138055e18d14bf4f64a958eeed0c8235289bc4e7b769fa416ede36f8).
const PROSE_SHIFT_KEYDOWNS = [
  event({ key: 'Shift', code: 'ShiftLeft', keyCode: 16, shiftKey: true, isComposing: true }),
  event({ key: 'Shift', code: 'ShiftLeft', keyCode: 16, shiftKey: true, isComposing: false }),
  event({ key: 'Shift', code: 'ShiftLeft', keyCode: 16, shiftKey: true, isComposing: true })
]

// Source: .tmp/ime-handoff/swarm-scratch/win-wave4/evidence/w5/NL-s3237-en135.json
// SHA-256: a95b89341ee8fb74426dfa4f8293f7232b7cd2e3190f85527b8949775ab82391
const ORDINARY_SHIFTED_PROSE_KEYDOWNS = [
  event({ key: 'T', code: 'KeyT', keyCode: 84, shiftKey: true })
]

describe('Windows Korean terminal prose newlines', () => {
  beforeEach(() => {
    shortcutPolicy.resolve.mockReset()
    // Model v1.4.163's code-blind composition classifier behind the ownership guard.
    shortcutPolicy.resolve.mockImplementation((keyboardEvent: RecordedKeyboardEvent) =>
      keyboardEvent.isComposing && keyboardEvent.shiftKey
        ? { type: 'sendInput', data: '\x1b\r' }
        : null
    )
  })

  it('does not fragment the recorded prose at its two active-composition Shift presses', () => {
    const activeCompositionPresses = PROSE_SHIFT_KEYDOWNS.filter(({ isComposing }) => isComposing)
    const terminalInput = replayKeyDowns(activeCompositionPresses)

    expect(PROSE_SHIFT_KEYDOWNS).toHaveLength(3)
    expect(activeCompositionPresses).toHaveLength(2)
    expect(terminalInput.mock.calls.filter(([data]) => data === '\x1b\r')).toHaveLength(0)
    expect(shortcutPolicy.resolve).not.toHaveBeenCalled()
  })

  it('lets ordinary shifted prose input follow shortcut policy exactly once', () => {
    const terminalInput = replayKeyDowns(ORDINARY_SHIFTED_PROSE_KEYDOWNS)

    expect(terminalInput).not.toHaveBeenCalledWith('\x1b\r')
    expect(shortcutPolicy.resolve).toHaveBeenCalledTimes(1)
    expect(shortcutPolicy.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'T',
        code: 'KeyT',
        keyCode: 84,
        shiftKey: true,
        isComposing: false
      }),
      false,
      'false',
      0,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      expect.any(Function),
      expect.any(Function),
      'orca-first'
    )
  })
})
