import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as TerminalShortcutPolicyModule from './terminal-shortcut-policy'
import { resolveTerminalKeyboardShortcutAction } from './keyboard-handlers'

const shortcutPolicy = vi.hoisted(() => ({ resolve: vi.fn() }))

vi.mock('./terminal-shortcut-policy', async (importOriginal) => ({
  ...(await importOriginal<typeof TerminalShortcutPolicyModule>()),
  resolveTerminalShortcutAction: shortcutPolicy.resolve
}))

// `shiftKey` is deliberately absent from the recorded shape below: this bundle's probe never
// captured it, and inventing it would make the fixture authored rather than recorded. The
// production guard reads only `isComposing`/`keyCode`, both of which ARE recorded, so the
// routing decision under test is fully determined by what the capture contains.
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

function replayKeyDowns(events: RecordedKeyboardEvent[]): string[] {
  const terminalInput: string[] = []

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
      terminalInput.push(action.data)
    }
  }

  return terminalInput
}

// Source: .tmp/ime-handoff/evidence/windows-current/ (dot-prefixed; `ls` hides it)
// file `.tmp-plain-win100real-ko-dlstek.json`
// SHA-256: 4e174230576ae17b7a9cbebf7cab84c608f592ccef896762001dd818f3512e94
// Windows 10.0.26200 + MS Korean (0412), plain terminal, injected `d l Shift+T e k` -> `있다`.
// Every `immediate`-phase keydown of the session, in order. `code` is "" on all of them because
// the injector passed scan code 0.
const RECORDED_SESSION_KEYDOWNS = [
  event({ key: 'Process', keyCode: 229 }), // d — opens the composition
  event({ key: 'Process', keyCode: 229, isComposing: true }), // l
  event({ key: 'Process', keyCode: 229, isComposing: true }), // Shift press, IME-marked
  event({ key: 'Shift', keyCode: 16, isComposing: true }),
  event({ key: 'Process', keyCode: 229, isComposing: true }), // T press, IME-marked
  event({ key: 'Process', keyCode: 229, isComposing: true }), // e — commits 있, opens ㄷ
  event({ key: 'Process', keyCode: 229, isComposing: true }), // k
  event({ key: 'Process', keyCode: 229, isComposing: true }), // Space's marked commit
  event({ key: ' ', keyCode: 32 }),
  event({ key: 'Enter', keyCode: 13 })
]

// Same capture, `injection[]`: the whole session is five injected presses, and exactly ONE of
// them holds Shift. This is what makes the pair below "one trigger", not two.
const RECORDED_SHIFTED_INJECTIONS = 1

// Records 26 and 28 of the same capture, bracketing the unmarked Shift/16 keydown at 27. One
// Shift+T press produces TWO IME-marked keydowns — the doubling this row reports, at its cause.
const RECORDED_SHIFTED_JAMO_MARKED_KEYDOWNS = RECORDED_SESSION_KEYDOWNS.slice(2, 5).filter(
  ({ keyCode }) => keyCode === 229
)

// Same capture, `result.onData[].hex`: what the renderer handed the PTY on the fixed build.
const RECORDED_ONDATA_HEX = ['ec9e88', 'eb8ba4', '20', '0d']
const WINDOWS_SHIFT_ENTER_NEWLINE = '\x1b\r'
const CARRIAGE_RETURN_HEX = '0d'
// The measured effect of the same doubling, from a different bundle and a known-bad build:
// .tmp/ime-handoff/evidence/windows-12179-real-tui/mutation-v1/ (pre-#12265 classifier reinstated)
// SHA-256 ed96881b0d1b0d = 했 + ESC CR + ESC CR in ONE onData payload, from one Shift+T press
// whose native injection log (`haetda-native.json`) contains a single LShift-held keystroke.
const KNOWN_BAD_DOUBLED_PAYLOAD_HEX = 'ed96881b0d1b0d'

describe('#12171 Windows Korean shifted jamo must not double the newline', () => {
  beforeEach(() => {
    shortcutPolicy.resolve.mockReset()
    // Model the pre-#12265 classifier that this row's newline half was closed by: it rewrote an
    // IME-marked composing keydown into Shift+Enter and encoded it as ESC CR.
    shortcutPolicy.resolve.mockImplementation((keyboardEvent: RecordedKeyboardEvent) =>
      keyboardEvent.isComposing && keyboardEvent.keyCode === 229
        ? { type: 'sendInput', data: WINDOWS_SHIFT_ENTER_NEWLINE }
        : null
    )
  })

  it('routes neither marked keydown of the single recorded Shift+T press', () => {
    // Precondition — without it, "no newline" below would not be about doubling at all.
    expect(RECORDED_SHIFTED_INJECTIONS).toBe(1)
    expect(RECORDED_SHIFTED_JAMO_MARKED_KEYDOWNS).toHaveLength(2)

    const terminalInput = replayKeyDowns(RECORDED_SHIFTED_JAMO_MARKED_KEYDOWNS)

    expect(terminalInput).toEqual([])
    expect(shortcutPolicy.resolve).not.toHaveBeenCalled()
    // Two routed marked keydowns would encode as this exact payload's two escapes.
    expect(KNOWN_BAD_DOUBLED_PAYLOAD_HEX.split(CARRIAGE_RETURN_HEX)).toHaveLength(3)
  })

  it('adds no newline of its own across the whole recorded session', () => {
    const terminalInput = replayKeyDowns(RECORDED_SESSION_KEYDOWNS)

    expect(terminalInput).toEqual([])
    // Only the two keydowns no IME ever claimed reach shortcut policy: Space and Enter.
    expect(shortcutPolicy.resolve).toHaveBeenCalledTimes(2)
    expect(shortcutPolicy.resolve).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ key: ' ', keyCode: 32, isComposing: false }),
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
    // The recorded bytes carry one CR — the Enter the user pressed — and no ESC CR anywhere.
    expect(RECORDED_ONDATA_HEX.filter((hex) => hex === CARRIAGE_RETURN_HEX)).toHaveLength(1)
    expect(RECORDED_ONDATA_HEX.join('')).not.toContain('1b0d')
  })
})
