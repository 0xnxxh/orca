import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

type ImeKeyboardEvent = {
  isComposing?: boolean
  keyCode?: number
  nativeEvent?: { isComposing?: boolean; keyCode?: number }
}

type ImeModifierGestureEvent = ImeKeyboardEvent & {
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

const IME_OWNED_SHORTCUT_EVENT = Symbol('imeOwnedShortcutEvent')

/** True when the IME, rather than Orca, owns a keyboard event. */
export function isImeOwnedKeyboardEvent(event: object): boolean {
  const candidate = event as ImeKeyboardEvent
  return (
    candidate.isComposing === true ||
    candidate.keyCode === 229 ||
    candidate.nativeEvent?.isComposing === true ||
    candidate.nativeEvent?.keyCode === 229
  )
}

export function resolveImeModifierGesture(
  active: boolean,
  event: ImeModifierGestureEvent
): { active: boolean; carried: boolean; owned: boolean } {
  const hasModifier = Boolean(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
  const marked = isImeOwnedKeyboardEvent(event)
  const owned = active || (hasModifier && marked)
  return { active: owned && hasModifier, carried: active && !marked, owned }
}

export function markImeOwnedShortcutEvent(event: object): void {
  Object.defineProperty(event, IME_OWNED_SHORTCUT_EVENT, { value: true })
}

export function isMarkedImeOwnedShortcutEvent(event: object): boolean {
  return (event as { [IME_OWNED_SHORTCUT_EVENT]?: boolean })[IME_OWNED_SHORTCUT_EVENT] === true
}

/**
 * Why: CJK IMEs (Japanese/Chinese/Korean) fire a keydown for the Enter that
 * only confirms a conversion candidate. Rename/title inputs that commit on
 * `Enter` must ignore that keydown, otherwise they submit mid-composition with a
 * half-converted value. `isComposing` covers most browsers; `keyCode === 229` is
 * a defensive fallback for IMEs that don't set `isComposing` on keydown.
 */
export function isImeCompositionKeyDown(event: ReactKeyboardEvent): boolean {
  return isImeOwnedKeyboardEvent(event)
}
