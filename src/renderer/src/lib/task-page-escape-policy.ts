import { isImeCompositionKeyDown } from '@/lib/ime-composition-keyboard-event'

export type TaskPageEscapeAction = 'ignore' | 'blur-target' | 'close-page'

/**
 * What Escape should do at the task page's window-capture listener.
 *
 * The IME check comes first because the listener runs in the capture phase, ahead of the
 * composing element. Escape is how the user dismisses a candidate window, and acting on it
 * here would blur the field and take the live composition with it.
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
  const focusIsInAField =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  return focusIsInAField ? 'blur-target' : 'close-page'
}
