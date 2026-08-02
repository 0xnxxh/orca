import { isImeCompositionKeyDown } from '@/lib/ime-composition-keyboard-event'

type ResolvedShortcutAction = { readonly type: string } | null

/**
 * True when an IME owns this keydown, so no terminal shortcut may act on it.
 *
 * The window-capture handler runs before the pane's own key handler and stops
 * propagation on a match, so a chord resolved here is the only thing the keystroke
 * will ever do. Ctrl+Backspace mid-preedit reaches the PTY as `\x17` and erases a word
 * of the real command line behind the candidate window; the IME's buffer is untouched.
 * The non-Latin fallback makes it worse by re-deriving bindings from `event.code`, so
 * even a keystroke reported as `Process` still matches Ctrl+W and closes the pane.
 *
 * Two exemptions, both paths that already handle a live composition:
 *
 * - **Enter** — the send path defers it until the commit lands, so it must get through.
 * - **Input-source switch** — it only hands the key back to the OS. Dropping it here
 *   would let xterm see the chord instead and write its control byte to the PTY, which
 *   is the very failure this guard exists to prevent.
 *
 * Resolution is pure, so asking for the action before deciding costs nothing.
 */
export function terminalShortcutIsOwnedByIme(
  event: KeyboardEvent,
  resolveAction: (event: KeyboardEvent) => ResolvedShortcutAction
): boolean {
  if (!isImeCompositionKeyDown(event)) {
    return false
  }
  if (event.code === 'Enter') {
    return false
  }
  return resolveAction(event)?.type !== 'switchInputSource'
}
