import { isImeCompositionKeyDown } from '@/lib/ime-composition-keyboard-event'

export type TaskPageEscapeAction = 'ignore' | 'blur-target' | 'close-page'
export type TaskPageSearchShortcutAction = 'ignore' | 'focus-search'

/**
 * The task page installs its shortcut listeners on `window` in the capture phase, so they
 * run ahead of whatever element is composing. Every decision here therefore has to yield to
 * a live composition before it looks at key shape.
 */

function targetAcceptsTextEntry(target: EventTarget | null): target is HTMLElement {
  return (
    target instanceof HTMLElement &&
    (target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable)
  )
}

/**
 * Escape is how the user dismisses a candidate window, so acting on it here would blur the
 * field and take the live composition with it.
 *
 * Blurring before closing keeps Escape from dismissing the whole page for a user who only
 * meant to leave a field.
 */
export function resolveTaskPageEscapeAction(
  event: Pick<KeyboardEvent, 'key' | 'keyCode' | 'isComposing'>,
  target: EventTarget | null
): TaskPageEscapeAction {
  if (isImeCompositionKeyDown(event) || event.key !== 'Escape') {
    return 'ignore'
  }
  if (!(target instanceof HTMLElement)) {
    return 'ignore'
  }
  const focusIsInAField = target instanceof HTMLSelectElement || targetAcceptsTextEntry(target)
  return focusIsInAField ? 'blur-target' : 'close-page'
}

/**
 * Whether Mod+F should steal focus into the task-search input.
 *
 * The search input is deliberately exempt from the editable-target bail-out so the chord
 * re-selects text while the field already has focus — which is exactly why this needs the
 * IME check: composing *inside* that field would otherwise have its preedit torn down by
 * the focus/select below.
 */
export function resolveTaskPageSearchShortcut(
  event: Pick<
    KeyboardEvent,
    'key' | 'keyCode' | 'isComposing' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
  >,
  target: EventTarget | null,
  searchInput: HTMLInputElement | null,
  { isMac }: { isMac: boolean }
): TaskPageSearchShortcutAction {
  if (isImeCompositionKeyDown(event)) {
    return 'ignore'
  }
  const modifierPressed = isMac ? event.metaKey : event.ctrlKey
  if (!modifierPressed || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'f') {
    return 'ignore'
  }
  if (!searchInput) {
    return 'ignore'
  }
  if (target !== searchInput && targetAcceptsTextEntry(target)) {
    return 'ignore'
  }
  return 'focus-search'
}
