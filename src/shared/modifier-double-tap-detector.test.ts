import { describe, expect, it } from 'vitest'
import {
  ModifierDoubleTapDetector,
  modifierFromKeyEvent,
  toModifierDoubleTapEvent,
  type ModifierDoubleTapEvent,
  type ModifierKeyEventLike
} from './modifier-double-tap-detector'

function down(
  modifier: ModifierDoubleTapEvent['modifier'],
  overrides: Partial<ModifierDoubleTapEvent> = {}
): ModifierDoubleTapEvent {
  return { type: 'keyDown', modifier, isModifierOnly: true, isAutoRepeat: false, ...overrides }
}

function up(
  modifier: ModifierDoubleTapEvent['modifier'],
  overrides: Partial<ModifierDoubleTapEvent> = {}
): ModifierDoubleTapEvent {
  return { type: 'keyUp', modifier, isModifierOnly: true, isAutoRepeat: false, ...overrides }
}

const otherKey: ModifierDoubleTapEvent = {
  type: 'keyDown',
  modifier: null,
  isModifierOnly: false,
  isAutoRepeat: false
}

describe('ModifierDoubleTapDetector', () => {
  it('emits when the second press lands inside the window', () => {
    const d = new ModifierDoubleTapDetector()
    expect(d.process(down('Shift'), 0)).toBeNull()
    expect(d.process(up('Shift'), 10)).toBeNull()
    expect(d.process(down('Shift'), 200)).toEqual({ modifier: 'Shift' })
  })

  it('does not emit when the second press is past the window', () => {
    const d = new ModifierDoubleTapDetector()
    d.process(down('Shift'), 0)
    d.process(up('Shift'), 10)
    expect(d.process(down('Shift'), 400)).toBeNull()
  })

  it('resets on an intervening non-modifier key', () => {
    const d = new ModifierDoubleTapDetector()
    d.process(down('Shift'), 0)
    d.process(up('Shift'), 10)
    expect(d.process(otherKey, 20)).toBeNull()
    expect(d.process(down('Shift'), 100)).toBeNull()
  })

  it('treats a different modifier as a fresh gesture, not a completion', () => {
    const d = new ModifierDoubleTapDetector()
    d.process(down('Shift'), 0)
    d.process(up('Shift'), 10)
    // Wrong modifier: no emit, but it begins a new first tap.
    expect(d.process(down('Alt'), 100)).toBeNull()
    expect(d.process(up('Alt'), 110)).toBeNull()
    expect(d.process(down('Alt'), 150)).toEqual({ modifier: 'Alt' })
  })

  it('does not treat an auto-repeat hold as a tap', () => {
    const d = new ModifierDoubleTapDetector()
    d.process(down('Shift'), 0)
    // Holding the key emits auto-repeat keyDowns — this must cancel the gesture.
    expect(d.process(down('Shift', { isAutoRepeat: true }), 30)).toBeNull()
    d.process(up('Shift'), 500)
    expect(d.process(down('Shift'), 520)).toBeNull()
  })

  it('does not emit when another modifier is held (isModifierOnly false)', () => {
    const d = new ModifierDoubleTapDetector()
    expect(d.process(down('Shift', { isModifierOnly: false }), 0)).toBeNull()
    d.process(up('Shift'), 10)
    expect(d.process(down('Shift'), 100)).toBeNull()
  })

  it('handles a second keyDown of the same modifier without an intervening keyUp', () => {
    const d = new ModifierDoubleTapDetector()
    d.process(down('Shift'), 0)
    // Missed keyUp — a fresh (non-repeat) keyDown for the same modifier just
    // restarts the first tap rather than emitting.
    d.process(down('Shift'), 50)
    d.process(up('Shift'), 60)
    // The next press within the window still completes the gesture.
    expect(d.process(down('Shift'), 200)).toEqual({ modifier: 'Shift' })
  })

  it('clears armed state when the second keydown was suppressed (allowlisted path)', () => {
    const d = new ModifierDoubleTapDetector()
    d.process(down('Shift'), 0) // first tap down → down1
    d.process(up('Shift'), 10) // first tap up → armed
    // The main process suppressed the second keydown (an allowlisted action fired
    // there), but the second tap's keyup still reaches this detector.
    d.process(up('Shift'), 20)
    // A later lone Shift press (e.g. typing a capital) must NOT phantom-complete
    // a double-tap from the stale armed state.
    expect(d.process(down('Shift'), 200)).toBeNull()
  })

  it('clears state on reset()', () => {
    const d = new ModifierDoubleTapDetector()
    d.process(down('Shift'), 0)
    d.process(up('Shift'), 10)
    d.reset()
    expect(d.process(down('Shift'), 100)).toBeNull()
  })

  it('normalizes platform key events', () => {
    expect(modifierFromKeyEvent('ShiftLeft', 'Shift')).toBe('Shift')
    expect(modifierFromKeyEvent('MetaRight', 'Meta')).toBe('Cmd')
    expect(modifierFromKeyEvent('ControlLeft', 'Control')).toBe('Ctrl')
    expect(modifierFromKeyEvent('KeyA', 'a')).toBeNull()

    expect(
      toModifierDoubleTapEvent({ type: 'keyDown', code: 'ShiftLeft', key: 'Shift', shift: true })
    ).toEqual({ type: 'keyDown', modifier: 'Shift', isModifierOnly: true, isAutoRepeat: false })

    // Another modifier held → not a bare modifier event.
    expect(
      toModifierDoubleTapEvent({
        type: 'keyDown',
        code: 'ShiftLeft',
        key: 'Shift',
        shift: true,
        meta: true
      })
    ).toMatchObject({ modifier: 'Shift', isModifierOnly: false })

    expect(toModifierDoubleTapEvent({ type: 'keyDown', code: 'KeyA', key: 'a' })).toMatchObject({
      modifier: null,
      isModifierOnly: false
    })
  })
})

