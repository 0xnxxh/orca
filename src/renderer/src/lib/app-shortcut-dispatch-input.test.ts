// @vitest-environment happy-dom
// Guarding the shared matcher is not enough on its own: this adapter rebuilds the input
// field-by-field, so any field it forgets is a field the matcher can never refuse on. The
// regression these pin is a composing Mod+Alt+W that the matcher rejected directly but that
// resolved `tab.closeAll` once it had been through the adapter.

import { describe, expect, it } from 'vitest'
import { keybindingMatchesAction } from '../../../shared/keybindings'
import {
  toDoubleTapShortcutDispatchInput,
  toShortcutDispatchInput
} from './app-shortcut-dispatch-input'

function closeAllTabsEvent(over: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    altKey: true,
    code: 'KeyW',
    key: 'w',
    metaKey: true,
    ...over
  })
}

describe('toShortcutDispatchInput', () => {
  it('carries a real chord through to a matching action', () => {
    const input = toShortcutDispatchInput(closeAllTabsEvent())

    expect(input).not.toBeNull()
    expect(keybindingMatchesAction('tab.closeAll', input!, 'darwin')).toBe(true)
  })

  it.each([
    ['isComposing', { isComposing: true }],
    ['keyCode 229', { keyCode: 229 }]
  ])('refuses to build an input for a chord marked by %s', (_marker, over) => {
    expect(toShortcutDispatchInput(closeAllTabsEvent(over))).toBeNull()
  })

  // Defense in depth, and the field-level assertion the null-return above cannot make: the
  // copy must carry the markers verbatim so the matcher can refuse on its own. Dropping them
  // here is the original defect, and it is invisible to every test that only checks the null.
  it('copies the IME markers verbatim rather than dropping them', () => {
    const input = toShortcutDispatchInput(closeAllTabsEvent())!

    expect(input.isComposing).toBe(false)
    expect(input.keyCode).toBe(closeAllTabsEvent().keyCode)
    expect(Object.hasOwn(input, 'isComposing')).toBe(true)
    expect(Object.hasOwn(input, 'keyCode')).toBe(true)
  })
})

describe('toDoubleTapShortcutDispatchInput', () => {
  it('builds a gesture from an ordinary release', () => {
    const input = toDoubleTapShortcutDispatchInput(new KeyboardEvent('keydown'), 'Shift')

    expect(input?.doubleTapModifier).toBe('Shift')
  })

  // A composing chord must not arm a double-tap: the synthetic input it produces carries no
  // key or modifier flags, so there is nothing left downstream for the matcher to refuse on.
  it('refuses to build a gesture while an IME owns the keystroke', () => {
    expect(
      toDoubleTapShortcutDispatchInput(new KeyboardEvent('keydown', { isComposing: true }), 'Shift')
    ).toBeNull()
  })
})
