import type { PhysicalModifierToken } from '../../../shared/keybindings'
import { isImeCompositionKeyDown } from '@/lib/ime-composition-keyboard-event'

/**
 * Abstraction over a real KeyboardEvent and a synthetic double-tap gesture so one dispatch
 * path serves both; KeybindingInput-compatible.
 *
 * The IME markers are part of the contract. The shared matcher refuses a chord an IME owns by
 * reading them off this object, so an adapter that builds it field-by-field and omits them
 * re-opens the hole no matter what the matcher does — which is exactly how a composing
 * Mod+Alt+W reached `tab.closeAll` after the matcher was already guarded.
 */
export type ShortcutDispatchInput = {
  key?: string
  code?: string
  altKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  isComposing?: boolean
  keyCode?: number
  doubleTapModifier?: PhysicalModifierToken
  target: EventTarget | null
  defaultPrevented: boolean
  preventDefault: () => void
}

/** Null when an IME owns the keystroke, so the window listener has nothing to dispatch. */
export function toShortcutDispatchInput(event: KeyboardEvent): ShortcutDispatchInput | null {
  if (isImeCompositionKeyDown(event)) {
    return null
  }
  return {
    altKey: event.altKey,
    code: event.code,
    ctrlKey: event.ctrlKey,
    defaultPrevented: event.defaultPrevented,
    isComposing: event.isComposing,
    key: event.key,
    keyCode: event.keyCode,
    metaKey: event.metaKey,
    preventDefault: () => event.preventDefault(),
    shiftKey: event.shiftKey,
    target: event.target
  }
}

/**
 * The double-tap gesture carries no key or modifier flags, so only DoubleTap bindings match.
 * It still passes the markers through: the gesture is only as trustworthy as the release that
 * completed it.
 */
export function toDoubleTapShortcutDispatchInput(
  event: KeyboardEvent,
  doubleTapModifier: PhysicalModifierToken
): ShortcutDispatchInput | null {
  if (isImeCompositionKeyDown(event)) {
    return null
  }
  return {
    defaultPrevented: event.defaultPrevented,
    doubleTapModifier,
    isComposing: event.isComposing,
    keyCode: event.keyCode,
    preventDefault: () => event.preventDefault(),
    target: event.target
  }
}