// A detected tap is dispatched as `{ doubleTapModifier }` with no key or modifier flags, so once
// one is armed there is nothing left for the shortcut matcher to refuse on. That makes this the
// only place the refusal can happen — and normalizing it here means a listener that forgets the
// check still cannot arm a gesture from a keystroke the IME owns.
describe('toModifierDoubleTapEvent refuses input an IME owns', () => {
  const shiftTap = (over: Partial<ModifierKeyEventLike> = {}): ModifierKeyEventLike => ({
    type: 'keyDown',
    code: 'ShiftLeft',
    key: 'Shift',
    shift: true,
    ...over
  })

  it('reads a bare modifier press as a tap when nothing marks it', () => {
    expect(toModifierDoubleTapEvent(shiftTap())).toMatchObject({
      modifier: 'Shift',
      isModifierOnly: true
    })
  })

  it.each([
    ['isComposing', { isComposing: true }],
    ['keyCode 229', { keyCode: 229 }],
    ['key Process', { key: 'Process' }]
  ])('drops the modifier when the event is marked by %s', (_marker, over) => {
    expect(toModifierDoubleTapEvent(shiftTap(over))).toMatchObject({
      modifier: null,
      isModifierOnly: false
    })
  })

  it('leaves callers that pass no marker fields unchanged', () => {
    // Electron's before-input-event carries neither marker; it must keep working.
    expect(
      toModifierDoubleTapEvent({ type: 'keyDown', code: 'MetaLeft', meta: true })
    ).toMatchObject({ modifier: 'Cmd' })
  })

  it('breaks a gesture whose second press the IME owns, rather than emitting', () => {
    const d = new ModifierDoubleTapDetector()
    d.process(toModifierDoubleTapEvent(shiftTap()), 0)
    d.process(toModifierDoubleTapEvent(shiftTap({ type: 'keyUp' })), 10)

    expect(d.process(toModifierDoubleTapEvent(shiftTap({ isComposing: true })), 20)).toBeNull()
    // And the armed state is gone, so the next unmarked press starts over instead of completing.
    expect(d.process(toModifierDoubleTapEvent(shiftTap()), 30)).toBeNull()
  })

  // The release is what arms the second half of the gesture, so it needs the same refusal as the
  // press — otherwise a composition that starts mid-gesture still completes a tap.
  it('does not let a composing release arm the gesture', () => {
    const d = new ModifierDoubleTapDetector()
    d.process(toModifierDoubleTapEvent(shiftTap()), 0)
    d.process(toModifierDoubleTapEvent(shiftTap({ type: 'keyUp', isComposing: true })), 10)

    expect(d.process(toModifierDoubleTapEvent(shiftTap()), 20)).toBeNull()
  })
})
