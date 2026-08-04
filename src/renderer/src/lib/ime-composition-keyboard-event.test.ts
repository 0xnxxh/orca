import { describe, expect, it } from 'vitest'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  isImeCompositionKeyDown,
  isImeOwnedKeyboardEvent,
  resolveImeModifierGesture
} from './ime-composition-keyboard-event'

function keyEvent(nativeEvent: { isComposing?: boolean; keyCode?: number }): ReactKeyboardEvent {
  return {
    nativeEvent: {
      isComposing: nativeEvent.isComposing ?? false,
      keyCode: nativeEvent.keyCode ?? 13
    }
  } as unknown as ReactKeyboardEvent
}

describe('isImeCompositionKeyDown', () => {
  it('owns the marked real Enter shape without treating plain Enter as IME input', () => {
    expect(isImeOwnedKeyboardEvent({ isComposing: true, keyCode: 13 })).toBe(true)
    expect(isImeOwnedKeyboardEvent({ isComposing: false, keyCode: 13 })).toBe(false)
  })

  it('is true while the IME is composing', () => {
    expect(isImeCompositionKeyDown(keyEvent({ isComposing: true }))).toBe(true)
  })

  it('is true for the keyCode 229 fallback when isComposing is not set', () => {
    expect(isImeCompositionKeyDown(keyEvent({ isComposing: false, keyCode: 229 }))).toBe(true)
  })

  it('is false for a plain Enter outside of composition', () => {
    expect(isImeCompositionKeyDown(keyEvent({ isComposing: false, keyCode: 13 }))).toBe(false)
  })

  it('keeps the recorded Process/ShiftLeft event IME-owned without treating ordinary Shift as IME', () => {
    const shift = { code: 'ShiftLeft', shiftKey: true, isComposing: false }
    expect(isImeOwnedKeyboardEvent({ ...shift, key: 'Process', keyCode: 229 })).toBe(true)
    expect(isImeOwnedKeyboardEvent({ ...shift, key: 'Shift', keyCode: 16 })).toBe(false)
  })

  it('owns the marked Windows palette chord without swallowing the ordinary chord', () => {
    const chord = { key: 'J', code: 'KeyJ', ctrlKey: true, shiftKey: true, keyCode: 74 }
    expect(isImeOwnedKeyboardEvent({ ...chord, isComposing: true })).toBe(true)
    expect(isImeOwnedKeyboardEvent({ ...chord, isComposing: false })).toBe(false)
  })

  it('keeps ownership through the recorded marked modifiers and unmarked dispatch key', () => {
    let gesture = resolveImeModifierGesture(false, {
      ctrlKey: true,
      isComposing: true
    })
    expect(gesture).toEqual({ active: true, carried: false, owned: true })

    gesture = resolveImeModifierGesture(gesture.active, {
      ctrlKey: true,
      shiftKey: true,
      isComposing: true
    })
    gesture = resolveImeModifierGesture(gesture.active, {
      ctrlKey: true,
      shiftKey: true,
      isComposing: false
    })
    expect(gesture).toEqual({ active: true, carried: true, owned: true })

    gesture = resolveImeModifierGesture(gesture.active, {
      isComposing: false
    })
    expect(gesture).toEqual({ active: false, carried: true, owned: true })
    expect(
      resolveImeModifierGesture(false, {
        ctrlKey: true,
        shiftKey: true,
        isComposing: false
      })
    ).toEqual({ active: false, carried: false, owned: false })
  })
})
